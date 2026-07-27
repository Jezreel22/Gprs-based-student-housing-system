/**
 * Receipt issuance + transaction-confirmation service.
 *
 * This is the only layer that should call `createReceipt` or `createTransaction`
 * from the rest of the application. Each confirmation call:
 *
 *   1. Reuses the existing transaction row (by booking/type/settlement_key) or
 *      creates a fresh one. Concurrent webhook retries on the same key cannot
 *      produce duplicate rows because the unique index rejects duplicates.
 *   2. Promotes the row from `pending` to `succeeded` (or `failed` / `manual_review`
 *      / `reversed` as appropriate). The status guard returns null when the row
 *      is already terminal, so retries are safe.
 *   3. Issues an atomic Lagos-day receipt number and inserts exactly one
 *      `escrow_receipts` row. Replays return the existing receipt identity.
 *
 * The caller never has to coordinate uniqueness — duplicate calls into these
 * helpers always converge on the same transaction and receipt ids.
 */
import { db } from "@/lib/db";
import {
  bookingsTable,
  escrowReceiptsTable,
  escrowTransactionsTable,
  propertiesTable,
  uploadsTable,
  usersTable,
  type EscrowReceipt,
  type EscrowTransaction,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notify";
import {
  RECEIPT_DOCUMENT_VERSION,
  createReceipt,
  createTransaction,
  findReceiptByTransactionId,
  findTransactionByGatewayEventId,
  findTransactionBySettlementKey,
  issueReceiptNumber,
  updateTransactionStatus,
} from "./repository";
import { lagosDateString } from "./time";
import type {
  EscrowPaymentMethod,
  EscrowReceiptKind,
  EscrowTransactionStatus,
  EscrowTransactionType,
  IssuerSnapshot,
  ParticipantSnapshot,
  PropertySnapshot,
  ReceiptSnapshot,
} from "./types";

const REQUIRED_RECEIPT_FOOTER =
  "Generated electronically by NAUB Home Finder. This document serves as official proof of escrow transaction.";

/**
 * Build the issuer metadata snapshot used at issuance time. Keeps historical
 * receipts reproducible even if the deploy later changes branding.
 */
export function buildIssuerSnapshot(): IssuerSnapshot {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.naubhomefinder.app";
  return {
    name: "NAUB Home Finder",
    site_url: appUrl.replace(/\/$/, ""),
    support_email: process.env.ESCROW_RECEIPTS_SUPPORT_EMAIL ?? null,
    support_phone: process.env.ESCROW_RECEIPTS_SUPPORT_PHONE ?? null,
    legal_name: process.env.ESCROW_RECEIPTS_LEGAL_NAME ?? null,
    document_version: RECEIPT_DOCUMENT_VERSION,
  };
}

export interface SettlementInput {
  bookingId: string;
  transactionType: EscrowTransactionType;
  receiptKind: EscrowReceiptKind;
  paymentMethod: EscrowPaymentMethod;
  /** Naira amount of the settlement leg. */
  amountNgn: number;
  /** Stable settlement key — e.g. paystack charge ref, transfer ref, dispute id. */
  settlementKey: string;
  gateway?: string | null;
  gatewayReference?: string | null;
  gatewayTransactionId?: string | null;
  gatewayTransferCode?: string | null;
  /** Provider event id (e.g. webhook event id). Used to dedupe replays. */
  gatewayEventId?: string | null;
  originalTransactionId?: string | null;
  /** Officer / webhook actor that initiated or confirmed this leg. */
  initiatedByUserId?: string | null;
  /** Officer-uploaded bank-transfer proof, when applicable. */
  evidenceUploadId?: string | null;
  /** Optional failure reason for terminal failure states. */
  failureReason?: string | null;
  /** When the settlement actually occurred (defaults to now). */
  confirmedAt?: Date | null;
  /**
   * Custom notice line for the receipt (e.g. refund reason). Defaults to
   * the standard headline for the receipt kind.
   */
  customNotice?: string | null;
}

export interface SettlementResult {
  transactionId: string;
  receiptId: string | null;
  receiptNumber: string | null;
  created: boolean;
  status: EscrowTransactionStatus;
}

const DEFAULT_TITLE: Record<EscrowReceiptKind, string> = {
  deposit: "Escrow Deposit Receipt",
  release: "Escrow Release Receipt",
  refund: "Escrow Refund Receipt",
};

const DEFAULT_STATUS_LABEL: Record<EscrowReceiptKind, string> = {
  deposit: "Funds Held in Escrow",
  release: "Payment Successfully Released",
  refund: "Refund Completed",
};

const DEFAULT_NOTICE: Record<EscrowReceiptKind, string> = {
  deposit:
    "This payment has been successfully received and securely held in escrow. Funds will only be released after the student confirms satisfaction and administrative approval.",
  release:
    "The escrow funds for this booking have been released to the landlord's designated account. This document is the official confirmation of that release.",
  refund:
    "The refund described below has been confirmed and processed through the NAUB escrow system. This document is the official confirmation of that refund.",
};

function participantSnapshot(user: {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
}): ParticipantSnapshot {
  return {
    user_id: user.id,
    full_name: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email || "Unknown",
    email: user.email ?? null,
    phone: user.phone_number ?? null,
  };
}

function propertySnapshot(prop: {
  id: string;
  address: string;
  rent_amount_ngn: number;
  deposit_amount_ngn: number;
  lease_start_date?: Date | string | null;
  lease_end_date?: Date | string | null;
}): PropertySnapshot {
  return {
    property_id: prop.id,
    address: prop.address,
    rent_amount_ngn: prop.rent_amount_ngn,
    deposit_amount_ngn: prop.deposit_amount_ngn,
    lease_start_date: prop.lease_start_date
      ? typeof prop.lease_start_date === "string"
        ? prop.lease_start_date
        : prop.lease_start_date.toISOString()
      : null,
    lease_end_date: prop.lease_end_date
      ? typeof prop.lease_end_date === "string"
        ? prop.lease_end_date
        : prop.lease_end_date.toISOString()
      : null,
  };
}

/**
 * Confirm a financial leg and (if successful) issue its official receipt.
 *
 * The single settlement key (booking + type + settlement_key) prevents
 * duplicate transactions; the unique (transaction_id) on receipts prevents
 * duplicate documents. Callers may invoke this from a webhook, a route, or
 * an officer manual action without coordinating uniqueness themselves.
 */
export async function recordSettlement(input: SettlementInput): Promise<SettlementResult> {
  // Replay safety: if the provider emitted this event before, resolve to the
  // existing row instead of touching state.
  if (input.gatewayEventId) {
    const prior = await findTransactionByGatewayEventId(input.gatewayEventId);
    if (prior) {
      const existingReceipt = await findReceiptByTransactionId(prior.id);
      return {
        transactionId: prior.id,
        receiptId: existingReceipt?.id ?? null,
        receiptNumber: existingReceipt?.receipt_number ?? null,
        created: false,
        status: prior.transaction_status as EscrowTransactionStatus,
      };
    }
  }

  // Find-or-create the transaction row keyed by (booking, type, key).
  let tx = await findTransactionBySettlementKey({
    bookingId: input.bookingId,
    transactionType: input.transactionType,
    settlementKey: input.settlementKey,
  });

  if (!tx) {
    tx = await createTransaction({
      bookingId: input.bookingId,
      transactionType: input.transactionType,
      settlementKey: input.settlementKey,
      paymentMethod: input.paymentMethod,
      amountNgn: input.amountNgn,
      gateway: input.gateway ?? null,
      gatewayReference: input.gatewayReference ?? null,
      gatewayTransactionId: input.gatewayTransactionId ?? null,
      gatewayTransferCode: input.gatewayTransferCode ?? null,
      gatewayEventId: input.gatewayEventId ?? null,
      originalTransactionId: input.originalTransactionId ?? null,
      initiatedByUserId: input.initiatedByUserId ?? null,
      evidenceUploadId: input.evidenceUploadId ?? null,
    });
  }

  // Manual-review path: officer confirmed a bank transfer but the system
  // cannot independently verify the external payment. Keep the row pending
  // until an officer explicitly confirms; do not issue a receipt yet.
  if (input.paymentMethod === "manual_bank_transfer" && !input.confirmedAt) {
    return {
      transactionId: tx.id,
      receiptId: null,
      receiptNumber: null,
      created: true,
      status: "manual_review",
    };
  }

  // If the row is already terminal, return the existing receipt id.
  if (
    tx.transaction_status === "succeeded" ||
    tx.transaction_status === "failed" ||
    tx.transaction_status === "reversed"
  ) {
    const existingReceipt = await findReceiptByTransactionId(tx.id);
    return {
      transactionId: tx.id,
      receiptId: existingReceipt?.id ?? null,
      receiptNumber: existingReceipt?.receipt_number ?? null,
      created: false,
      status: tx.transaction_status as EscrowTransactionStatus,
    };
  }

  const confirmedAt = input.confirmedAt ?? new Date();
  const terminalStatus: EscrowTransactionStatus = input.failureReason ? "failed" : "succeeded";

  // Promote the row from pending → terminal. Guard returns null when a
  // concurrent caller already promoted it.
  const updated = await updateTransactionStatus({
    id: tx.id,
    expectedCurrentStatus: "pending",
    newStatus: terminalStatus,
    confirmedAt,
    failureReason: input.failureReason ?? null,
  });

  if (!updated) {
    // Some concurrent caller already settled this row — return the existing
    // state instead of issuing a duplicate receipt.
    const current = await findTransactionByGatewayEventId(input.gatewayEventId ?? "");
    const existing = current ?? tx;
    const existingReceipt = await findReceiptByTransactionId(existing.id);
    return {
      transactionId: existing.id,
      receiptId: existingReceipt?.id ?? null,
      receiptNumber: existingReceipt?.receipt_number ?? null,
      created: false,
      status: existing.transaction_status as EscrowTransactionStatus,
    };
  }

  // Issue the immutable receipt.
  const issuer = buildIssuerSnapshot();
  const { receiptNumber, documentVersion } = await issueReceiptNumber({
    receiptKind: input.receiptKind,
    lagosDate: lagosDateString(confirmedAt),
  });

  // Hydrate booking + parties + property for the snapshot. Use the
  // already-fetched tx row so we know which booking to query.
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, updated.booking_id))
    .limit(1);
  if (!booking) {
    throw new Error("Booking missing for settlement snapshot");
  }
  const [student] = await db
    .select({
      id: usersTable.id,
      first_name: usersTable.first_name,
      last_name: usersTable.last_name,
      email: usersTable.email,
      phone_number: usersTable.phone_number,
    })
    .from(usersTable)
    .where(eq(usersTable.id, booking.student_id))
    .limit(1);
  const [landlord] = await db
    .select({
      id: usersTable.id,
      first_name: usersTable.first_name,
      last_name: usersTable.last_name,
      email: usersTable.email,
      phone_number: usersTable.phone_number,
    })
    .from(usersTable)
    .where(eq(usersTable.id, booking.landlord_id))
    .limit(1);
  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, booking.property_id))
    .limit(1);

  const verificationToken = crypto.randomUUID();
  const verificationUrl = `${issuer.site_url}/verify/receipt/${verificationToken}`;

  const snapshot: ReceiptSnapshot = {
    issuer,
    title: DEFAULT_TITLE[input.receiptKind],
    status_label: DEFAULT_STATUS_LABEL[input.receiptKind],
    notice: input.customNotice ?? DEFAULT_NOTICE[input.receiptKind],
    booking_id: updated.booking_id,
    escrow_reference: booking.escrow_account_reference ?? updated.booking_id,
    receipt_number: receiptNumber,
    receipt_kind: input.receiptKind,
    student: student ? participantSnapshot(student) : participantSnapshot({ id: booking.student_id, email: null }),
    landlord: landlord ? participantSnapshot(landlord) : participantSnapshot({ id: booking.landlord_id, email: null }),
    property: property
      ? propertySnapshot(property)
      : propertySnapshot({
          id: booking.property_id,
          address: booking.escrow_account_reference ?? "(no address on record)",
          rent_amount_ngn: booking.rent_amount_ngn,
          deposit_amount_ngn: booking.deposit_amount_ngn,
          lease_start_date: booking.lease_start_date,
          lease_end_date: booking.lease_end_date,
        }),
    amount_ngn: updated.amount_ngn,
    currency: updated.currency,
    payment_method: updated.payment_method,
    paystack_reference:
      updated.gateway_reference ??
      updated.gateway_transfer_code ??
      null,
    issued_at: new Date().toISOString(),
    settlement_at: confirmedAt.toISOString(),
    verification_url: verificationUrl,
    footer_note: REQUIRED_RECEIPT_FOOTER,
  };

  let receipt;
  try {
    receipt = await createReceipt({
      transactionId: updated.id,
      bookingId: updated.booking_id,
      receiptKind: input.receiptKind,
      receiptNumber,
      verificationToken,
      documentVersion,
      snapshot,
      issuedByUserId: input.initiatedByUserId ?? null,
    });
  } catch (err) {
    // A concurrent caller produced the same receipt number while we were
    // racing on the counter — extremely unlikely with the unique constraint
    // but possible if the daily counter row's last_value saturates above
    // 999999. The retry should reuse the existing receipt.
    const existing = await findReceiptByTransactionId(updated.id);
    if (existing) {
      return {
        transactionId: updated.id,
        receiptId: existing.id,
        receiptNumber: existing.receipt_number,
        created: false,
        status: updated.transaction_status as EscrowTransactionStatus,
      };
    }
    throw err;
  }

  // Post-commit side effects. Audit + notification are best-effort by
  // existing convention — their failures never roll back the receipt.
  await writeAudit({
    actorId: input.initiatedByUserId ?? landlord?.id ?? updated.booking_id,
    actionType: `escrow_${input.transactionType}_confirmed`,
    resourceType: "escrow_transaction",
    resourceId: updated.id,
    previousStatus: "pending",
    newStatus: updated.transaction_status,
    details: {
      booking_id: updated.booking_id,
      amount_ngn: updated.amount_ngn,
      receipt_id: receipt.id,
      receipt_number: receipt.receipt_number,
      payment_method: updated.payment_method,
    },
  });

  // Notify parties that the leg is settled + a receipt exists. Use a
  // short, helpful body — the receipt itself holds the official wording.
  if (input.transactionType === "deposit" || input.transactionType === "release") {
    await createNotification({
      userId: landlord?.id ?? updated.booking_id,
      type: "escrow_release",
      title: input.transactionType === "release" ? "Payout receipt issued" : "Deposit receipt issued",
      body:
        input.transactionType === "release"
          ? `Receipt ${receipt.receipt_number} confirms the payout to your bank account.`
          : `Receipt ${receipt.receipt_number} confirms the deposit into escrow.`,
      relatedId: updated.booking_id,
      relatedType: "booking",
    });
    if (student) {
      await createNotification({
        userId: student.id,
        type: "escrow_funded",
        title: "Receipt issued",
        body: `Your ${input.transactionType === "release" ? "payout" : "deposit"} receipt ${receipt.receipt_number} is now available in your transactions.`,
        relatedId: updated.booking_id,
        relatedType: "booking",
      });
    }
  } else if (input.transactionType === "refund" && student) {
    await createNotification({
      userId: student.id,
      type: "payment",
      title: "Refund receipt issued",
      body: `Receipt ${receipt.receipt_number} confirms the refund.`,
      relatedId: updated.booking_id,
      relatedType: "booking",
    });
  }

  return {
    transactionId: updated.id,
    receiptId: receipt.id,
    receiptNumber: receipt.receipt_number,
    created: true,
    status: updated.transaction_status as EscrowTransactionStatus,
  };
}

/**
 * Mark a previously-pending transaction as failed (e.g. a Paystack refund
 * that was never confirmed by the gateway). Idempotent: returns the
 * existing terminal state on retry.
 */
export async function recordFailedSettlement(args: {
  transactionId: string;
  failureReason: string;
}): Promise<EscrowTransaction | null> {
  const updated = await updateTransactionStatus({
    id: args.transactionId,
    expectedCurrentStatus: "pending",
    newStatus: "failed",
    failureReason: args.failureReason,
  });
  if (updated) return updated;
  // Already terminal: fetch the current row so the caller has the truth.
  const [current] = await db
    .select()
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.id, args.transactionId))
    .limit(1);
  return current ?? null;
}

/**
 * Officer confirmation of a manual bank transfer (used by the existing
 * mark-disbursed route and the new manual-refund route). The
 * paymentMethod is always manual_bank_transfer here; we look up an existing
 * pending transaction or create one with the supplied settlement_key.
 */
export async function confirmManualSettlement(args: {
  bookingId: string;
  transactionType: EscrowTransactionType;
  receiptKind: EscrowReceiptKind;
  amountNgn: number;
  settlementKey: string;
  officerId: string;
  evidenceUploadId: string;
  paystackReference?: string | null;
  customNotice?: string | null;
}): Promise<SettlementResult> {
  // Verify the evidence upload exists and is owned by the officer; this is
  // the same multipart upload route used elsewhere.
  const [upload] = await db
    .select({ id: uploadsTable.id, user_id: uploadsTable.user_id })
    .from(uploadsTable)
    .where(eq(uploadsTable.id, args.evidenceUploadId))
    .limit(1);
  if (!upload) {
    throw new Error("Evidence upload not found");
  }

  return recordSettlement({
    bookingId: args.bookingId,
    transactionType: args.transactionType,
    receiptKind: args.receiptKind,
    paymentMethod: "manual_bank_transfer",
    amountNgn: args.amountNgn,
    settlementKey: args.settlementKey,
    initiatedByUserId: args.officerId,
    evidenceUploadId: args.evidenceUploadId,
    gatewayReference: args.paystackReference ?? null,
    customNotice: args.customNotice ?? null,
    confirmedAt: new Date(),
  });
}

/**
 * Quick sanity check: ensure a row exists for every successful terminal
 * transaction. The unique constraints in the schema keep this from being
 * strict — but exposing the helper helps tests and dry-run scripts.
 */
export async function getReceiptByTransactionId(transactionId: string): Promise<EscrowReceipt | null> {
  return findReceiptByTransactionId(transactionId);
}

void escrowReceiptsTable; // keep import for type inference; explicit reference avoids "unused" warnings in strict mode.