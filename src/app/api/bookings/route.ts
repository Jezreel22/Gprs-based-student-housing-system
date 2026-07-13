import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, or, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, propertiesTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { maybeReleaseDueBookings } from "@/lib/payout";
import type { BookingDetail, LandlordSummary } from "@/api/generated/api.schemas";

const CreateBookingBody = z.object({
  property_id: z.string().uuid(),
  // `paystack` is the live gateway; `bank_transfer` is the manual/offline path.
  payment_method: z.enum(["paystack", "bank_transfer"]),
  lease_start_date: z.string(),
  lease_duration_days: z.number().int().min(30).max(730),
});

function generateEscrowRef(): string {
  return "ESC-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function GET(req: NextRequest) {
  try {
    // Lazy escrow sweep — release any due bookings on each dashboard load.
    // Self-healing, never throws (see payout.maybeReleaseDueBookings).
    void maybeReleaseDueBookings();

    const me = await requireAuth(req);

    const rows = await db.select().from(bookingsTable)
      .where(or(eq(bookingsTable.student_id, me.id), eq(bookingsTable.landlord_id, me.id)))
      .orderBy(desc(bookingsTable.created_at));

    const propertyIds = Array.from(new Set(rows.map((b) => b.property_id)));
    const userIds = Array.from(new Set([
      ...rows.map((b) => b.student_id),
      ...rows.map((b) => b.landlord_id),
    ]));

    const [properties, allUsers] = await Promise.all([
      propertyIds.length > 0
        ? db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
        : Promise.resolve([]),
      userIds.length > 0
        ? db.select().from(usersTable).where(inArray(usersTable.id, userIds))
        : Promise.resolve([]),
    ]);

    const propMap = new Map(properties.map((p) => [p.id, p]));
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const summary = (uid: string): LandlordSummary | undefined => {
      const u = userMap.get(uid);
      if (!u) return undefined;
      return {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role,
        verification_status: u.verification_status,
      };
    };

    const data: BookingDetail[] = rows.map((b) => {
      const prop = propMap.get(b.property_id);
      return {
        id: b.id,
        student_id: b.student_id,
        property_id: b.property_id,
        landlord_id: b.landlord_id,
        lease_start_date: b.lease_start_date ?? null,
        lease_duration_days: b.lease_duration_days ?? null,
        rent_amount_ngn: b.rent_amount_ngn,
        deposit_amount_ngn: b.deposit_amount_ngn,
        total_amount_ngn: b.total_amount_ngn,
        escrow_account_reference: b.escrow_account_reference ?? null,
        payment_method: b.payment_method ?? null,
        booking_status: b.booking_status ?? "pending_payment",
        dispute_status: b.dispute_status ?? null,
        occupancy_verified_at: b.occupancy_verified_at?.toISOString() ?? null,
        escrow_released_at: b.escrow_released_at?.toISOString() ?? null,
        created_at: b.created_at?.toISOString() ?? null,
        property: prop ? {
          id: prop.id,
          address: prop.address,
          rent_amount_ngn: prop.rent_amount_ngn,
          deposit_amount_ngn: prop.deposit_amount_ngn,
          rooms: prop.rooms ?? 1,
          listing_status: prop.listing_status ?? "draft",
        } : undefined,
        student: summary(b.student_id),
        landlord: summary(b.landlord_id),
      };
    });

    return jsonResponse(data);
  } catch (err) {
    return handleError(err, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    if (me.role !== "student") return errorResponse("Only students can book", 403);

    const body = await parseBody(req, CreateBookingBody);

    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, body.property_id)).limit(1);
    if (!property) return errorResponse("Property not found", 404);
    if (property.listing_status !== "live") return errorResponse("Property is not available", 409);
    if (property.landlord_id === me.id) return errorResponse("Cannot book your own property", 409);

    const monthlyRent = property.rent_amount_ngn;
    const deposit = property.deposit_amount_ngn;
    const totalMonths = Math.ceil(body.lease_duration_days / 30);
    const total = monthlyRent * totalMonths + deposit;
    const leaseEnd = new Date(body.lease_start_date);
    leaseEnd.setDate(leaseEnd.getDate() + body.lease_duration_days);

    const [booking] = await db.insert(bookingsTable).values({
      student_id: me.id,
      property_id: property.id,
      landlord_id: property.landlord_id,
      lease_start_date: body.lease_start_date,
      lease_duration_days: body.lease_duration_days,
      lease_end_date: leaseEnd.toISOString().split("T")[0],
      rent_amount_ngn: monthlyRent,
      deposit_amount_ngn: deposit,
      total_amount_ngn: total,
      escrow_account_reference: generateEscrowRef(),
      payment_method: body.payment_method,
      funds_received_at: body.payment_method === "bank_transfer" ? new Date() : null,
      booking_status: body.payment_method === "bank_transfer" ? "pending_occupancy" : "pending_payment",
    }).returning();

    return jsonResponse(booking, { status: 201 });
  } catch (err) {
    return handleError(err, req);
  }
}