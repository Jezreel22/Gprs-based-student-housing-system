import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, propertyRatingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";

const CreatePropertyRatingBody = z.object({
  booking_id: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  review_text: z.string().max(2000).optional(),
});

/**
 * Student rates the *property* on a completed stay. The property id comes from
 * the route (`[id]`); the booking must belong to this property, to the caller,
 * and be completed. `(booking_id, rater_id)` is unique on the table, so this
 * is idempotent if the student already rated via the listing page — the
 * existing row is returned.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id: propertyId } = await params;
    const body = await parseBody(req, CreatePropertyRatingBody);

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, body.booking_id))
      .limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.property_id !== propertyId) {
      return errorResponse("This booking is not for this property", 400);
    }
    // Only the student who booked can rate the property; only after completion.
    if (booking.student_id !== me.id) {
      return errorResponse("Not authorized to rate this booking", 403);
    }
    if (booking.booking_status !== "completed") {
      return errorResponse("You can rate the property after the booking is completed", 400);
    }

    const [row] = await db
      .insert(propertyRatingsTable)
      .values({
        property_id: propertyId,
        booking_id: booking.id,
        rater_id: me.id,
        stars: body.stars,
        review_text: body.review_text ?? null,
      })
      .onConflictDoNothing({ target: [propertyRatingsTable.booking_id, propertyRatingsTable.rater_id] })
      .returning();

    // If there was no insert (conflict — already rated), fetch the existing one
    // so callers get the row regardless of which path they used first.
    const rating = row
      ? row
      : (await db
          .select()
          .from(propertyRatingsTable)
          .where(and(
            eq(propertyRatingsTable.booking_id, booking.id),
            eq(propertyRatingsTable.rater_id, me.id),
          ))
          .limit(1))[0];

    return jsonResponse(rating, { status: row ? 201 : 200 });
  } catch (err) {
    return handleError(err, req);
  }
}
