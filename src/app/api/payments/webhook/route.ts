import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, auditLogTable } from "@/lib/db/schema";
import { verifyWebhookSignature } from "@/lib/paystack-server";
import { markBookingPaidByReference } from "@/lib/payment-marks";
import { recordTrustEvent } from "@/lib/trust/service";

// Force Node.js so we can use `crypto.createHmac` (the App Router also runs
// on Node by default, but this is explicit and protects against accidental
// Edge-route migration).
export const runtime = "nodejs";

/**
 * POST /api/payments/webhook
 *
 * Source-of-truth confirmation from Paystack. The request body is HMAC-SHA512
 * signed with our secret key; we verify the signature before doing anything
 * else, then idempotently flip the booking to `pending_occupancy` on a
 * successful charge. We always respond 200 quickly — Paystack retries
 * non-2xx, and a duplicate event should silently no-op.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new NextResponse(null, { status: 200 });
  }

  const data = event?.data;
  if (event?.event === "charge.success" && data && data.status === "success") {
    const reference: string | undefined = data.reference;
    const amount: number | undefined = data.amount;
    if (typeof reference !== "string" || typeof amount !== "number") {
      return new NextResponse(null, { status: 200 });
    }

    // Resolves by metadata.booking_id first, falls back to the stored reference,
    // enforces the amount matches the booking total, and only transitions out of
    // `pending_payment`. Duplicate / replayed events no-op.
    await markBookingPaidByReference({
      reference,
      amountKobo: amount,
      metadataBookingId: data.metadata?.booking_id ?? null,
    });

    return new NextResponse(null, { status: 200 });
  }

  // Transfer webhooks settle the escrow release (source of truth for whether
  // money actually moved to the landlord).
  if (typeof event?.event === "string" && event.event.startsWith("transfer.")) {
    return handleTransferEvent(event);
  }

  // Anything else: ack so Paystack doesn't retry forever.
  return new NextResponse(null, { status: 200 });
}

/**
 * Handle Paystack transfer events. These are the source of truth for whether
 * an escrow release actually completed — the `transfer` call may return
 * `pending` while Paystack processes, and only the webhook settles the booking.
 *
 * We look up the booking by our stored `payout_transfer_reference` (which is
 * the `reference` Paystack echoes back). If no booking matches (e.g. the
 * transfer belongs to a different system, or our ref was wrong), respond 200
 * so Paystack doesn't retry forever.
 */
async function handleTransferEvent(event: any) {
  const data = event?.data;
  const reference: string | undefined = data?.reference;
  const transferCode: string | undefined = data?.transfer_code;
  if (typeof reference !== "string" || reference.length === 0) {
    return new NextResponse(null, { status: 200 });
  }

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.payout_transfer_reference, reference))
    .limit(1);

  // No matching booking — acknowledge so Paystack stops retrying.
  if (!booking) return new NextResponse(null, { status: 200 });

  // Idempotent: if this booking already moved past the in-flight state, no-op.
  if (event.event === "transfer.success") {
    if (booking.booking_status === "completed") return new NextResponse(null, { status: 200 });

    await db
      .update(bookingsTable)
      .set({
        booking_status: "completed",
        escrow_released_at: new Date(),
        payout_error: null,
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, booking.id));

    await db.insert(auditLogTable).values({
      actor_id: booking.landlord_id,
      action_type: "escrow_released",
      resource_type: "booking",
      resource_id: booking.id,
      details: { reference, transfer_code: transferCode ?? null },
    });

    // Successful completed transaction — both participants earn trust. Each
    // party has its own dedupe key so a replayed webhook can't double-count.
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
  } else if (event.event === "transfer.failed" || event.event === "transfer.reversed") {
    const reason =
      data?.gateway_response ??
      data?.message ??
      (event.event === "transfer.reversed" ? "Transfer reversed" : "Transfer failed");

    if (booking.booking_status !== "release_pending") {
      // Don't regress a completed/held booking — just log + ack.
      await db.insert(auditLogTable).values({
        actor_id: booking.landlord_id,
        action_type: "escrow_release_event_ignored",
        resource_type: "booking",
        resource_id: booking.id,
        details: { reference, event: event.event, reason, current_status: booking.booking_status },
      });
      return new NextResponse(null, { status: 200 });
    }

    await db
      .update(bookingsTable)
      .set({
        booking_status: "release_failed",
        payout_error: String(reason),
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, booking.id));

    await db.insert(auditLogTable).values({
      actor_id: booking.landlord_id,
      action_type: "escrow_release_failed",
      resource_type: "booking",
      resource_id: booking.id,
      details: { reference, transfer_code: transferCode ?? null, reason: String(reason), event: event.event },
    });
  }

  return new NextResponse(null, { status: 200 });
}
