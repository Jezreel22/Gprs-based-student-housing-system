/**
 * Repository for the `escrow_transactions` and `escrow_receipts` tables.
 *
 * This is the only layer that performs INSERT / UPSERT against those tables.
 * The higher-level service module decides *when* to call these. Anything
 * that needs to read a transaction or receipt for rendering should also go
 * through this module so we keep all queries in one place.
 *
 * Idempotency strategy:
 *   - deposit / release / refund rows are keyed by
 *     (booking_id, transaction_type, settlement_key). The first confirmed
 *     settlement for a given key wins; webhook retries return the existing
 *     row instead of creating duplicates.
 *   - replayed provider events are deduplicated by `gateway_event_id` via a
 *     partial unique index; the repository returns the existing row when a
 *     provider event repeats.
 *   - receipt numbers are produced by an atomic UPSERT on the daily counter;
 *     the unique `receipt_number` is the last-line invariant.
 */
import { and, asc, desc, eq, inArray, sql, SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bookingsTable,
  escrowReceiptsTable,
  escrowTransactionsTable,
  propertiesTable,
  receiptDailyCountersTable,
  usersTable,
  type Booking,
  type EscrowReceipt,
  type EscrowTransaction,
  type Property,
  type User,
} from "@/lib/db/schema";
import type {
  EscrowPaymentMethod,
  EscrowReceiptKind,
  EscrowTransactionStatus,
  EscrowTransactionType,
  StoredReceiptSnapshot,
} from "./types";

const RECEIPT_KIND_PREFIX: Record<EscrowReceiptKind, string> = {
  deposit: "RCP",
  release: "RLS",
  refund: "REF",
};

/** The current issue of the receipt template. Bump if the layout changes. */
export const RECEIPT_DOCUMENT_VERSION = 1;

const RECEIPT_PREFIX_DOC_VERSION: Record<string, number> = {
  RCP: 1,
  RLS: 1,
  REF: 1,
};

/**
 * Find an existing transaction by its (booking, type, settlement_key) tuple.
 * Used both for "is this an idempotent retry" lookups and for joining later
 * reads to a stable identity.
 */
export async function findTransactionBySettlementKey(args: {
  bookingId: string;
  transactionType: EscrowTransactionType;
  settlementKey: string;
}): Promise<EscrowTransaction | null> {
  const [row] = await db
    .select()
    .from(escrowTransactionsTable)
    .where(
      and(
        eq(escrowTransactionsTable.booking_id, args.bookingId),
        eq(escrowTransactionsTable.transaction_type, args.transactionType),
        eq(escrowTransactionsTable.settlement_key, args.settlementKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findTransactionById(id: string): Promise<EscrowTransaction | null> {
  const [row] = await db
    .select()
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function findTransactionByGatewayEventId(
  gatewayEventId: string,
): Promise<EscrowTransaction | null> {
  if (!gatewayEventId) return null;
  const [row] = await db
    .select()
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.gateway_event_id, gatewayEventId))
    .limit(1);
  return row ?? null;
}

export async function findReceiptByTransactionId(transactionId: string): Promise<EscrowReceipt | null> {
  const [row] = await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.transaction_id, transactionId))
    .limit(1);
  return row ?? null;
}

export async function findReceiptById(id: string): Promise<EscrowReceipt | null> {
  const [row] = await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function findReceiptByVerificationToken(
  token: string,
): Promise<EscrowReceipt | null> {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.verification_token, token))
    .limit(1);
  return row ?? null;
}

export async function findReceiptByReceiptNumber(
  receiptNumber: string,
): Promise<EscrowReceipt | null> {
  const [row] = await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.receipt_number, receiptNumber))
    .limit(1);
  return row ?? null;
}

/**
 * Atomic Lagos-day counter increment.
 *
 * Postgres serialises concurrent UPSERTs on the same key, so the returned
 * `last_value` is unique across all callers. The receipt insert can then
 * assert the unique `receipt_number` invariant as a backup.
 */
async function nextReceiptNumber(args: {
  prefix: string;
  /** ISO date string (yyyy-mm-dd) in Africa/Lagos. */
  lagosDate: string;
}): Promise<number> {
  const [row] = await db
    .insert(receiptDailyCountersTable)
    .values({
      receipt_date: args.lagosDate,
      receipt_prefix: args.prefix,
      last_value: 1,
    })
    .onConflictDoUpdate({
      target: [receiptDailyCountersTable.receipt_date, receiptDailyCountersTable.receipt_prefix],
      set: { last_value: sql`${receiptDailyCountersTable.last_value} + 1` },
    })
    .returning({ last_value: receiptDailyCountersTable.last_value });
  return row?.last_value ?? 0;
}

function formatReceiptNumber(prefix: string, lagosDate: string, seq: number): string {
  // YYYY-MM-DD -> YYYYMMDD
  const compact = lagosDate.replace(/-/g, "");
  return `${prefix}-${compact}-${String(seq).padStart(6, "0")}`;
}

export interface CreateTransactionInput {
  bookingId: string;
  transactionType: EscrowTransactionType;
  settlementKey: string;
  paymentMethod: EscrowPaymentMethod;
  amountNgn: number;
  currency?: string;
  gateway?: string | null;
  gatewayReference?: string | null;
  gatewayTransactionId?: string | null;
  gatewayTransferCode?: string | null;
  gatewayEventId?: string | null;
  originalTransactionId?: string | null;
  initiatedByUserId?: string | null;
  evidenceUploadId?: string | null;
}

/**
 * Insert a new transaction row. The unique index on
 * (booking_id, transaction_type, settlement_key) makes this safe under
 * concurrent webhook retries — the second writer gets a unique violation
 * and we resolve to the existing row in `findTransactionBySettlementKey`.
 */
export async function createTransaction(
  input: CreateTransactionInput,
): Promise<EscrowTransaction> {
  const [row] = await db
    .insert(escrowTransactionsTable)
    .values({
      booking_id: input.bookingId,
      transaction_type: input.transactionType,
      settlement_key: input.settlementKey,
      payment_method: input.paymentMethod,
      amount_ngn: input.amountNgn,
      currency: input.currency ?? "NGN",
      gateway: input.gateway ?? null,
      gateway_reference: input.gatewayReference ?? null,
      gateway_transaction_id: input.gatewayTransactionId ?? null,
      gateway_transfer_code: input.gatewayTransferCode ?? null,
      gateway_event_id: input.gatewayEventId ?? null,
      original_transaction_id: input.originalTransactionId ?? null,
      initiated_by_user_id: input.initiatedByUserId ?? null,
      evidence_upload_id: input.evidenceUploadId ?? null,
      transaction_status: "pending",
    })
    .returning();
  return row;
}

/**
 * Promote a pending transaction to a terminal status. Returns true only if
 * the row actually changed (state guard prevents double-confirmation).
 */
export async function updateTransactionStatus(args: {
  id: string;
  expectedCurrentStatus: EscrowTransactionStatus;
  newStatus: EscrowTransactionStatus;
  confirmedAt?: Date | null;
  failureReason?: string | null;
}): Promise<EscrowTransaction | null> {
  const [row] = await db
    .update(escrowTransactionsTable)
    .set({
      transaction_status: args.newStatus,
      confirmed_at: args.confirmedAt ?? null,
      failure_reason: args.failureReason ?? null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(escrowTransactionsTable.id, args.id),
        eq(escrowTransactionsTable.transaction_status, args.expectedCurrentStatus),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Persist the immutable receipt for a confirmed transaction. Idempotent at
 * the unique (transaction_id) constraint: if a webhook retries after the
 * receipt already exists, this throws a unique violation and the caller
 * resolves the existing row instead.
 */
export async function createReceipt(args: {
  transactionId: string;
  bookingId: string;
  receiptKind: EscrowReceiptKind;
  receiptNumber: string;
  verificationToken: string;
  documentVersion: number;
  snapshot: StoredReceiptSnapshot;
  issuedByUserId?: string | null;
}): Promise<EscrowReceipt> {
  const [row] = await db
    .insert(escrowReceiptsTable)
    .values({
      transaction_id: args.transactionId,
      booking_id: args.bookingId,
      receipt_number: args.receiptNumber,
      receipt_kind: args.receiptKind,
      verification_token: args.verificationToken,
      document_version: args.documentVersion,
      snapshot: args.snapshot as unknown as EscrowReceipt["snapshot"],
      issued_by_user_id: args.issuedByUserId ?? null,
    })
    .returning();
  return row;
}

export interface IssueReceiptNumberInput {
  receiptKind: EscrowReceiptKind;
  /** ISO date string (yyyy-mm-dd) in Africa/Lagos. */
  lagosDate: string;
}

/** Allocate a fresh receipt number for the given kind on the given Lagos day. */
export async function issueReceiptNumber(
  input: IssueReceiptNumberInput,
): Promise<{ receiptNumber: string; documentVersion: number }> {
  const prefix = RECEIPT_KIND_PREFIX[input.receiptKind];
  const seq = await nextReceiptNumber({ prefix, lagosDate: input.lagosDate });
  const receiptNumber = formatReceiptNumber(prefix, input.lagosDate, seq);
  return {
    receiptNumber,
    documentVersion: RECEIPT_PREFIX_DOC_VERSION[prefix] ?? RECEIPT_DOCUMENT_VERSION,
  };
}

export interface ListTransactionsArgs {
  bookingId?: string;
  bookingIds?: string[];
  studentId?: string;
  landlordId?: string;
  receiptKind?: EscrowReceiptKind;
  status?: EscrowTransactionStatus;
  /** Filter by issuance date — inclusive lower bound, ISO yyyy-mm-dd. */
  dateFrom?: string;
  /** Exclusive upper bound, ISO yyyy-mm-dd. */
  dateTo?: string;
  search?: string;
  page: number;
  pageSize: number;
  sort?: "created_at" | "amount_ngn";
  order?: "asc" | "desc";
}

export interface ListTransactionsItem {
  id: string;
  transaction_type: EscrowTransactionType;
  transaction_status: EscrowTransactionStatus;
  amount_ngn: number;
  currency: string;
  payment_method: string;
  gateway_reference: string | null;
  gateway_transfer_code: string | null;
  created_at: string;
  confirmed_at: string | null;
  booking_id: string;
  booking_reference: string | null;
  student_id: string;
  student_name: string | null;
  landlord_id: string;
  landlord_name: string | null;
  property_address: string | null;
  receipt: {
    id: string;
    receipt_number: string;
    receipt_kind: EscrowReceiptKind;
    verification_token: string;
    issued_at: string;
  } | null;
}

export interface ListTransactionsResponse {
  items: ListTransactionsItem[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Single paginated query that joins transactions to their booking, parties,
 * property, and (at most one) receipt. No N+1 — handled by the WHERE/ORDER
 * composition rather than per-row hydration.
 */
export async function listTransactions(args: ListTransactionsArgs): Promise<ListTransactionsResponse> {
  const bookingIdCond: SQL[] = [];
  if (args.bookingId) bookingIdCond.push(eq(escrowTransactionsTable.booking_id, args.bookingId));
  if (args.bookingIds && args.bookingIds.length) {
    bookingIdCond.push(inArray(escrowTransactionsTable.booking_id, args.bookingIds));
  }

  const whereParts: SQL[] = [];
  if (bookingIdCond.length === 1) whereParts.push(bookingIdCond[0]);
  if (bookingIdCond.length > 1) whereParts.push(and(...bookingIdCond)!);
  if (args.receiptKind) whereParts.push(eq(escrowTransactionsTable.transaction_type, args.receiptKind));
  if (args.status) whereParts.push(eq(escrowTransactionsTable.transaction_status, args.status));
  if (args.dateFrom) {
    whereParts.push(sql`${escrowTransactionsTable.created_at} >= ${args.dateFrom}::date`);
  }
  if (args.dateTo) {
    whereParts.push(sql`${escrowTransactionsTable.created_at} < ${args.dateTo}::date`);
  }

  // For participant-scoped searches we resolve the booking rows first. Doing
  // it here keeps the joined query a single statement when possible.
  let bookingScope: string[] | null = null;
  if (args.studentId || args.landlordId) {
    const conds: SQL[] = [];
    if (args.studentId) conds.push(eq(bookingsTable.student_id, args.studentId));
    if (args.landlordId) conds.push(eq(bookingsTable.landlord_id, args.landlordId));
    const rows = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(conds.length === 1 ? conds[0] : and(...conds)!);
    bookingScope = rows.map((r) => r.id);
    if (!bookingScope.length) {
      return { items: [], total: 0, page: args.page, page_size: args.pageSize };
    }
    whereParts.push(inArray(escrowTransactionsTable.booking_id, bookingScope));
  }

  // Search: match on property address or participant names. We pre-resolve
  // matched bookings so the WHERE is over indexed FK columns.
  if (args.search) {
    const needle = `%${args.search}%`;
    const matchedProps = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(sql`${propertiesTable.address} ILIKE ${needle}`);
    const propIds = matchedProps.map((p) => p.id);
    const matchedUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        sql`${usersTable.first_name} ILIKE ${needle}
            OR ${usersTable.last_name} ILIKE ${needle}
            OR (${usersTable.first_name} || ' ' || ${usersTable.last_name}) ILIKE ${needle}
            OR ${usersTable.email} ILIKE ${needle}`,
      );
    const userIds = matchedUsers.map((u) => u.id);
    const matchedBookings = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(
        sql`(${propIds.length ? sql`${bookingsTable.property_id} = ANY(${propIds}::uuid[])` : sql`FALSE`})
           OR ${userIds.length ? sql`${bookingsTable.student_id} = ANY(${userIds}::uuid[])` : sql`FALSE`}
           OR ${userIds.length ? sql`${bookingsTable.landlord_id} = ANY(${userIds}::uuid[])` : sql`FALSE`}`,
      );
    const searchBookingIds = matchedBookings.map((b) => b.id);
    if (!searchBookingIds.length) {
      return { items: [], total: 0, page: args.page, page_size: args.pageSize };
    }
    whereParts.push(inArray(escrowTransactionsTable.booking_id, searchBookingIds));
  }

  const whereExpr = whereParts.length === 0 ? undefined
    : whereParts.length === 1 ? whereParts[0]
    : and(...whereParts);

  const totalRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(escrowTransactionsTable)
    .where(whereExpr);
  const total = totalRow[0]?.count ?? 0;

  const sortColumn = args.sort === "amount_ngn"
    ? escrowTransactionsTable.amount_ngn
    : escrowTransactionsTable.created_at;
  const direction = args.order === "asc" ? asc : desc;

  const offset = (args.page - 1) * args.pageSize;
  const txRows = await db
    .select()
    .from(escrowTransactionsTable)
    .where(whereExpr)
    .orderBy(direction(sortColumn))
    .limit(args.pageSize)
    .offset(offset);

  if (!txRows.length) {
    return { items: [], total, page: args.page, page_size: args.pageSize };
  }

  // Hydrate the joined shape (booking, parties, property, receipt) in three
  // targeted batched reads so the row count above doesn't N+1.
  const bookingIds = Array.from(new Set(txRows.map((t) => t.booking_id)));
  const [bookings, properties, receipts] = await Promise.all([
    db
      .select({
        id: bookingsTable.id,
        student_id: bookingsTable.student_id,
        landlord_id: bookingsTable.landlord_id,
        property_id: bookingsTable.property_id,
        escrow_account_reference: bookingsTable.escrow_account_reference,
      })
      .from(bookingsTable)
      .where(inArray(bookingsTable.id, bookingIds)),
    db
      .select({ id: propertiesTable.id, address: propertiesTable.address })
      .from(propertiesTable)
      .where(
        inArray(
          propertiesTable.id,
          Array.from(new Set(txRows.map((t) => bookingScope ? t.booking_id : t.booking_id))),
        ),
      ),
    db
      .select()
      .from(escrowReceiptsTable)
      .where(
        inArray(
          escrowReceiptsTable.transaction_id,
          txRows.map((t) => t.id),
        ),
      ),
  ]);

  const userIds = Array.from(new Set(bookings.flatMap((b) => [b.student_id, b.landlord_id])));
  const users = userIds.length
    ? await db
        .select({ id: usersTable.id, first_name: usersTable.first_name, last_name: usersTable.last_name })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];

  const bookingMap = new Map(bookings.map((b) => [b.id, b]));
  const propertyMap = new Map(properties.map((p) => [p.id, p]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const receiptByTx = new Map(receipts.map((r) => [r.transaction_id, r]));

  const items: ListTransactionsItem[] = txRows.map((t) => {
    const booking = bookingMap.get(t.booking_id);
    const student = booking ? userMap.get(booking.student_id) : null;
    const landlord = booking ? userMap.get(booking.landlord_id) : null;
    const property = booking ? propertyMap.get(booking.property_id) : null;
    const receipt = receiptByTx.get(t.id);
    return {
      id: t.id,
      transaction_type: t.transaction_type as EscrowTransactionType,
      transaction_status: t.transaction_status as EscrowTransactionStatus,
      amount_ngn: t.amount_ngn,
      currency: t.currency,
      payment_method: t.payment_method,
      gateway_reference: t.gateway_reference ?? null,
      gateway_transfer_code: t.gateway_transfer_code ?? null,
      created_at: t.created_at?.toISOString() ?? new Date().toISOString(),
      confirmed_at: t.confirmed_at?.toISOString() ?? null,
      booking_id: t.booking_id,
      booking_reference: booking?.escrow_account_reference ?? null,
      student_id: booking?.student_id ?? "",
      student_name: student ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() : null,
      landlord_id: booking?.landlord_id ?? "",
      landlord_name: landlord ? `${landlord.first_name ?? ""} ${landlord.last_name ?? ""}`.trim() : null,
      property_address: property?.address ?? null,
      receipt: receipt
        ? {
            id: receipt.id,
            receipt_number: receipt.receipt_number,
            receipt_kind: receipt.receipt_kind as EscrowReceiptKind,
            verification_token: receipt.verification_token,
            issued_at: receipt.issued_at.toISOString(),
          }
        : null,
    };
  });

  return { items, total, page: args.page, page_size: args.pageSize };
}

/**
 * Look up the bookings a user is a party to so we can scope the transaction
 * ledger. Used by the participant-scoped `/api/transactions` GET endpoint.
 */
export async function findBookingIdsForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(
      sql`${bookingsTable.student_id} = ${userId}
          OR ${bookingsTable.landlord_id} = ${userId}`,
    );
  return rows.map((r) => r.id);
}

export interface TransactionDetailBundle {
  transaction: EscrowTransaction;
  receipt: EscrowReceipt | null;
  booking: Booking | null;
  student: User | null;
  landlord: User | null;
  property: Property | null;
}

/**
 * Single batched read for the transaction-detail screen. All five joins in
 * one round of lookups to avoid N+1 over user/property/booking/receipt.
 */
export async function loadTransactionDetail(
  transactionId: string,
): Promise<TransactionDetailBundle | null> {
  const [tx] = await db
    .select()
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.id, transactionId))
    .limit(1);
  if (!tx) return null;

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, tx.booking_id))
    .limit(1);
  const [receipt] = await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.transaction_id, tx.id))
    .limit(1);

  const userIds = booking ? [booking.student_id, booking.landlord_id] : [];
  const userRows = userIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const student = userRows.find((u) => booking && u.id === booking.student_id) ?? null;
  const landlord = userRows.find((u) => booking && u.id === booking.landlord_id) ?? null;

  const [property] = booking
    ? await db.select().from(propertiesTable).where(eq(propertiesTable.id, booking.property_id)).limit(1)
    : [];

  return { transaction: tx, receipt: receipt ?? null, booking: booking ?? null, student, landlord, property: property ?? null };
}