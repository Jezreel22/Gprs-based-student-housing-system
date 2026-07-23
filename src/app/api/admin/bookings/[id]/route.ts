import { NextRequest } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogTable,
  bookingAdminNotesTable,
  bookingsTable,
  propertiesTable,
  propertyPhotosTable,
  trustScoresTable,
  usersTable,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/escrow/transitions";

/**
 * GET /api/admin/bookings/[id]
 *
 * Full per-transaction detail for the admin ledger drawer. Returns the booking,
 * property, both participants (incl. profile_photo_url, verification_status,
 * payout bank), the property's first photo, the trust score of the landlord
 * (officer needs it for the rejection/verify dialog), the list of admin notes
 * (chronological), and the audit trail (chronological). The audit list is
 * scoped to this booking — we filter on `resource_type = 'booking'` AND
 * `resource_id = id`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);

    const { id } = await params;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id))
      .limit(1);
    if (!booking) return errorResponse("Booking not found", 404);

    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, booking.property_id))
      .limit(1);

    const [student, landlord] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, booking.student_id)).limit(1).then((r) => r[0]),
      db.select().from(usersTable).where(eq(usersTable.id, booking.landlord_id)).limit(1).then((r) => r[0]),
    ]);

    const photos = await db
      .select({ id: propertyPhotosTable.id, photo_url: propertyPhotosTable.photo_url, photo_order: propertyPhotosTable.photo_order })
      .from(propertyPhotosTable)
      .where(eq(propertyPhotosTable.property_id, booking.property_id))
      .orderBy(asc(propertyPhotosTable.photo_order));

    const trustScores = await db
      .select()
      .from(trustScoresTable)
      .where(inArray(trustScoresTable.user_id, [booking.student_id, booking.landlord_id]));
    const trustByUser = new Map(trustScores.map((t) => [t.user_id, t]));

    const [notes, audit] = await Promise.all([
      db
        .select({
          id: bookingAdminNotesTable.id,
          booking_id: bookingAdminNotesTable.booking_id,
          officer_id: bookingAdminNotesTable.officer_id,
          note: bookingAdminNotesTable.note,
          created_at: bookingAdminNotesTable.created_at,
        })
        .from(bookingAdminNotesTable)
        .where(eq(bookingAdminNotesTable.booking_id, id))
        .orderBy(desc(bookingAdminNotesTable.created_at)),
      db
        .select({
          id: auditLogTable.id,
          actor_id: auditLogTable.actor_id,
          action_type: auditLogTable.action_type,
          resource_type: auditLogTable.resource_type,
          resource_id: auditLogTable.resource_id,
          details: auditLogTable.details,
          ip_address: auditLogTable.ip_address,
          user_agent: auditLogTable.user_agent,
          created_at: auditLogTable.created_at,
        })
        .from(auditLogTable)
        .where(and(eq(auditLogTable.resource_type, "booking"), eq(auditLogTable.resource_id, id)))
        .orderBy(desc(auditLogTable.created_at)),
    ]);

    // Hydrate officer names for the audit list. Officers are the typical actor
    // and the drawer should show "Admin: First Last" rather than a raw uuid.
    const actorIds = Array.from(new Set(audit.map((a) => a.actor_id)));
    const actors = actorIds.length
      ? await db
          .select({
            id: usersTable.id,
            first_name: usersTable.first_name,
            last_name: usersTable.last_name,
            role: usersTable.role,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, actorIds))
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    const officerIds = Array.from(
      new Set(
        notes
          .map((n) => n.officer_id)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const officerActors = officerIds.length
      ? await db
          .select({ id: usersTable.id, first_name: usersTable.first_name, last_name: usersTable.last_name })
          .from(usersTable)
          .where(inArray(usersTable.id, officerIds))
      : [];
    const officerById = new Map(officerActors.map((a) => [a.id, a]));

    return jsonResponse({
      booking: {
        id: booking.id,
        booking_status: booking.booking_status,
        stage: booking.booking_status === "pending_occupancy" && booking.under_verification_by_officer_at
          ? "under_verification"
          : booking.booking_status,
        stage_label: booking.booking_status === "pending_occupancy" && booking.under_verification_by_officer_at
          ? "Under verification"
          : STATUS_LABEL[booking.booking_status ?? ""] ?? booking.booking_status,
        total_amount_ngn: booking.total_amount_ngn,
        rent_amount_ngn: booking.rent_amount_ngn,
        deposit_amount_ngn: booking.deposit_amount_ngn,
        escrow_fee_ngn: 0,
        payment_method: booking.payment_method ?? null,
        payment_transaction_id: booking.payment_transaction_id ?? null,
        escrow_account_reference: booking.escrow_account_reference ?? null,
        funds_received_at: booking.funds_received_at?.toISOString() ?? null,
        occupancy_code_entered: booking.occupancy_code_entered ?? null,
        occupancy_confirmed_at: booking.occupancy_confirmed_by_student_at?.toISOString() ?? null,
        occupancy_verification_photo_url: booking.occupancy_verification_photo_url ?? null,
        occupancy_attempts: booking.occupancy_attempts ?? 0,
        lease_start_date: booking.lease_start_date ?? null,
        lease_end_date: booking.lease_end_date ?? null,
        lease_duration_days: booking.lease_duration_days ?? null,
        escrow_released_at: booking.escrow_released_at?.toISOString() ?? null,
        escrow_release_reason: booking.escrow_release_reason ?? null,
        payout_transfer_reference: booking.payout_transfer_reference ?? null,
        payout_initiated_at: booking.payout_initiated_at?.toISOString() ?? null,
        payout_attempts: booking.payout_attempts ?? 0,
        payout_error: booking.payout_error ?? null,
        release_held: booking.release_held_by_officer_at != null,
        release_held_at: booking.release_held_by_officer_at?.toISOString() ?? null,
        under_verification: Boolean(booking.under_verification_by_officer_at),
        under_verification_at: booking.under_verification_by_officer_at?.toISOString() ?? null,
        dispute_filed_at: booking.dispute_filed_at?.toISOString() ?? null,
        dispute_status: booking.dispute_status ?? null,
        dispute_outcome: booking.dispute_outcome ?? null,
        created_at: booking.created_at?.toISOString() ?? null,
        updated_at: booking.updated_at?.toISOString() ?? null,
      },
      property: property
        ? {
            id: property.id,
            address: property.address,
            rent_amount_ngn: property.rent_amount_ngn,
            deposit_amount_ngn: property.deposit_amount_ngn,
            occupancy_code: property.occupancy_code ?? null,
            listing_status: property.listing_status ?? null,
          }
        : null,
      photos,
      student: student
        ? {
            id: student.id,
            first_name: student.first_name,
            last_name: student.last_name,
            email: student.email,
            phone_number: student.phone_number,
            profile_photo_url: student.profile_photo_url,
            verification_status: student.verification_status,
            trust_score: trustByUser.get(student.id) ?? null,
          }
        : null,
      landlord: landlord
        ? {
            id: landlord.id,
            first_name: landlord.first_name,
            last_name: landlord.last_name,
            email: landlord.email,
            phone_number: landlord.phone_number,
            profile_photo_url: landlord.profile_photo_url,
            verification_status: landlord.verification_status,
            payout_bank_code: landlord.payout_bank_code,
            payout_account_number: landlord.payout_account_number,
            payout_account_name: landlord.payout_account_name,
            payout_details_set_at: landlord.payout_details_set_at?.toISOString() ?? null,
            trust_score: trustByUser.get(landlord.id) ?? null,
          }
        : null,
      notes: notes.map((n) => {
        const o = n.officer_id ? officerById.get(n.officer_id) : null;
        return {
          id: n.id,
          note: n.note,
          officer_id: n.officer_id,
          officer_name: o ? `${o.first_name ?? ""} ${o.last_name ?? ""}`.trim() : null,
          created_at: n.created_at?.toISOString() ?? null,
        };
      }),
      audit: audit.map((a) => {
        const actor = actorById.get(a.actor_id);
        return {
          id: a.id,
          action_type: a.action_type,
          actor_id: a.actor_id,
          actor_name: actor ? `${actor.first_name ?? ""} ${actor.last_name ?? ""}`.trim() : null,
          actor_role: actor?.role ?? null,
          details: a.details ?? {},
          ip_address: a.ip_address,
          user_agent: a.user_agent,
          created_at: a.created_at?.toISOString() ?? null,
        };
      }),
    });
  } catch (err) {
    return handleError(err, req);
  }
}
