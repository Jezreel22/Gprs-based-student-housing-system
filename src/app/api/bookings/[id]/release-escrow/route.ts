import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { releaseBookingEscrow, PayoutError } from "@/lib/payout";

/**
 * POST /api/bookings/[id]/release-escrow
 *
 * Escrow-officer override: initiate the landlord payout immediately, bypassing
 * the review window / hold / dispute guards. The lazy auto-release uses the
 * same helper without `force`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") {
      return errorResponse("Only escrow officers can release escrow", 403);
    }
    const { id } = await params;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    try {
      const result = await releaseBookingEscrow(id, {
        force: true,
        actorId: officer.id,
        reason: "officer_override",
      });
      return jsonResponse({ message: result.idempotent ? "Already released" : "Release initiated", reference: result.reference ?? null });
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
