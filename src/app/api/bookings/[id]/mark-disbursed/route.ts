import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { markBookingDisbursed } from "@/lib/payment-marks";

const Body = z.object({
  // Optional reference for the manual bank-transfer receipt / transaction id.
  reference: z.string().max(100).optional(),
});

/**
 * POST /api/bookings/[id]/mark-disbursed
 *
 * Escrow-officer confirmation that a platform-managed payout was actually sent
 * to the landlord (the owner made the manual bank transfer). Completes the
 * booking. Only valid on a `release_pending` booking — i.e. the student has
 * already approved the release.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const { id } = await params;
    const body = await parseBody(req, Body);

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.booking_status !== "release_pending") {
      return errorResponse("Booking is not awaiting disbursement", 409);
    }

    const ok = await markBookingDisbursed({ bookingId: id, officerId: officer.id, reference: body.reference ?? null });
    return jsonResponse({ message: ok ? "Marked as disbursed" : "Already disbursed" });
  } catch (err) {
    return handleError(err, req);
  }
}
