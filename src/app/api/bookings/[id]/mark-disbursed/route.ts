import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, uploadsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { markBookingDisbursed } from "@/lib/payment-marks";

// Receipt must be a real image of the bank transfer. Mirrors the limits on
// the general /api/upload route so behaviour is consistent.
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/bookings/[id]/mark-disbursed
 *
 * Escrow-officer confirmation that a platform-managed payout was actually sent
 * to the landlord (the owner made the manual bank transfer). Completes the
 * booking. Only valid on a `release_pending` booking — i.e. the student has
 * already approved the release.
 *
 * The officer MUST attach a `receipt` image (multipart/form-data) — a screenshot
 * of the bank transfer. The receipt is stored in `uploads` and its id is linked
 * to the booking so the proof of payment is part of the immutable audit trail,
 * not an honor-system claim. This prevents an officer from marking a booking
 * disbursed without actually sending the money.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const { id } = await params;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.booking_status !== "release_pending") {
      return errorResponse("Booking is not awaiting disbursement", 409);
    }

    const form = await req.formData();
    const receipt = form.get("receipt");
    if (!(receipt instanceof File)) {
      return errorResponse("A receipt image of the bank transfer is required", 400);
    }
    if (!ALLOWED_MIME.has(receipt.type)) {
      return errorResponse(`Unsupported file type: ${receipt.type}. Allowed: JPG, PNG, WebP, GIF.`, 415);
    }
    if (receipt.size === 0) {
      return errorResponse("Receipt image is empty", 400);
    }
    if (receipt.size > MAX_BYTES) {
      return errorResponse(`Receipt too large. Max ${MAX_BYTES / 1024 / 1024} MB.`, 413);
    }

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

    const ok = await markBookingDisbursed({
      bookingId: id,
      officerId: officer.id,
      receiptUploadId: upload.id,
    });

    if (!ok) {
      // A concurrent call completed the booking between our pre-check and this
      // write. Roll the orphaned receipt back so we don't accumulate dead rows.
      await db.delete(uploadsTable).where(eq(uploadsTable.id, upload.id)).catch(() => {});
      return jsonResponse({ message: "Already disbursed" });
    }

    return jsonResponse({ message: "Marked as disbursed" });
  } catch (err) {
    return handleError(err, req);
  }
}
