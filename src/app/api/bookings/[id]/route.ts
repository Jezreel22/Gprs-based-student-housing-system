import { NextRequest } from "next/server";
import { eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, propertiesTable, propertyPhotosTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { maybeReleaseDueBookings } from "@/lib/payout";
import type { BookingDetail, LandlordSummary } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Lazy escrow sweep — release any due bookings when a booking is viewed.
    void maybeReleaseDueBookings();

    const me = await requireAuth(req);
    const { id } = await params;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    // Only the student, the landlord, or an escrow_officer can view
    if (booking.student_id !== me.id && booking.landlord_id !== me.id && me.role !== "escrow_officer") {
      return errorResponse("Not authorized to view this booking", 403);
    }

    const [prop, student, landlord, heroPhoto] = await Promise.all([
      db.select().from(propertiesTable).where(eq(propertiesTable.id, booking.property_id)).limit(1).then((r) => r[0]),
      db.select().from(usersTable).where(eq(usersTable.id, booking.student_id)).limit(1).then((r) => r[0]),
      db.select().from(usersTable).where(eq(usersTable.id, booking.landlord_id)).limit(1).then((r) => r[0]),
      // First photo (lowest photo_order) for the booking hero thumbnail.
      db.select({ photo_url: propertyPhotosTable.photo_url })
        .from(propertyPhotosTable)
        .where(eq(propertyPhotosTable.property_id, booking.property_id))
        .orderBy(asc(propertyPhotosTable.photo_order))
        .limit(1)
        .then((r) => r[0]?.photo_url ?? null),
    ]);

    const summary = (u: typeof student): LandlordSummary | undefined => {
      if (!u) return undefined;
      return {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role,
        verification_status: u.verification_status,
      };
    };

    const response: BookingDetail = {
      id: booking.id,
      student_id: booking.student_id,
      property_id: booking.property_id,
      landlord_id: booking.landlord_id,
      lease_start_date: booking.lease_start_date ?? null,
      lease_duration_days: booking.lease_duration_days ?? null,
      rent_amount_ngn: booking.rent_amount_ngn,
      deposit_amount_ngn: booking.deposit_amount_ngn,
      total_amount_ngn: booking.total_amount_ngn,
      escrow_account_reference: booking.escrow_account_reference ?? null,
      payment_method: booking.payment_method ?? null,
      booking_status: booking.booking_status ?? "pending_payment",
      dispute_status: booking.dispute_status ?? null,
      occupancy_verified_at: booking.occupancy_verified_at?.toISOString() ?? null,
      escrow_released_at: booking.escrow_released_at?.toISOString() ?? null,
      // New escrow-release tracking fields (Phase: real Paystack escrow).
      payout_transfer_reference: booking.payout_transfer_reference ?? null,
      payout_initiated_at: booking.payout_initiated_at?.toISOString() ?? null,
      payout_attempts: booking.payout_attempts ?? 0,
      payout_error: booking.payout_error ?? null,
      release_held_by_officer_at: booking.release_held_by_officer_at?.toISOString() ?? null,
      created_at: booking.created_at?.toISOString() ?? null,
      property: prop ? {
        id: prop.id,
        address: prop.address,
        rent_amount_ngn: prop.rent_amount_ngn,
        deposit_amount_ngn: prop.deposit_amount_ngn,
        rooms: prop.rooms ?? 1,
        listing_status: prop.listing_status ?? "draft",
        hero_photo_url: heroPhoto,
        // The 6-character code the student must enter to confirm move-in.
        // Exposed ONLY to the landlord (and the escrow officer for support).
        // Never to the student — they have to receive it from the landlord.
        occupancy_code: (me.id === booking.landlord_id || me.role === "escrow_officer") ? prop.occupancy_code : undefined,
      } : undefined,
      student: summary(student),
      landlord: summary(landlord),
    };

    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}