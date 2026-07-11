import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/paystack-server";
import { markBookingPaidByReference } from "@/lib/payment-marks";

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
  if (event?.event !== "charge.success" || !data || data.status !== "success") {
    return new NextResponse(null, { status: 200 });
  }

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
