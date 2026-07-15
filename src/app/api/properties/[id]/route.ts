import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, usersTable, propertyPhotosTable, ratingsTable, bookingsTable, trustScoresTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { formatTrustScore } from "@/lib/format";
import type { PropertyDetail, RatingDetail } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;

    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!property) return errorResponse("Property not found", 404);

    const [landlord] = await db.select().from(usersTable).where(eq(usersTable.id, property.landlord_id)).limit(1);
    const [trust] = await db.select().from(trustScoresTable).where(eq(trustScoresTable.user_id, property.landlord_id)).limit(1);
    const photos = await db.select().from(propertyPhotosTable).where(eq(propertyPhotosTable.property_id, id));

    // Ratings are tied to bookings, not properties directly — join through bookings
    const propBookings = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(eq(bookingsTable.property_id, id));
    const bookingIds = propBookings.map((b) => b.id);
    const propRatings = bookingIds.length > 0
      ? await db.select().from(ratingsTable).where(inArray(ratingsTable.booking_id, bookingIds))
      : [];

    const raterIds = Array.from(new Set(propRatings.map((r) => r.rater_id)));
    const raters = raterIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, raterIds))
      : [];
    const raterMap = new Map(raters.map((r) => [r.id, r]));

    const ratingsFormatted: RatingDetail[] = propRatings.map((r) => {
      const rater = raterMap.get(r.rater_id);
      return {
        id: r.id,
        booking_id: r.booking_id,
        rater_id: r.rater_id,
        ratee_id: r.ratee_id,
        rating_type: r.rating_type,
        stars: r.stars,
        review_text: r.review_text ?? null,
        rater: rater ? {
          id: rater.id,
          first_name: rater.first_name,
          last_name: rater.last_name,
          role: rater.role,
          verification_status: rater.verification_status,
        } : undefined,
        created_at: r.created_at?.toISOString() ?? null,
      };
    });

    const response: PropertyDetail = {
      id: property.id,
      landlord_id: property.landlord_id,
      address: property.address,
      latitude: property.latitude ?? null,
      longitude: property.longitude ?? null,
      rent_amount_ngn: property.rent_amount_ngn,
      deposit_amount_ngn: property.deposit_amount_ngn,
      lease_duration_days: property.lease_duration_days ?? null,
      rooms: property.rooms ?? 1,
      amenities: property.amenities ?? {},
      house_rules: property.house_rules ?? null,
      description: property.description ?? null,
      listing_status: property.listing_status ?? "draft",
      geolocation_verified_at: property.geolocation_verified_at?.toISOString() ?? null,
      published_at: property.published_at?.toISOString() ?? null,
      created_at: property.created_at?.toISOString() ?? null,
      landlord: landlord ? {
        id: landlord.id,
        role: landlord.role,
        first_name: landlord.first_name,
        last_name: landlord.last_name,
        profile_photo_url: landlord.profile_photo_url,
        verification_status: landlord.verification_status,
        account_suspended: landlord.account_suspended,
        phone_number: landlord.phone_number,
        suspension_reason: landlord.suspension_reason,
        created_at: landlord.created_at?.toISOString() ?? null,
        trust_score: formatTrustScore(trust),
      } : undefined,
      trust_score: trust?.total_score ?? 0,
      photos: photos.map((p) => ({
        id: p.id,
        photo_url: p.photo_url,
        photo_order: p.photo_order ?? 0,
      })),
      ratings: ratingsFormatted,
    };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}

const UpdatePropertyBody = z.object({
  address: z.string().optional(),
  rent_amount_ngn: z.number().int().positive().optional(),
  deposit_amount_ngn: z.number().int().positive().optional(),
  lease_duration_days: z.number().int().min(30).optional(),
  rooms: z.number().int().min(1).max(20).optional(),
  amenities: z.record(z.boolean()).optional(),
  house_rules: z.string().optional(),
  description: z.string().optional(),
});

// Listing-status changes go through the publish/approve endpoints, not PUT.
// Landlords cannot self-approve.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;

    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!property) return errorResponse("Property not found", 404);
    if (property.landlord_id !== me.id && me.role !== "escrow_officer") {
      return errorResponse("Not your listing", 403);
    }

    const body = await parseBody(req, UpdatePropertyBody);
    await db.update(propertiesTable)
      .set({ ...body, updated_at: new Date() })
      .where(eq(propertiesTable.id, id));

    const [updated] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    return jsonResponse(updated);
  } catch (err) {
    return handleError(err, req);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;

    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!property) return errorResponse("Property not found", 404);
    if (property.landlord_id !== me.id && me.role !== "escrow_officer") {
      return errorResponse("Not your listing", 403);
    }

    // A property with bookings can't be hard-deleted — bookings (and their
    // escrow/audit trail) reference it and must be preserved. Photos cascade,
    // so a listing with no bookings deletes cleanly.
    const related = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(eq(bookingsTable.property_id, id)).limit(1);
    if (related.length > 0) {
      return errorResponse(
        "This property has bookings and can't be deleted. Unpublish it instead to keep the booking history.",
        409,
      );
    }

    await db.delete(propertiesTable).where(eq(propertiesTable.id, id));
    return jsonResponse({ message: "Listing removed" });
  } catch (err) {
    return handleError(err, req);
  }
}