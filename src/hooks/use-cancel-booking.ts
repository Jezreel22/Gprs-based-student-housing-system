"use client";

/**
 * useCancelBooking
 *
 * Posts to `POST /api/bookings/:id/cancel` to flip an unpaid booking to
 * `cancelled`. The server enforces the `pending_payment` status — already
 * paid bookings cannot be cancelled from the client (they keep their
 * financial + dispute history).
 *
 * Returns the react-query mutation hook so callers can wire `onSuccess` /
 * `onError` toasts and trigger list invalidation.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";

export interface CancelBookingBody {
  reason: string;
}

interface UseCancelBookingOptions {
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
}

export function useCancelBooking(opts: UseCancelBookingOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation<{ message: string }, Error, { id: string; body: CancelBookingBody }>({
    mutationFn: async ({ id, body }) =>
      customFetch<{ message: string }>(`/api/bookings/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["booking"] });
      opts.onSuccess?.(data.message);
    },
    onError: (err: any) => {
      opts.onError?.(err?.message ?? "Could not cancel booking");
    },
  });
}