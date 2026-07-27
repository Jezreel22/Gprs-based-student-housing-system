/**
 * Authorization helpers for escrow transaction + receipt endpoints.
 *
 * Centralised so every API route, the receipt PDF route, and the
 * transaction/share endpoints agree on who can see what.
 *
 * Policy:
 *   - students and landlords can read transactions for bookings they are
 *     a party to;
 *   - escrow_officer can read every transaction;
 *   - agents cannot read transactions or receipts in this model.
 */

import type { User } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { bookingsTable, escrowReceiptsTable, escrowTransactionsTable } from "@/lib/db/schema";
import { eq, or, sql } from "drizzle-orm";

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "forbidden"; reason: "role" | "not_party" }
  | { kind: "not_found" };

/**
 * Returns true when the user is allowed to see any transaction for the
 * booking. Officers are always allowed; everyone else must be a party.
 */
export async function canViewBooking(user: User, bookingId: string): Promise<boolean> {
  if (user.role === "escrow_officer") return true;
  if (user.role !== "student" && user.role !== "landlord") return false;
  const [row] = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(
      sql`${bookingsTable.id} = ${bookingId}
          AND (${bookingsTable.student_id} = ${user.id}
               OR ${bookingsTable.landlord_id} = ${user.id})`,
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Same policy as `canViewBooking` but for a transaction row — looks up the
 * booking via the transaction and then evaluates the booking-level rule.
 */
export async function canViewTransaction(user: User, transactionId: string): Promise<boolean> {
  const [t] = await db
    .select({ booking_id: escrowTransactionsTable.booking_id })
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.id, transactionId))
    .limit(1);
  if (!t) return false;
  return canViewBooking(user, t.booking_id);
}

/**
 * Same policy as `canViewBooking` but for a receipt. The receipt already
 * carries the booking_id, so we read it once and apply the booking policy.
 */
export async function canViewReceipt(user: User, receiptId: string): Promise<boolean> {
  if (user.role === "escrow_officer") return true;
  const [row] = await db
    .select({ booking_id: escrowReceiptsTable.booking_id })
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.id, receiptId))
    .limit(1);
  if (!row) return false;
  return canViewBooking(user, row.booking_id);
}

/** Convenience: booking IDs the user can see, sorted desc by updated_at. */
export async function findBookingIdsForActor(user: User): Promise<string[]> {
  if (user.role === "escrow_officer") {
    const rows = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .orderBy(sql`${bookingsTable.updated_at} DESC`)
      .limit(1000);
    return rows.map((r) => r.id);
  }
  if (user.role === "student" || user.role === "landlord") {
    const rows = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(or(eq(bookingsTable.student_id, user.id), eq(bookingsTable.landlord_id, user.id)));
    return rows.map((r) => r.id);
  }
  return [];
}

export function callerRole(user: User): string {
  return user.role;
}