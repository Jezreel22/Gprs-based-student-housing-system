import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ratingsTable, bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse, getQueryParams, getIntParam } from "@/lib/api";
import type { RatingDetail } from "@/api/generated/api.schemas";

const CreateRatingBody = z.object({
  booking_id: z.string().uuid(),
  ratee_id: z.string().uuid(),
  rating_type: z.enum(["student_rates_landlord", "landlord_rates_student"]),
  stars: z.number().int().min(1).max(5),
  review_text: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const params = getQueryParams(req);
    const rateeId = params.get("ratee_id");
    const limit = getIntParam(params, "limit", 20);

    // If ratee_id given, fetch ratings about that user; otherwise most-recent global.
    const rows = rateeId
      ? await db.select().from(ratingsTable).where(eq(ratingsTable.ratee_id, rateeId)).limit(limit)
      : await db.select().from(ratingsTable).limit(limit);

    const data: RatingDetail[] = rows.map((r) => ({
      id: r.id,
      booking_id: r.booking_id,
      rater_id: r.rater_id,
      ratee_id: r.ratee_id,
      rating_type: r.rating_type,
      stars: r.stars,
      review_text: r.review_text ?? null,
      created_at: r.created_at?.toISOString() ?? null,
    }));

    return jsonResponse(data);
  } catch (err) {
    return handleError(err, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const body = await parseBody(req, CreateRatingBody);

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, body.booking_id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.student_id !== me.id && booking.landlord_id !== me.id) {
      return errorResponse("Not authorized to rate this booking", 403);
    }

    const [rating] = await db.insert(ratingsTable).values({
      booking_id: body.booking_id,
      rater_id: me.id,
      ratee_id: body.ratee_id,
      rating_type: body.rating_type,
      stars: body.stars,
      review_text: body.review_text ?? null,
    }).returning();

    return jsonResponse(rating, { status: 201 });
  } catch (err) {
    return handleError(err, req);
  }
}