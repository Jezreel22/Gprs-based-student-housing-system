import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookingAdminNotesTable, bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

const Body = z.object({
  note: z.string().trim().min(1).max(2000),
});

/**
 * POST /api/admin/bookings/[id]/notes
 *
 * Append an internal note to a booking. Notes are immutable — there is no
 * UPDATE or DELETE path in code (and the API surface intentionally only
 * exposes POST). Returns the inserted row including its id and timestamp so
 * the UI can prepend it without a refetch.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const { id } = await params;
    const body = await parseBody(req, Body);

    const [booking] = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    const [inserted] = await db
      .insert(bookingAdminNotesTable)
      .values({
        booking_id: id,
        officer_id: officer.id,
        note: body.note,
      })
      .returning();

    await writeAudit({
      req,
      actorId: officer.id,
      actionType: "booking_note_added",
      resourceType: "booking",
      resourceId: id,
      details: { note_id: inserted.id, note_length: body.note.length },
    });

    return jsonResponse({
      note: {
        id: inserted.id,
        note: inserted.note,
        officer_id: inserted.officer_id,
        created_at: inserted.created_at?.toISOString() ?? null,
      },
    });
  } catch (err) {
    return handleError(err, req);
  }
}

/**
 * GET /api/admin/bookings/[id]/notes
 *
 * List notes for a booking, newest first. Mirrors the shape returned by the
 * detail endpoint, but standalone so the drawer can refetch just notes.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const { id } = await params;

    const rows = await db
      .select({
        id: bookingAdminNotesTable.id,
        note: bookingAdminNotesTable.note,
        officer_id: bookingAdminNotesTable.officer_id,
        created_at: bookingAdminNotesTable.created_at,
      })
      .from(bookingAdminNotesTable)
      .where(eq(bookingAdminNotesTable.booking_id, id))
      .orderBy(desc(bookingAdminNotesTable.created_at));

    return jsonResponse({ notes: rows.map((r) => ({ ...r, created_at: r.created_at?.toISOString() ?? null })) });
  } catch (err) {
    return handleError(err, req);
  }
}
