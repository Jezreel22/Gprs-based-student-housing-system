import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  auditLogTable,
  bookingsTable,
  disputesTable,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { deactivateTrustEvent, recordTrustEvent } from "@/lib/trust/service";
import { recordSettlement } from "@/lib/escrow-transactions/service";
import { initiateRefund } from "@/lib/paystack-server";

const AdjudicateBody = z.object({
  decision: z.enum(["dismissed", "partial_refund", "full_refund", "fraud_substantiated"]),
  adjudication_notes: z.string().min(10),
  refund_percentage_to_student: z.number().int().min(0).max(100).optional(),
});

export const runtime = "nodejs";

/**
 * POST /api/disputes/[id]/adjudicate
 *
 * Settle a dispute by creating the necessary refund + release legs:
 *
 *   dismissed            → release the FULL booking total to the landlord
 *   partial_refund       → refund `percentage` to the student, release the
 *                          remainder to the landlord
 *   full_refund          → refund 100% to the student, no landlord release
 *   fraud_substantiated  → refund 100% to the student, no landlord release
 *
 * Settlement rules:
 *   - Paystack charge: call initiateRefund; the refund receipt is created
 *     when the `refund.processed` webhook confirms the move.
 *   - Bank-transfer payment: create a `manual_review` refund transaction;
 *     an escrow officer confirms it via /api/bookings/[id]/mark-refunded.
 *
 * The booking becomes `completed` (or stays non-terminal) once every
 * required settlement leg has succeeded. We never set booking_status to
 * `completed` before the refunds/release actually settle.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") throw new Error("Forbidden");
    const { id } = await params;
    const [d] = await db.select().from(disputesTable).where(eq(disputesTable.id, id)).limit(1);
    if (!d) return errorResponse("Dispute not found", 404);
    if (d.dispute_status === "resolved") {
      return errorResponse("Dispute has already been resolved", 409);
    }

    const body = await parseBody(req, AdjudicateBody);

    // Validate decision-specific input. Refund percentage is required for
    // partial refunds and rejected for full / fraud.
    if (body.decision === "partial_refund") {
      if (body.refund_percentage_to_student == null) {
        return errorResponse("Partial refunds require refund_percentage_to_student", 422);
      }
      if (body.refund_percentage_to_student < 1 || body.refund_percentage_to_student > 99) {
        return errorResponse("Partial refund percentage must be 1–99", 422);
      }
    }
    if (
      (body.decision === "full_refund" || body.decision === "fraud_substantiated") &&
      body.refund_percentage_to_student != null &&
      body.refund_percentage_to_student !== 100
    ) {
      return errorResponse("Full refund decisions must have 100% refund", 422);
    }

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, d.booking_id))
      .limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    // Compute the naira amounts to settle for this dispute.
    const refundPct = body.decision === "dismissed"
      ? 0
      : body.decision === "partial_refund"
        ? body.refund_percentage_to_student!
        : 100;

    const refundAmountNgn = Math.round((booking.total_amount_ngn * refundPct) / 100);
    const releaseRemainderNgn = Math.max(0, booking.total_amount_ngn - refundAmountNgn);

    const paymentMethod = booking.payment_method ?? "paystack";
    const chargeReference = booking.payment_transaction_id ?? null;

    // Mark the dispute resolved. Booking state is set later — only after
    // every required leg has actually settled.
    await db
      .update(disputesTable)
      .set({
        adjudication_decision: body.decision,
        adjudication_notes: body.adjudication_notes,
        refund_percentage_to_student: refundPct,
        escrow_officer_id: officer.id,
        dispute_status: "resolved",
        resolved_at: new Date(),
      })
      .where(eq(disputesTable.id, id));

    await db
      .update(bookingsTable)
      .set({
        dispute_status: "resolved",
        dispute_adjudication_date: new Date(),
        dispute_outcome: body.decision,
        // Booking stays in `pending_review` until the legs settle.
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, d.booking_id));

    // Trust event consequences only fire on the dismissed / fraud branches.
    if (body.decision === "dismissed") {
      await deactivateTrustEvent(`dispute:${d.booking_id}`);
      await recordTrustEvent({
        userId: d.landlord_id,
        ruleKey: "transaction_completed",
        sourceType: "dispute",
        sourceId: id,
        dedupeKey: `transaction-completed:${d.booking_id}:landlord`,
        actorId: officer.id,
        reason: "Booking completed (dispute dismissed)",
      });
    } else if (body.decision === "fraud_substantiated") {
      await recordTrustEvent({
        userId: d.landlord_id,
        ruleKey: "fake_property_listing",
        sourceType: "dispute",
        sourceId: id,
        dedupeKey: `fraud-substantiated-dispute:${id}`,
        actorId: officer.id,
        reason: "Fraud substantiated via dispute adjudication",
      });
    }

    // Initiate the refund leg (if any). For Paystack charges, call the
    // Refund API and let the webhook confirm it. For bank-transfer
    // payments, create a `manual_review` row that an officer will confirm.
    let refundSettlement = null;
    if (refundAmountNgn > 0) {
      if (paymentMethod === "paystack" && chargeReference) {
        let refundId = `dispute:${id}:student`;
        try {
          const result = await initiateRefund({
            chargeReference,
            amountKobo: refundAmountNgn * 100,
            merchantReference: refundId,
          });
          refundId = result.reference ?? refundId;
        } catch (err: any) {
          // Refund initiation failed — keep the row pending so it can be
          // retried. The dispute is already recorded as resolved.
          console.error("paystack initiateRefund failed", err?.message ?? err);
        }
        refundSettlement = await recordSettlement({
          bookingId: d.booking_id,
          transactionType: "refund",
          receiptKind: "refund",
          paymentMethod: "paystack",
          amountNgn: refundAmountNgn,
          settlementKey: refundId,
          gateway: "paystack",
          gatewayReference: chargeReference,
          initiatedByUserId: officer.id,
          // The refund settles when the `refund.processed` webhook fires.
        });
      } else {
        // Bank-transfer booking — manual review. Settlement key encodes the
        // dispute so the officer's confirmation can match it.
        refundSettlement = await recordSettlement({
          bookingId: d.booking_id,
          transactionType: "refund",
          receiptKind: "refund",
          paymentMethod: "bank_transfer",
          amountNgn: refundAmountNgn,
          settlementKey: `dispute:${id}:student-refund`,
          initiatedByUserId: officer.id,
        });
      }
    }

    // Initiate the landlord release leg (if any). For dismissed disputes the
    // whole amount goes; for partial refunds the remainder; for full/fraud
    // there's no release.
    let releaseSettlement = null;
    if (releaseRemainderNgn > 0) {
      const releaseMethod: "paystack" | "bank_transfer" | "manual_bank_transfer" =
        paymentMethod === "paystack" || paymentMethod === "bank_transfer" || paymentMethod === "manual_bank_transfer"
          ? paymentMethod
          : "paystack";
      releaseSettlement = await recordSettlement({
        bookingId: d.booking_id,
        transactionType: "release",
        receiptKind: "release",
        paymentMethod: releaseMethod,
        amountNgn: releaseRemainderNgn,
        settlementKey: `dispute:${id}:landlord-release`,
        gateway: paymentMethod === "paystack" ? "paystack" : null,
        gatewayReference: chargeReference,
        initiatedByUserId: officer.id,
      });
    }

    await db.insert(auditLogTable).values({
      actor_id: officer.id,
      action_type: "dispute_adjudicated",
      resource_type: "dispute",
      resource_id: id,
      details: {
        decision: body.decision,
        booking_id: d.booking_id,
        refund_amount_ngn: refundAmountNgn,
        release_amount_ngn: releaseRemainderNgn,
        refund_settlement_id: refundSettlement?.transactionId ?? null,
        release_settlement_id: releaseSettlement?.transactionId ?? null,
      },
    });

    return jsonResponse({
      message: "Dispute adjudicated",
      refund_settlement: refundSettlement,
      release_settlement: releaseSettlement,
    });
  } catch (err) {
    return handleError(err, req);
  }
}