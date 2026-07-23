import { NextRequest } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

const Body = z.object({
  /**
   * Set `true` to flag the booking as under verification, `false` to clear the
   * flag. We accept a body so the UI doesn't need two endpoints and so we
   * always have an audit row.
   */
  under_verification: z.boolean(),
  note: z.string().trim().min(1).max(2000).optional(),
});

/**
 * POST /api/admin/bookings/[id]/verify
 *
 * Officer toggles the "Under verification" flag. Only valid on bookings
 * currently in `pending_occupancy` — funds are in escrow awaiting either an
 * automatic gateway confirmation (Paystack) or officer sign-off (bank
 * transfer / webhook gaps). State transition guard rejects anything else
 * with 409.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Only escrow officers can verify escrow", 403);
    const { id } = await params;
    const body = await parseBody(req, Body);

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    // The flag is meaningful only while funds are held but the lifecycle hasn't
    // moved past `pending_occupancy`. Once verified (→ `pending_review`) it
    // stays set or clears at the officer's discretion — but it cannot be set
    // again on a `completed`/`cancelled` booking.
    if (booking.booking_status !== "pending_occupancy") {
      return errorResponse(
        `Cannot toggle verification: booking is "${booking.booking_status}". Only bookings awaiting verification (pending_occupancy) can be flagged.`,
        409,
      );
    }

    // Idempotent: if the flag is already in the desired state, return ok
    // without an audit row (no real action happened).
    const wasSet = booking.under_verification_by_officer_at != null;
    if (wasSet === body.under_verification) {
      return jsonResponse({
        under_verification: wasSet,
        idempotent: true,
      });
    }

    const next = body.under_verification ? new Date() : null;
    const updated = await db
      .update(bookingsTable)
      .set({ under_verification_by_officer_at: next, updated_at: new Date() })
      .where(
        and(
          eq(bookingsTable.id, id),
          eq(bookingsTable.booking_status, "pending_occupancy"),
        ),
      )
      .returning({ id: bookingsTable.id });

    if (updated.length === 0) {
      // Lost a race with another officer — surface as conflict so the UI can
      // refetch and re-evaluate.
      return errorResponse("Booking changed concurrently — refresh and try again", 409);
    }

    await writeAudit({
      req,
      actorId: officer.id,
      actionType: body.under_verification ? "escrow_under_verification_set" : "escrow_under_verification_cleared",
      resourceType: "booking",
      resourceId: id,
      previousStatus: booking.booking_status ?? null,
      newStatus: booking.booking_status ?? null,
      details: { note: body.note ?? null, flag: body.under_verification },
    });

    return jsonResponse({ under_verification: body.under_verification, idempotent: false });
  } catch (err) {
    return handleError(err, req);
  }
}
