import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, propertiesTable } from "@/lib/db/schema";
import { notifyEscrowFunded } from "@/lib/notify";

/**
 * Mark a booking as paid — idempotent. Only flips the lifecycle when the
 * booking is currently `pending_payment` so a late or replayed webhook never
 * overwrites a `completed`/`disputed` booking, and never double-updates.
 *
 * On the actual transition (`pending_payment → pending_occupancy`) it fires the
 * "funds landed in escrow" notification fan-out (landlord + student + every
 * officer). Because this only runs on the first successful flip, the fan-out is
 * exactly-once regardless of whether the webhook or the client verify route
 * lands first — the duplicate call returns false and skips it.
 *
 * Returns true if a state change happened this call (or false if the booking
 * was already paid/missing/wrong state), so the caller can decide whether to
 * log "first time confirmed" vs. "duplicate".
 */
export async function markBookingPaid(args: {
  bookingId: string;
  reference: string;
}): Promise<boolean> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, args.bookingId))
    .limit(1);
  if (!booking) return false;

  const result = await db
    .update(bookingsTable)
    .set({
      booking_status: "pending_occupancy",
      funds_received_at: new Date(),
      payment_transaction_id: args.reference,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(bookingsTable.id, args.bookingId),
        eq(bookingsTable.booking_status, "pending_payment"),
      ),
    )
    .returning({ id: bookingsTable.id });

  if (result.length === 0) return false;

  // Funds just landed — best-effort fan-out. We want the notifications to fire
  // before the caller responds, so the lookup is awaited here, but any failure
  // is swallowed so it can never regress the paid-state flip we just committed.
  try {
    const [prop] = await db
      .select({ address: propertiesTable.address })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, booking.property_id))
      .limit(1);
    await notifyEscrowFunded({
      bookingId: booking.id,
      landlordId: booking.landlord_id,
      studentId: booking.student_id,
      totalAmountNgn: booking.total_amount_ngn,
      propertyAddress: prop?.address ?? null,
    });
  } catch {
    // Swallow — never regress the paid transition on a notify hiccup.
  }

  return true;
}

/**
 * Same idempotent paid-state update, but keyed by Paystack reference (used
 * by the webhook when the booking id isn't already in the URL). Returns the
 * booking id of the updated row if a transition happened.
 */
export async function markBookingPaidByReference(args: {
  reference: string;
  amountKobo: number;
  metadataBookingId: string | null;
}): Promise<string | null> {
  let bookingId = args.metadataBookingId ?? null;

  if (!bookingId) {
    const [b] = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(eq(bookingsTable.payment_transaction_id, args.reference))
      .limit(1);
    bookingId = b?.id ?? null;
  }
  if (!bookingId) return null;

  const [booking] = await db
    .select({ total: bookingsTable.total_amount_ngn })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId))
    .limit(1);
  if (!booking) return null;

  if (booking.total * 100 !== args.amountKobo) return null;

  return (await markBookingPaid({ bookingId, reference: args.reference })) ? bookingId : null;
}
