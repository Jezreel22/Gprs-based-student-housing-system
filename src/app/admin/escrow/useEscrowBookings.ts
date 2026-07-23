"use client";

import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";

export interface EscrowLedgerItem {
  id: string;
  booking_status: string;
  stage: string;
  stage_label: string;
  under_verification: boolean;
  rejected_reason: string | null;
  total_amount_ngn: number;
  rent_amount_ngn: number;
  deposit_amount_ngn: number;
  escrow_fee_ngn: number;
  property_id: string;
  property_address: string | null;
  property_thumbnail_url: string | null;
  occupancy_code: string | null;
  student_id: string;
  student_name: string | null;
  student_email: string | null;
  student_phone: string | null;
  student_verification: string | null;
  landlord_id: string;
  landlord_name: string | null;
  landlord_email: string | null;
  landlord_phone: string | null;
  landlord_verification: string | null;
  landlord_bank_code: string | null;
  landlord_account_number: string | null;
  landlord_account_name: string | null;
  payment_method: string | null;
  payment_transaction_id: string | null;
  escrow_account_reference: string | null;
  funds_received_at: string | null;
  occupancy_confirmed_at: string | null;
  occupancy_verification_photo_url: string | null;
  lease_start_date: string | null;
  lease_end_date: string | null;
  lease_duration_days: number | null;
  payout_transfer_reference: string | null;
  payout_initiated_at: string | null;
  payout_attempts: number;
  payout_error: string | null;
  release_held: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface EscrowLedgerTotals {
  payment_received: number;
  under_verification: number;
  verified: number;
  ready_for_disbursement: number;
  disbursement_failed: number;
  rejected: number;
  disbursed: number;
  held_balance_ngn: number;
}

export interface EscrowLedgerResponse {
  items: EscrowLedgerItem[];
  total: number;
  page: number;
  page_size: number;
  totals: EscrowLedgerTotals;
  stages: { value: string; label: string }[];
  transitions: Record<string, readonly string[]>;
}

export interface UseEscrowBookingsArgs {
  page: number;
  pageSize: number;
  status?: string;
  q?: string;
  landlord?: string;
  tenant?: string;
  property?: string;
  sort?: string;
  order?: string;
  enabled?: boolean;
}

/**
 * react-query hook for the officer ledger. Polls every 10s while visible (the
 * same cadence the existing /admin Escrow tab uses — officers want near-real-
 * time updates without overwhelming the DB).
 */
export function useEscrowBookings(args: UseEscrowBookingsArgs) {
  const qs = new URLSearchParams();
  qs.set("page", String(args.page));
  qs.set("page_size", String(args.pageSize));
  if (args.status) qs.set("status", args.status);
  if (args.q) qs.set("q", args.q);
  if (args.landlord) qs.set("landlord", args.landlord);
  if (args.tenant) qs.set("tenant", args.tenant);
  if (args.property) qs.set("property", args.property);
  if (args.sort) qs.set("sort", args.sort);
  if (args.order) qs.set("order", args.order);

  return useQuery<EscrowLedgerResponse>({
    queryKey: ["admin", "escrow-ledger", qs.toString()],
    enabled: args.enabled !== false,
    queryFn: () => customFetch<EscrowLedgerResponse>(`/api/admin/bookings?${qs.toString()}`),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    staleTime: 5_000,
  });
}

/**
 * Detail hook for the drawer. Lazy — only fires when `enabled` (i.e. when the
 * drawer opens). Re-fetches on demand via the refetch returned by useQuery.
 */
export function useEscrowBookingDetail(id: string | null, enabled: boolean) {
  return useQuery<any>({
    queryKey: ["admin", "escrow-detail", id],
    enabled: Boolean(id) && enabled,
    queryFn: () => customFetch<any>(`/api/admin/bookings/${id}`),
    refetchInterval: 10_000,
  });
}
