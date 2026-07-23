import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, propertiesTable, usersTable } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";
import { notifyEscrowFunded } from "@/lib/notify";
import { getEscrowOfficers } from "@/lib/notify";
import { createNotification } from "@/lib/notify";
import { recordTrustEvent } from "@/lib/trust/service";

/**
 * Mark an escrow payout as settled (`release_pending` → `completed`).
 *
 * Source of truth is the Paystack `transfer.success` webhook, but the Transfer
 * API can also return `status: "success"` synchronously on a hot account. This
 * helper is the single idempotent funnel both paths call: it only flips a
 * booking that is currently `release_pending`, so an immediate success and a
 * later webhook cannot double-fire notifications, audit rows, or trust events.
 * Returns true only when a transition actually happened.
 */
export async function completeBookingPayout(args: {
  bookingId: string;
  reference: string;
  transferCode?: string | null;
  reason?: "transfer_success_webhook" | "transfer_success_immediate";
}): Promise<boolean> {
  const result = await db
    .update(bookingsTable)
    .set({
      booking_status: "completed",
      escrow_released_at: new Date(),
      payout_error: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(bookingsTable.id, args.bookingId),
        eq(bookingsTable.booking_status, "release_pending"),
      ),
    )
    .returning();

  if (result.length === 0) return false;

  const [booking] = result;
  await writeAudit({
    actorId: booking.landlord_id,
    actionType: "escrow_released",
    resourceType: "booking",
    resourceId: booking.id,
    previousStatus: "release_pending",
    newStatus: "completed",
    details: { reference: args.reference, transfer_code: args.transferCode ?? null, reason: args.reason ?? "transfer_success_webhook" },
  });

  // Successful completed transaction — both participants earn trust. Each party
  // has its own dedupe key so a replayed event can't double-count.
  await recordTrustEvent({
    userId: booking.student_id,
    ruleKey: "transaction_completed",
    sourceType: "booking",
    sourceId: booking.id,
    dedupeKey: `transaction-completed:${booking.id}:student`,
    reason: "Booking completed",
  });
  await recordTrustEvent({
    userId: booking.landlord_id,
    ruleKey: "transaction_completed",
    sourceType: "booking",
    sourceId: booking.id,
    dedupeKey: `transaction-completed:${booking.id}:landlord`,
    reason: "Booking completed",
  });

  return true;
}

/**
 * Officer confirmation that a platform-managed disbursement was actually sent
 * (the platform owner made the manual bank transfer to the landlord). Flips a
 * `release_pending` booking to `completed` and records audit + trust events.
 * Used only in managed mode; in transfer mode the webhook is the source of
 * truth. Idempotent via the `release_pending` state guard.
 */
export async function markBookingDisbursed(args: {
  bookingId: string;
  officerId: string;
  reference?: string | null;
}): Promise<boolean> {
  const result = await db
    .update(bookingsTable)
    .set({
      booking_status: "completed",
      escrow_released_at: new Date(),
      payout_error: null,
      payout_transfer_reference: args.reference ?? null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(bookingsTable.id, args.bookingId),
        eq(bookingsTable.booking_status, "release_pending"),
      ),
    )
    .returning();

  if (result.length === 0) return false;

  const [booking] = result;
  await writeAudit({
    actorId: args.officerId,
    actionType: "escrow_disbursed_offline",
    resourceType: "booking",
    resourceId: booking.id,
    previousStatus: "release_pending",
    newStatus: "completed",
    details: { reference: args.reference ?? null, mode: "managed" },
  });

  // Same dedupe keys as the transfer path — safe if both ever run.
  await recordTrustEvent({
    userId: booking.student_id,
    ruleKey: "transaction_completed",
    sourceType: "booking",
    sourceId: booking.id,
    dedupeKey: `transaction-completed:${booking.id}:student`,
    reason: "Booking completed (offline disbursement)",
  });
  await recordTrustEvent({
    userId: booking.landlord_id,
    ruleKey: "transaction_completed",
    sourceType: "booking",
    sourceId: booking.id,
    dedupeKey: `transaction-completed:${booking.id}:landlord`,
    reason: "Booking completed (offline disbursement)",
  });

  await createNotification({
    userId: booking.landlord_id,
    type: "escrow_release",
    title: "Payout sent",
    body: "Your escrow payout has been sent to your bank account.",
    relatedId: booking.id,
    relatedType: "booking",
  });

  return true;
}

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
