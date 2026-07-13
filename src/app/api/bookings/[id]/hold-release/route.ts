import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";

/**
 * POST /api/bookings/[id]/hold-release
 *
 * Escrow-officer action: place a booking's release on hold so the lazy
 * auto-release sweep skips it. The officer can still release early via the
 * `/release-escrow` override (force bypasses the hold). Sending
 * `{ release: true }` clears the hold.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") {
      return errorResponse("Only escrow officers can hold a release", 403);
    }
    const { id } = await params;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    let body: { release?: boolean } = {};
    try { body = await req.json(); } catch { /* empty body = hold */ }

    const releasing = body.release === true;
    await db
      .update(bookingsTable)
      .set({
        release_held_by_officer_at: releasing ? null : new Date(),
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, id));

    await db.insert(auditLogTable).values({
      actor_id: officer.id,
      action_type: releasing ? "escrow_hold_cleared" : "escrow_hold_set",
      resource_type: "booking",
      resource_id: id,
    });

    return jsonResponse({ held: !releasing });
  } catch (err) {
    return handleError(err, req);
  }
}
