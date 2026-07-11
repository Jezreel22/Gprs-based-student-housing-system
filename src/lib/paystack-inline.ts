/**
 * Browser-only Paystack inline (popup) integration. Loads Paystack's inline
 * script on demand and opens the checkout iframe with parameters that were
 * prepared by the server (amount, email, reference) — the client never
 * invents them, and every successful charge is re-confirmed server-side via
 * `transaction/verify` plus the HMAC-signed webhook.
 */

const INLINE_SCRIPT = "https://js.paystack.co/v1/inline.js";

interface PaystackInlineResponse {
  reference: string;
  status: string;
  trans: string;
  transaction: string;
  message: string;
}

interface PaystackHandler {
  openIframe: () => void;
}

interface PaystackPopStatic {
  setup: (config: Record<string, unknown>) => PaystackHandler;
}

declare global {
  interface Window {
    PaystackPop?: PaystackPopStatic;
  }
}

let scriptPromise: Promise<PaystackPopStatic> | null = null;

/** Inject the inline script once and resolve `window.PaystackPop`. */
function loadPaystack(): Promise<PaystackPopStatic> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Paystack can only be used in the browser"));
  }
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<PaystackPopStatic>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${INLINE_SCRIPT}"]`,
    );
    const onReady = () => {
      if (window.PaystackPop) resolve(window.PaystackPop);
      else reject(new Error("Paystack script loaded but PaystackPop was not found"));
    };
    if (existing) {
      existing.addEventListener("load", onReady, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Paystack")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = INLINE_SCRIPT;
    script.async = true;
    script.onload = onReady;
    script.onerror = () => reject(new Error("Failed to load Paystack"));
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export interface PaystackInlineParams {
  /** Paystack public key (pk_test_/pk_live_). Safe to expose to the browser. */
  publicKey: string;
  email: string;
  /** Amount in kobo (naira × 100), as returned by the server. */
  amountKobo: number;
  reference: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  /** Restrict channels e.g. ["card", "bank", "ussd", "bank_transfer"]. */
  channels?: string[];
}

export interface PaystackResult {
  reference: string;
  status: string;
}

/**
 * Open the Paystack inline popup. Resolves on a successful charge (Paystack
 * fires `callback` only for a completed payment) and rejects when the user
 * closes the popup. Always re-verify server-side on success.
 */
export async function payWithPaystack(params: PaystackInlineParams): Promise<PaystackResult> {
  const PaystackPop = await loadPaystack();

  return new Promise<PaystackResult>((resolve, reject) => {
    const handler = PaystackPop.setup({
      key: params.publicKey,
      email: params.email,
      amount: params.amountKobo,
      ref: params.reference,
      currency: params.currency ?? "NGN",
      metadata: params.metadata,
      channels: params.channels,
      onClose: () => reject(new Error("PAYSTACK_CLOSED")),
      callback: (response: PaystackInlineResponse) =>
        resolve({ reference: response.reference, status: response.status }),
    });
    handler.openIframe();
  });
}

/** Sentinel thrown/rejected when the user dismisses the popup. */
export const PAYSTACK_CLOSED = "PAYSTACK_CLOSED";
