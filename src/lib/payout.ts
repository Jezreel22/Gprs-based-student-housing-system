import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, usersTable, auditLogTable } from "@/lib/db/schema";
import { amountToKobo, createTransferRecipient, initiateTransfer, resolveAccountNumber } from "@/lib/paystack-server";
import { createNotification, getEscrowOfficers } from "@/lib/notify";
import { completeBookingPayout } from "@/lib/payment-marks";

function formatNGN(n?: number | null): string {
  if (!n) return "₦0";
  return `₦${n.toLocaleString("en-NG")}`;
}

/**
 * Disbursement mode.
 *
 * - `managed` (default): the platform holds the charge in its Paystack balance
 *   and the platform owner pays the landlord by manual bank transfer after the
 *   student approves. The app records the approval and queues the payout; an
 *   officer confirms disbursement via /api/bookings/[id]/mark-disbursed. This
 *   is real held-funds escrow that works on a Paystack Starter account, which
 *   cannot use the third-party Transfer API.
 *
 * - `transfer`: the app initiates a Paystack transfer to the landlord's
 *   recipient automatically once the student approves. Requires the Paystack
 *   account to be a Registered Business (Starter accounts are blocked from
 *   third-party payouts). Set ESCROW_DISBURSEMENT_MODE=transfer after upgrade.
 */
const DISBURSEMENT_MODE = (process.env.ESCROW_DISBURSEMENT_MODE ?? "managed").toLowerCase() === "transfer" ? "transfer" : "managed";

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
): Promise<{ idempotent: boolean; reference?: string; mode?: "managed" | "transfer" }> {
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
  if (!landlord) throw new PayoutError("not_found", "Landlord not found");

  // Platform-managed escrow: record the student's approval and queue the payout
  // for manual disbursement. No Paystack transfer is attempted — the platform
  // owner pays the landlord from the settled balance and confirms via
  // /api/bookings/[id]/mark-disbursed. This is the default and the only mode a
  // Starter Paystack account can actually complete.
  if (DISBURSEMENT_MODE === "managed") {
    await db
      .update(bookingsTable)
      .set({
        booking_status: "release_pending",
        payout_initiated_at: new Date(),
        payout_error: null,
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, bookingId));

    await db.insert(auditLogTable).values({
      actor_id: landlord.id,
      action_type: "escrow_release_approved",
      resource_type: "booking",
      resource_id: booking.id,
      details: { mode: "managed", actor: opts.actorId, reason: opts.reason ?? (opts.force ? "officer_override" : "student_approved") },
    });

    const amount = formatNGN(booking.total_amount_ngn);
    const officerIds = await getEscrowOfficers();
    await Promise.all([
      createNotification({
        userId: landlord.id,
        type: "escrow_release",
        title: "Payout approved",
        body: `Your tenant approved the release of ${amount}. It'll be sent to your bank account shortly.`,
        relatedId: booking.id,
        relatedType: "booking",
      }),
      createNotification({
        userId: booking.student_id,
        type: "system",
        title: "Release approved",
        body: `You approved releasing ${amount} to the landlord.`,
        relatedId: booking.id,
        relatedType: "booking",
      }),
      ...officerIds.map((officerId) =>
        createNotification({
          userId: officerId,
          type: "system",
          title: "Payout ready to disburse",
          body: `${amount} approved by the tenant — ready for manual disbursement to the landlord's bank account.`,
          relatedId: booking.id,
          relatedType: "booking",
        }),
      ),
    ]);

    return { idempotent: false, mode: "managed" as const };
  }

  // Legacy landlords (verified before recipient creation was added, or whose
  // recipient lives on the wrong account after a key rotation) can reach release
  // without a paystack_recipient_code. If they've saved a bank account, repair
  // it now against the currently configured Paystack account so the student's
  // approval isn't blocked by a setup gap. We never infer bank data — only use
  // what the landlord previously saved.
  if (!landlord.paystack_recipient_code && landlord.payout_account_number && landlord.payout_bank_code) {
    try {
      const resolved = await resolveAccountNumber({ account_number: landlord.payout_account_number, bank_code: landlord.payout_bank_code });
      const recipient = await createTransferRecipient({ account_number: landlord.payout_account_number, bank_code: landlord.payout_bank_code, account_name: resolved.account_name });
      const [repaired] = await db.update(usersTable).set({
        paystack_recipient_code: recipient.recipient_code,
        payout_account_name: resolved.account_name,
        payout_details_set_at: new Date(),
        updated_at: new Date(),
      }).where(eq(usersTable.id, landlord.id)).returning();
      Object.assign(landlord, repaired);
    } catch {
      await db.update(bookingsTable).set({ booking_status: "release_failed", payout_error: "Landlord payout account could not be verified", updated_at: new Date() }).where(eq(bookingsTable.id, bookingId));
      throw new PayoutError("no_payout_details", "Landlord payout account could not be verified");
    }
  }

  if (!landlord.paystack_recipient_code) {
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

    // Paystack usually returns `pending`, but a hot/verified account can return
    // `success` synchronously. Settle immediately through the shared funnel so
    // the booking reflects reality without waiting for the webhook. The funnel
    // is gated on `release_pending`, so the later `transfer.success` webhook is
    // a safe no-op rather than a double-fire.
    if (String(transfer.status).toLowerCase() === "success") {
      await completeBookingPayout({ bookingId: booking.id, reference, transferCode: transfer.transfer_code, reason: "transfer_success_immediate" });
    }

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
