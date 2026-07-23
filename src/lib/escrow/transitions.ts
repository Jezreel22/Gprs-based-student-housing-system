import { HttpError } from "@/lib/api";

/**
 * Centralised escrow state-transition guard.
 *
 * The booking lifecycle is enforced by this table on every admin action.
 * `ALLOWED_TRANSITIONS[from]` lists every `to` status the current row may
 * move into. Anything else returns 409 with a stable `code: "invalid_transition"`
 * so the UI can surface "this booking cannot be verified/released/rejected
 * from its current state."
 *
 * The status set here is the lifecycle as the admin sees it, NOT a parallel
 * machine. Real transitions still happen via the same code paths
 * (`markBookingPaid`, `releaseBookingEscrow`, `markBookingDisbursed`) — this
 * guard runs first and rejects bad calls before they touch any service.
 *
 * Notes:
 *  - `under_verification_by_officer_at` is a flag, not a status. The flag is
 *    set/cleared alongside these transitions but does not itself appear here.
 *  - `release_failed` and `cancelled` are terminal-ish: they can recover to
 *    `pending_review` (retry the release) or stay terminal. `completed` is
 *    truly terminal — no transitions out.
 */
export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  pending_payment: ["pending_occupancy", "cancelled"],
  pending_occupancy: ["pending_review", "release_pending", "release_failed", "cancelled"],
  // `under_verification_by_officer_at` is set during this stage for bank
  // transfers. The transition itself is to `pending_review` once verified.
  pending_review: ["release_pending", "release_failed", "cancelled"],
  release_pending: ["completed", "release_failed"],
  release_failed: ["release_pending", "completed", "cancelled"],
  // Officer can cancel a pre-disbursement booking with a reason.
  cancelled: [],
  // `completed` is terminal — no transitions out. Disbursement is final.
  completed: [],
};

/**
 * Throws `HttpError(409, "Invalid transition: ...")` if `from → to` is not
 * allowed. Use before any conditional UPDATE so an invalid request never
 * reaches the DB layer.
 */
export function assertTransitionAllowed(from: string, to: string): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  // If `from` is unknown we still reject — anything outside the lifecycle is
  // by definition not allowed to transition.
  if (!allowed || !allowed.includes(to)) {
    throw new HttpError(
      `Invalid transition: ${from} → ${to}`,
      409,
    );
  }
}

/**
 * Convenience for the UI: is `target` reachable from `from`? Used to decide
 * which buttons to render in the detail drawer.
 */
export function canTransition(from: string, to: string): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed?.includes(to));
}

/**
 * Stable status names the API contract returns. Mirrored in
 * `src/app/admin/escrow/status.ts` so the client label table and the server
 * guard agree on the same strings.
 */
export const ESCROW_STATUSES = [
  "pending_payment",
  "pending_occupancy",
  "pending_review",
  "release_pending",
  "release_failed",
  "cancelled",
  "completed",
] as const;

export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

/**
 * Human-facing labels for the admin escrow ledger. The client status table
 * re-exports the same map so badge text never drifts between server and UI.
 */
export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Payment pending",
  pending_occupancy: "Payment received",
  pending_review: "Verified",
  release_pending: "Ready for disbursement",
  release_failed: "Disbursement failed",
  cancelled: "Rejected",
  completed: "Disbursed",
};
