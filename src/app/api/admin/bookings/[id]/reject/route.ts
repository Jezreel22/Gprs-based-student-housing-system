import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertTransitionAllowed } from "@/lib/escrow/transitions";

const Body = z.object({
  reason: z.string().trim().min(10).max(2000),
});

/**
 * POST /api/admin/bookings/[id]/reject
 *
 * Officer cancels a pre-disbursement booking with a documented reason. Flips
 * the booking to `cancelled` and stores the reason in `escrow_release_reason`
 * (the column already exists; it's reused here so we don't need a new column
 * for the rejection rationale). The transition guard rejects terminal states
 * (`completed`, `cancelled`).
 *
 * This is intentionally narrow: it doesn't refund anyone automatically. The
 * dispute path (`/api/disputes/[id]/adjudicate`) handles refund decisions.
 * Reject here = cancel the escrow and surface it for the dispute flow to
 * settle money movement.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Only escrow officers can reject escrow", 403);
    const { id } = await params;
    const body = await parseBody(req, Body);

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    const currentStatus = booking.booking_status ?? "pending_payment";

    // Rejecting a booking is a `current → cancelled` transition. The guard
    // enforces the same rule from any non-terminal state.
    assertTransitionAllowed(currentStatus, "cancelled");

    // Conditional update: only flip if the status is still the one we read.
    // A concurrent approve/disburse that just landed will return zero rows
    // and we surface it as a 409.
    const updated = await db
      .update(bookingsTable)
      .set({
        booking_status: "cancelled",
        escrow_release_reason: body.reason,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(bookingsTable.id, id),
          eq(bookingsTable.booking_status, currentStatus),
        ),
      )
      .returning({ id: bookingsTable.id });

    if (updated.length === 0) {
      return errorResponse("Booking changed concurrently — refresh and try again", 409);
    }

    await writeAudit({
      req,
      actorId: officer.id,
      actionType: "escrow_rejected",
      resourceType: "booking",
      resourceId: id,
      previousStatus: currentStatus,
      newStatus: "cancelled",
      details: { reason: body.reason },
    });

    return jsonResponse({ booking_status: "cancelled" });
  } catch (err) {
    return handleError(err, req);
  }
}
