/**
 * Client-side mirror of `src/lib/escrow/transitions.ts`. The server ships the
 * `STATUS_LABEL` map and `ALLOWED_TRANSITIONS` in the GET `/api/admin/bookings`
 * response, but the client needs the *types* and label-to-colour map locally
 * to render badges without round-tripping the server.
 *
 * Re-export of the server's labels keeps both sides in agreement.
 */
import { STATUS_LABEL as SERVER_LABEL } from "@/lib/escrow/transitions";

export type EscrowStage =
  | "payment_pending"
  | "payment_received"
  | "under_verification"
  | "verified"
  | "ready_for_disbursement"
  | "disbursed"
  | "rejected";

export const STATUS_LABEL: Record<string, string> = SERVER_LABEL;

/**
 * Display colour for each stage. Used by the badge component; hex strings so
 * the badge can stay inline-styled and match the existing admin palette.
 */
export const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  payment_pending:          { bg: "#F3F4F6", fg: "#374151" },
  pending_payment:          { bg: "#F3F4F6", fg: "#374151" },
  payment_received:         { bg: "#DBEAFE", fg: "#1D4ED8" },
  pending_occupancy:        { bg: "#DBEAFE", fg: "#1D4ED8" },
  under_verification:       { bg: "#FEF3C7", fg: "#B45309" },
  verified:                 { bg: "#E0E7FF", fg: "#4338CA" },
  pending_review:           { bg: "#E0E7FF", fg: "#4338CA" },
  ready_for_disbursement:   { bg: "#DCE7FB", fg: "#1D4ED8" },
  release_pending:          { bg: "#DCE7FB", fg: "#1D4ED8" },
  disbursement_failed:      { bg: "#FEE2E2", fg: "#B91C1C" },
  release_failed:           { bg: "#FEE2E2", fg: "#B91C1C" },
  rejected:                 { bg: "#FEE2E2", fg: "#B91C1C" },
  cancelled:                { bg: "#FEE2E2", fg: "#B91C1C" },
  disbursed:                { bg: "#DCFCE7", fg: "#15803D" },
  completed:                { bg: "#DCFCE7", fg: "#15803D" },
};

export function colorFor(stage: string): { bg: string; fg: string } {
  return STATUS_COLOR[stage] ?? { bg: "#F3F4F6", fg: "#374151" };
}

export function labelFor(stage: string): string {
  return STATUS_LABEL[stage] ?? stage;
}

export function formatNGN(n?: number | null): string {
  return n ? `₦${n.toLocaleString("en-NG")}` : "₦—";
}

export function formatDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function formatDateOnly(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}
