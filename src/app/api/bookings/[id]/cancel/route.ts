import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { recordTrustEvent } from "@/lib/trust/service";

const Body = z.object({ reason: z.string().min(5).max(500) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    const body = await parseBody(req, Body);
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.student_id !== me.id) return errorResponse("Only the student can cancel this booking", 403);
    if (booking.booking_status !== "pending_payment") return errorResponse("Only unpaid bookings can be cancelled", 409);
    await db.update(bookingsTable).set({ booking_status: "cancelled", updated_at: new Date() }).where(eq(bookingsTable.id, id));
    await db.update(usersTable).set({ cancellation_count: (me.cancellation_count ?? 0) + 1, updated_at: new Date() }).where(eq(usersTable.id, me.id));
    await recordTrustEvent({ userId: me.id, ruleKey: "booking_cancellation", sourceType: "booking", sourceId: id, dedupeKey: `booking-cancelled:${id}`, actorId: me.id, details: { reason: body.reason } });
    return jsonResponse({ message: "Booking cancelled" });
  } catch (err) { return handleError(err, req); }
}
