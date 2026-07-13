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

// ─── Transfers / payouts ────────────────────────────────────────────────────
//
// On a charge, money lands in the platform's main Paystack merchant balance
// (that's how Paystack works). When escrow is released, the platform calls
// `transfer` to push that money to the landlord's bank account via the
// `recipient_code` we minted when the landlord saved their payout details.
//
// All calls here are server-only — the secret key is required.

interface Bank { name: string; code: string; }

// Cache banks briefly (10 min). Paystack's bank list changes rarely, and the
// dropdown is read on every landlord dashboard load.
let banksCache: { at: number; list: Bank[] } | null = null;
const BANKS_TTL_MS = 10 * 60 * 1000;

export async function listBanks(country = "nigeria"): Promise<Bank[]> {
  const now = Date.now();
  if (banksCache && now - banksCache.at < BANKS_TTL_MS) return banksCache.list;

  assertConfigured();
  const res = await fetch(`${PAYSTACK_BASE}/bank?country=${encodeURIComponent(country)}&perPage=100`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    cache: "no-store",
  });
  const json = (await res.json()) as any;
  if (!res.ok || !json?.data) {
    // Fall back to whatever we have cached, even if stale — better than nothing.
    if (banksCache) return banksCache.list;
    throw new Error(json?.message ?? `Paystack listBanks failed (HTTP ${res.status})`);
  }
  const list: Bank[] = (json.data as Array<{ name: string; code: string }>)
    .map(b => ({ name: b.name, code: String(b.code) }))
    .filter(b => b.name && b.code)
    .sort((a, b) => a.name.localeCompare(b.name));
  banksCache = { at: now, list };
  return list;
}

/**
 * Verify that (account_number, bank_code) is a real, active account and return
 * the registered account name. The landlord must confirm this name matches what
 * they expect before we mint a transfer recipient.
 */
export async function resolveAccountNumber(input: {
  account_number: string;
  bank_code: string;
}): Promise<{ account_name: string }> {
  assertConfigured();
  const res = await fetch(
    `${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(input.account_number)}&bank_code=${encodeURIComponent(input.bank_code)}`,
    {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      cache: "no-store",
    },
  );
  const json = (await res.json()) as any;
  if (!res.ok || !json?.data?.account_name) {
    const msg = json?.message ?? `Paystack resolveAccountNumber failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return { account_name: String(json.data.account_name).trim() };
}

/**
 * Mint a Paystack transfer recipient (the token we use to send money to this
 * bank account later). We store the returned `recipient_code` so subsequent
 * transfers don't need to re-collect bank details.
 */
export async function createTransferRecipient(input: {
  account_number: string;
  bank_code: string;
  account_name: string;
}): Promise<{ recipient_code: string }> {
  assertConfigured();
  const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "nuban",
      name: input.account_name,
      account_number: input.account_number,
      bank_code: input.bank_code,
      currency: PAYSTACK_CURRENCY,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as any;
  if (!res.ok || !json?.data?.recipient_code) {
    const msg = json?.message ?? `Paystack createTransferRecipient failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return { recipient_code: String(json.data.recipient_code) };
}

export interface InitiateTransferResult {
  transfer_code: string;
  status: string;
  amountKobo: number;
  reference: string;
}

/**
 * Initiate a transfer from the platform's Paystack balance to a recipient.
 * The transfer webhook (`transfer.success` / `transfer.failed`) is the source
 * of truth — this call may return `status: "pending"` while Paystack processes.
 *
 * Idempotent at the reference level: Paystack will reject a duplicate
 * reference, so use a deterministic `NAUB-PAYOUT-<booking_id>` for retries.
 */
export async function initiateTransfer(input: {
  recipient_code: string;
  amountKobo: number;
  reference: string;
  reason?: string;
}): Promise<InitiateTransferResult> {
  assertConfigured();
  const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "balance",
      amount: input.amountKobo,
      recipient: input.recipient_code,
      reference: input.reference,
      reason: input.reason ?? "NAUB Home Finder escrow release",
      currency: PAYSTACK_CURRENCY,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as any;
  if (!res.ok || !json?.data?.transfer_code) {
    // Paystack's error envelope: { status: false, message: "..." }
    const msg = json?.message ?? `Paystack initiateTransfer failed (HTTP ${res.status})`;
    const err: any = new Error(msg);
    // Stash the raw envelope for the caller (so we can record payout_error).
    err.paystack = json;
    throw err;
  }
  return {
    transfer_code: String(json.data.transfer_code),
    status: String(json.data.status ?? "pending"),
    amountKobo: Number(json.data.amount ?? input.amountKobo),
    reference: String(json.data.reference ?? input.reference),
  };
}
