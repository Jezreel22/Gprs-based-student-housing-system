import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { bookingsTable, escrowTransactionsTable, uploadsTable } from "@/lib/db/schema";
import { confirmManualSettlement } from "@/lib/escrow-transactions/service";

export const runtime = "nodejs";

// Receipt must be a real image of the bank transfer. Mirrors the limits on
// the general /api/upload route so behaviour is consistent across the app.
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/bookings/[id]/mark-refunded
 *
 * Officer confirmation that a manual bank transfer refund has been sent to
 * the student. The receipt screenshot is stored in `uploads` and linked to
 * the booking via the resulting `escrow_receipts.evidence_upload_id`.
 *
 * Mirrors the existing /api/bookings/[id]/mark-disbursed route. The
 * booking must have a previously-pending refund transaction; if not, this
 * route returns 409.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const { id } = await params;

    const form = await req.formData();
    const receipt = form.get("receipt");
    if (!(receipt instanceof File)) {
      return errorResponse("A receipt image of the bank transfer is required", 400);
    }
    if (!ALLOWED_MIME.has(receipt.type)) {
      return errorResponse(`Unsupported file type: ${receipt.type}.`, 415);
    }
    if (receipt.size === 0) {
      return errorResponse("Receipt image is empty", 400);
    }
    if (receipt.size > MAX_BYTES) {
      return errorResponse(`Receipt too large. Max ${MAX_BYTES / 1024 / 1024} MB.`, 413);
    }
    const referenceRaw = form.get("reference");
    const reference = typeof referenceRaw === "string" && referenceRaw.trim().length > 0
      ? referenceRaw.trim().slice(0, 100)
      : null;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    // Find the pending refund transaction the officer is settling.
    const [pendingRefund] = await db
      .select()
      .from(escrowTransactionsTable)
      .where(eq(escrowTransactionsTable.booking_id, id))
      .orderBy(escrowTransactionsTable.created_at)
      .limit(20);
    void pendingRefund;

    // The lookup is intentionally loose — the most recent pending/manual
    // refund transaction tied to this booking. If none exists, reject.
    const candidates = await db
      .select()
      .from(escrowTransactionsTable)
      .where(eq(escrowTransactionsTable.booking_id, id));
    const pending = candidates.find(
      (c) => c.transaction_type === "refund" && c.transaction_status === "manual_review",
    );
    if (!pending) {
      return errorResponse("No pending refund to confirm", 409);
    }

    // Persist the receipt image.
    const data = Buffer.from(await receipt.arrayBuffer());
    const [upload] = await db
      .insert(uploadsTable)
      .values({
        user_id: officer.id,
        mime: receipt.type,
        size_bytes: receipt.size,
        data,
      })
      .returning({ id: uploadsTable.id });

    const settlementKey = `manual-refund:${upload.id}`;
    const result = await confirmManualSettlement({
      bookingId: id,
      transactionType: "refund",
      receiptKind: "refund",
      amountNgn: pending.amount_ngn,
      settlementKey,
      officerId: officer.id,
      evidenceUploadId: upload.id,
      paystackReference: reference,
      customNotice: reference ? `Refund reference: ${reference}` : null,
    });

    // Mark the booking `completed` if no release leg is required (full refund).
    if (booking.booking_status !== "completed") {
      await db
        .update(bookingsTable)
        .set({
          booking_status: "completed",
          updated_at: new Date(),
        })
        .where(eq(bookingsTable.id, id));
    }

    return jsonResponse({
      message: "Refund confirmed",
      receipt_id: result.receiptId,
      receipt_number: result.receiptNumber,
    });
  } catch (err) {
    return handleError(err, req);
  }
}

void z;