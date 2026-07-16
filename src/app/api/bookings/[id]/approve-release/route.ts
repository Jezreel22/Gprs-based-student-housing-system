import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { releaseBookingEscrow, PayoutError } from "@/lib/payout";

/**
 * POST /api/bookings/[id]/approve-release
 *
 * Student authorizes the escrow release. This is the core of escrow: the tenant
 * (not the landlord) approves, the app records the approval, and Paystack moves
 * the money. Only the booking's student can call this, and only from
 * `pending_review` (i.e. they've already confirmed move-in). Guards (dispute /
 * hold) still apply — an officer uses the force-override endpoint for support.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.student_id !== me.id) {
      return errorResponse("Only the tenant can approve the escrow release", 403);
    }

    try {
      const result = await releaseBookingEscrow(id, {
        actorId: me.id,
        reason: "student_approved",
      });
      return jsonResponse({
        message: result.idempotent ? "Already released" : "Release initiated",
        reference: result.reference ?? null,
      });
    } catch (e) {
      if (e instanceof PayoutError) {
        const status =
          e.code === "not_found" ? 404 :
          e.code === "no_payout_details" ? 409 :
          e.code === "transfer_failed" ? 502 : 409;
        return errorResponse(e.message, status, { code: e.code });
      }
      throw e;
    }
  } catch (err) {
    return handleError(err, req);
  }
}
