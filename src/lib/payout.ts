import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, usersTable, auditLogTable } from "@/lib/db/schema";
import { amountToKobo, initiateTransfer } from "@/lib/paystack-server";
import { createNotification } from "@/lib/notify";

function formatNGN(n?: number | null): string {
  if (!n) return "₦0";
  return `₦${n.toLocaleString("en-NG")}`;
}

/**
 * Escrow release + lazy auto-release helpers.
 *
 * Money model: a student charge lands in the platform's Paystack merchant
 * balance. Releasing escrow = initiating a Paystack `transfer` from that
 * balance to the landlord's bank account (via their `recipient_code`). The
 * `transfer.success` / `transfer.failed` webhook is the source of truth for
 * the booking becoming `completed` — this call may return `pending` while
 * Paystack processes.
 */

export class PayoutError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PayoutError";
  }
}

export interface ReleaseOptions {
  /**
   * Officer support override — bypasses the student-not-approved / held /
   * disputed guards. Used by the admin "Release now" button. The normal path
   * (student authorizes) does NOT set force.
   */
  force?: boolean;
  /** Who triggered the release (student id normally, officer id when forced). */
  actorId: string;
  reason?: string;
}

/**
 * Initiate the escrow transfer for a booking. Idempotent: a booking already
 * `release_pending` or `completed` no-ops. Throws `PayoutError` (with a stable
 * `code`) on any guard failure or gateway error; the booking is moved to
 * `release_failed` with a stored reason on transfer errors so it's visible.
 *
 * Escrow model: the student authorizes the release (the booking is
 * `pending_review`, meaning they've confirmed move-in). The app records the
 * approval; Paystack actually moves the money. An officer can `force` past the
 * guards for support. There is no arbitrary time delay — release happens when
 * the tenant is satisfied.
 */
export async function releaseBookingEscrow(
  bookingId: string,
  opts: ReleaseOptions,
): Promise<{ idempotent: boolean; reference?: string }> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId))
    .limit(1);
  if (!booking) throw new PayoutError("not_found", "Booking not found");

  // Idempotent: nothing to do if a transfer is already in flight or done.
  if (booking.booking_status === "release_pending" || booking.booking_status === "completed") {
    return { idempotent: true };
  }

  const isRetry = booking.booking_status === "release_failed";
  if (booking.booking_status !== "pending_review" && !isRetry) {
    throw new PayoutError("not_releasable", `Booking is "${booking.booking_status}", can't release`);
  }

  // Guards an officer `force` bypasses. The normal student-triggered path can
  // only fire from `pending_review` (move-in confirmed), so the student has
  // effectively approved — no time window, no silent auto-release.
  if (!opts.force) {
    if (booking.release_held_by_officer_at) {
      throw new PayoutError("held", "Release is on hold by an escrow officer");
    }
    const ds = booking.dispute_status;
    if (ds && ds !== "no_dispute") {
      throw new PayoutError("disputed", "Booking is under dispute");
    }
  }

  const [landlord] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, booking.landlord_id))
    .limit(1);
  if (!landlord?.paystack_recipient_code) {
    await db
      .update(bookingsTable)
      .set({
        booking_status: "release_failed",
        payout_error: "Landlord payout details not set",
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, bookingId));
    throw new PayoutError("no_payout_details", "Landlord has not set payout details");
  }

  // Deterministic-but-unique reference: includes the attempt number so a retry
  // after a failed transfer gets a fresh reference (Paystack rejects duplicate
  // references on a new transfer).
  const attempt = (booking.payout_attempts ?? 0) + 1;
  const reference = `NAUB-PAYOUT-${booking.id.replace(/-/g, "").slice(0, 12).toUpperCase()}-${attempt}`;
  const amountKobo = amountToKobo(booking.total_amount_ngn);

  // Mark in-flight BEFORE the gateway call so a concurrent caller no-ops.
  await db
    .update(bookingsTable)
    .set({
      booking_status: "release_pending",
      payout_transfer_reference: reference,
      payout_initiated_at: new Date(),
      payout_attempts: attempt,
      payout_error: null,
      updated_at: new Date(),
    })
    .where(eq(bookingsTable.id, bookingId));

  try {
    const transfer = await initiateTransfer({
      recipient_code: landlord.paystack_recipient_code,
      amountKobo,
      reference,
      reason: `Escrow release — booking ${booking.id}`,
    });
    await db.insert(auditLogTable).values({
      actor_id: landlord.id,
      action_type: "escrow_release_initiated",
      resource_type: "booking",
      resource_id: booking.id,
      details: {
        reference,
        transfer_code: transfer.transfer_code,
        amount_kobo: amountKobo,
        actor: opts.actorId,
        reason: opts.reason ?? (opts.force ? "officer_override" : "student_approved"),
      },
    });

    // Fan-out notifications for both parties. Best-effort — a notify failure
    // never fails the transfer.
    const amount = formatNGN(booking.total_amount_ngn);
    await Promise.all([
      createNotification({
        userId: landlord.id,
        type: "escrow_release",
        title: "Escrow released",
        body: `${amount} is on its way to your bank account.`,
        relatedId: booking.id,
        relatedType: "booking",
      }),
      createNotification({
        userId: booking.student_id,
        type: "system",
        title: "Escrow released to landlord",
        body: `${amount} has been transferred to the landlord for your booking.`,
        relatedId: booking.id,
        relatedType: "booking",
      }),
    ]);

    return { idempotent: false, reference };
  } catch (e: any) {
    const raw = e?.paystack;
    const msg = raw?.message ?? e?.message ?? "Transfer failed";
    // Paystack refuses third-party payouts for Starter Business accounts with
    // code `transfer_unavailable`. This is an account-tier gate, not a
    // transient failure — retrying won't help and wedges the booking. Surface
    // a stable code so callers can render honest guidance.
    const isTierGate = raw?.code === "transfer_unavailable" || /third party payout|starter business/i.test(msg);
    const code = isTierGate ? "transfer_unavailable" : "transfer_failed";
    await db
      .update(bookingsTable)
      .set({
        booking_status: "release_failed",
        payout_error: msg,
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, bookingId));
    await db.insert(auditLogTable).values({
      actor_id: landlord.id,
      action_type: "escrow_release_failed",
      resource_type: "booking",
      resource_id: booking.id,
      details: { reference, error: msg, code, actor: opts.actorId },
    });

    // Tell the landlord so they (and the officer) see the failure surfaced.
    await createNotification({
      userId: landlord.id,
      type: "system",
      title: "Payout needs attention",
      body: isTierGate
        ? "Payouts are paused while the platform's Paystack account is upgraded to a Registered Business. Your funds are held safely until then."
        : "Your escrow release didn't go through. An officer will retry shortly.",
      relatedId: booking.id,
      relatedType: "booking",
    });

    throw new PayoutError(code, msg);
  }
}
