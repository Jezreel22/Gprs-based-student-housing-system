/**
 * Shared types for the escrow financial-transactions + receipts module.
 *
 * All money is stored in integer Naira (₦). Paystack amounts are converted
 * to kobo at the gateway boundary; receipts and APIs always expose naira.
 */
export type EscrowTransactionType = "deposit" | "release" | "refund";

export type EscrowTransactionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "reversed"
  | "manual_review";

export type EscrowPaymentMethod =
  | "paystack"
  | "bank_transfer"
  | "manual_bank_transfer";

export type EscrowReceiptKind = "deposit" | "release" | "refund";

export interface IssuerSnapshot {
  /** Issuer's display name (e.g. "NAUB Home Finder"). */
  name: string;
  /** Public-facing site URL used for the verification URL inside the QR. */
  site_url: string;
  /** Optional support email printed on the receipt. */
  support_email: string | null;
  /** Optional support phone printed on the receipt. */
  support_phone: string | null;
  /** Optional legal entity line, e.g. a registered company name. */
  legal_name: string | null;
  /** Document template version captured at issuance time. */
  document_version: number;
}

export interface ParticipantSnapshot {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

export interface PropertySnapshot {
  property_id: string;
  address: string;
  rent_amount_ngn: number;
  deposit_amount_ngn: number;
  lease_start_date: string | null;
  lease_end_date: string | null;
}

export interface ReceiptSnapshot {
  /** Top-level issuer metadata captured at issuance time. */
  issuer: IssuerSnapshot;
  /** Document title shown in the header (e.g. "Escrow Deposit Receipt"). */
  title: string;
  /** Headline status text shown next to the status badge. */
  status_label: string;
  /** Free-form notice displayed below the headline. */
  notice: string;
  /** Booking identifier (also serves as escrow id). */
  booking_id: string;
  /** Booking-level escrow reference (human-friendly code). */
  escrow_reference: string;
  /** Issued receipt number, e.g. "RCP-20260727-000001". */
  receipt_number: string;
  /** Transaction type covered by this receipt. */
  receipt_kind: EscrowReceiptKind;
  /** Snapshot of the parties as they appeared at issuance. */
  student: ParticipantSnapshot;
  landlord: ParticipantSnapshot;
  /** Snapshot of the property as it appeared at issuance. */
  property: PropertySnapshot;
  /** Amount settled in naira (integer, never fractional). */
  amount_ngn: number;
  /** ISO 4217 currency code, e.g. "NGN". */
  currency: string;
  /** "paystack" / "bank_transfer" / "manual_bank_transfer". */
  payment_method: string;
  /** Provider reference (transaction or transfer reference). */
  paystack_reference: string | null;
  /** ISO timestamp the receipt was issued. */
  issued_at: string;
  /** ISO timestamp the underlying settlement was confirmed. */
  settlement_at: string | null;
  /** Public verification URL — embedded in the QR. */
  verification_url: string;
  /** Required by the receipt template. */
  footer_note: string;
}

/**
 * Persisted shape of an `escrow_receipts.snapshot` row — exactly what is
 * written to the database at issuance time.
 */
export type StoredReceiptSnapshot = ReceiptSnapshot;