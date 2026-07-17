/**
 * Thin typed client for the custom Paystack endpoints. Reuses the shared
 * `customFetch` so the bearer token (registered via `setAuthTokenGetter` in
 * providers) is attached automatically, matching the generated API client.
 */
import { customFetch } from "@/api/custom-fetch";

export interface InitializePaymentResponse {
  reference: string;
  public_key: string;
  email: string;
  amount_kobo: number;
  currency: string;
  booking_id: string;
  metadata: { booking_id: string };
}

export type VerifyStatus = "success" | "failed" | "pending";

export interface VerifyPaymentResponse {
  status: VerifyStatus;
}

/** POST /api/bookings/:id/initialize-payment — prepare an inline checkout session. */
export function initializePayment(bookingId: string): Promise<InitializePaymentResponse> {
  return customFetch<InitializePaymentResponse>(
    `/api/bookings/${encodeURIComponent(bookingId)}/initialize-payment`,
    { method: "POST", responseType: "json" },
  );
}

/** POST /api/payments/verify — server-side confirmation of a charge. */
export function verifyPayment(reference: string): Promise<VerifyPaymentResponse> {
  return customFetch<VerifyPaymentResponse>(`/api/payments/verify`, {
    method: "POST",
    body: JSON.stringify({ reference }),
    responseType: "json",
  });
}
