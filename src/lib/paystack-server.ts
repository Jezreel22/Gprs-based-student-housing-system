import { createHmac, timingSafeEqual } from "crypto";

/**
 * Server-only Paystack helpers. All gateway calls use the secret key, so this
 * module must never be imported from a client component. The inline (popup)
 * checkout creates the transaction in the browser; the server's job is to
 * prepare a reference, verify the result with `transaction/verify`, and trust
 * the HMAC-signed webhook as the source of truth.
 */

const PAYSTACK_BASE = "https://api.paystack.co";
const PAYSTACK_CURRENCY = "NGN";

/** Naira → kobo. Paystack amounts are always in the smallest currency unit. */
export function amountToKobo(naira: number): number {
  return Math.round(naira * 100);
}

/**
 * Throws a clear error if the secret key isn't configured. Call from route
 * handlers so a misconfigured deploy fails loudly instead of silently.
 */
export function assertConfigured(): void {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }
}

/**
 * Build a unique, human-readable transaction reference. Paystack requires
 * references to be unique per transaction and ≤ 100 chars; we encode the
 * booking id prefix for traceability plus a random suffix.
 */
export function newPaymentReference(bookingId: string): string {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  const prefix = bookingId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `NAUB-${prefix}-${rand}`;
}

interface VerifyResult {
  status: "success" | "failed" | "pending";
  reference: string | null;
  amountKobo: number | null;
  metadataBookingId: string | null;
  gatewayResponse: string | null;
  raw: unknown;
}

/**
 * Call Paystack `transaction/verify/:reference`. Returns a normalized result
 * we can reason about in both the verify route and the webhook (defensively).
 */
export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  assertConfigured();

  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    // Always hit the network; we need the live gateway status.
    cache: "no-store",
  });

  const json = (await res.json()) as any;

  // Non-2xx from Paystack means we genuinely don't know the state.
  if (!res.ok) {
    return {
      status: "pending",
      reference,
      amountKobo: null,
      metadataBookingId: null,
      gatewayResponse: json?.message ?? `Paystack verify failed (HTTP ${res.status})`,
      raw: json,
    };
  }

  const data = json?.data ?? {};
  const status = typeof data.status === "string" ? data.status : "pending";
  return {
    status: status === "success" ? "success" : status === "failed" ? "failed" : "pending",
    reference: data.reference ?? reference,
    amountKobo: typeof data.amount === "number" ? data.amount : null,
    metadataBookingId: data.metadata?.booking_id ?? null,
    gatewayResponse: data.gateway_response ?? data.message ?? null,
    raw: json,
  };
}

/**
 * Timing-safe HMAC-SHA512 verification of an incoming webhook. Paystack signs
 * the raw request body with the secret key and sends the hex digest in the
 * `x-paystack-signature` header. Returns false if anything is off — never
 * throw, so the caller can simply reject.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signatureHeader) return false;

  const digest = createHmac("sha512", secret).update(rawBody).digest("hex");
  if (digest.length !== signatureHeader.length) return false;

  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export { PAYSTACK_CURRENCY };
