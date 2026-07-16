import { NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, propertiesTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";

/**
 * GET /api/admin/bookings
 *
 * Escrow-officer view of bookings that need oversight: those with funds held
 * in escrow and awaiting occupancy confirmation (pending_occupancy), awaiting
 * release (pending_review), in flight (release_pending), or failed
 * (release_failed). Sorted by most recently changed.
 */
export async function GET(req: NextRequest) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") {
      return jsonResponse({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await db
      .select()
      .from(bookingsTable)
      .where(
        inArray(bookingsTable.booking_status, [
          "pending_occupancy",
          "pending_review",
          "release_pending",
          "release_failed",
        ]),
      );

    const propertyIds = Array.from(new Set(rows.map((b) => b.property_id)));
    const userIds = Array.from(new Set([...rows.map((b) => b.student_id), ...rows.map((b) => b.landlord_id)]));

    const [properties, users] = await Promise.all([
      propertyIds.length
        ? db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
        : Promise.resolve([]),
      userIds.length
        ? db.select({ id: usersTable.id, first_name: usersTable.first_name, last_name: usersTable.last_name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds))
        : Promise.resolve([]),
    ]);

    const propMap = new Map(properties.map((p) => [p.id, p]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    const items = rows
      .sort((a, b) => (b.updated_at?.getTime() ?? 0) - (a.updated_at?.getTime() ?? 0))
      .map((b) => {
        const student = userMap.get(b.student_id);
        const landlord = userMap.get(b.landlord_id);
        const prop = propMap.get(b.property_id);
        return {
          id: b.id,
          booking_status: b.booking_status,
          total_amount_ngn: b.total_amount_ngn,
          property_address: prop?.address ?? null,
          occupancy_code: prop?.occupancy_code ?? null,
          student_name: student ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() : null,
          landlord_name: landlord ? `${landlord.first_name ?? ""} ${landlord.last_name ?? ""}`.trim() : null,
          funds_received_at: b.funds_received_at?.toISOString() ?? null,
          occupancy_confirmed_at: b.occupancy_confirmed_by_student_at?.toISOString() ?? null,
          payout_transfer_reference: b.payout_transfer_reference ?? null,
          payout_attempts: b.payout_attempts ?? 0,
          payout_error: b.payout_error ?? null,
          release_held: b.release_held_by_officer_at != null,
        };
      });

    return jsonResponse({ items });
  } catch (err) {
    return handleError(err, req);
  }
}
