import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogTable, disputesTable, bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { deactivateTrustEvent, recordTrustEvent } from "@/lib/trust/service";

const AdjudicateBody = z.object({
  decision: z.enum(["dismissed", "partial_refund", "full_refund", "fraud_substantiated"]),
  adjudication_notes: z.string().min(10),
  refund_percentage_to_student: z.number().int().min(0).max(100).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") throw new Error("Forbidden");
    const { id } = await params;
    const [d] = await db.select().from(disputesTable).where(eq(disputesTable.id, id)).limit(1);
    if (!d) return errorResponse("Dispute not found", 404);
    if (d.dispute_status === "resolved") return errorResponse("Dispute has already been resolved", 409);

    const body = await parseBody(req, AdjudicateBody);

    await db.update(disputesTable)
      .set({
        adjudication_decision: body.decision,
        adjudication_notes: body.adjudication_notes,
        refund_percentage_to_student: body.refund_percentage_to_student ?? null,
        escrow_officer_id: officer.id,
        dispute_status: "resolved",
        resolved_at: new Date(),
      })
      .where(eq(disputesTable.id, id));

    // Update the booking's status + dispute_outcome + (eventually) release escrow
    const newBookingStatus = body.decision === "fraud_substantiated"
      ? "cancelled"
      : "completed"; // dismissed / partial / full refund all close the booking

    const escrowReleased = body.decision === "dismissed" || body.decision === "partial_refund" || body.decision === "full_refund";

    await db.update(bookingsTable)
      .set({
        dispute_status: "resolved",
        dispute_adjudication_date: new Date(),
        dispute_outcome: body.decision,
        booking_status: newBookingStatus,
        escrow_released_at: escrowReleased ? new Date() : null,
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, d.booking_id));

    // ── Trust event consequences ──────────────────────────────────────────────
    if (body.decision === "dismissed") {
      // Dispute was unfounded — reverse the -15 penalty the landlord took when
      // the student filed. The lease also completed, so award the bonus.
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
      // The landlord committed fraud — apply the heavier fake-listing penalty on
      // top of the transaction_dispute event that already landed when the student
      // filed. Use the dispute id in the dedupe key so this is distinct from a
      // report-sourced fake_property_listing event.
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

    await db.insert(auditLogTable).values({
      actor_id: officer.id,
      action_type: "dispute_adjudicated",
      resource_type: "dispute",
      resource_id: id,
      details: { decision: body.decision, booking_id: d.booking_id },
    });

    return jsonResponse({ message: "Dispute adjudicated" });
  } catch (err) {
    return handleError(err, req);
  }
}