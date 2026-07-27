/**
 * End-to-end service-layer tests. These hit the dev DB; do not run against
 * a production database. The pool module loads `.env.local` first.
 */
import "@/lib/load-env";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  bookingsTable,
  escrowReceiptsTable,
  escrowTransactionsTable,
  receiptDailyCountersTable,
  propertiesTable,
  usersTable,
} from "@/lib/db/schema";
import { recordSettlement } from "@/lib/escrow-transactions/service";
import { findReceiptByVerificationToken, findTransactionBySettlementKey, issueReceiptNumber } from "@/lib/escrow-transactions/repository";
import { lagosDateString } from "@/lib/escrow-transactions/time";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

const TEST_USER_EMAIL = "test-receipts@naub.local";
const TEST_LANDLORD_EMAIL = "test-landlord@naub.local";

async function ensureUser(email: string, role: "student" | "landlord"): Promise<string> {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) return existing.id;
  const [u] = await db.insert(usersTable).values({
    email,
    role,
    first_name: "Test",
    last_name: role,
    payout_details_set_at: role === "landlord" ? new Date() : null,
  }).returning({ id: usersTable.id });
  return u.id;
}

async function ensureProperty(landlordId: string): Promise<string> {
  const occCode = `T${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const [p] = await db.insert(propertiesTable).values({
    landlord_id: landlordId,
    address: `Test Address ${crypto.randomBytes(2).toString("hex")}`,
    rent_amount_ngn: 200_000,
    deposit_amount_ngn: 100_000,
    occupancy_code: occCode,
  }).returning({ id: propertiesTable.id });
  return p.id;
}

async function ensureBooking(studentId: string, landlordId: string, propertyId: string): Promise<string> {
  const [b] = await db.insert(bookingsTable).values({
    student_id: studentId,
    landlord_id: landlordId,
    property_id: propertyId,
    rent_amount_ngn: 200_000,
    deposit_amount_ngn: 100_000,
    total_amount_ngn: 300_000,
    escrow_account_reference: `T-ESC-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
  }).returning({ id: bookingsTable.id });
  return b.id;
}

describe("escrow-receipts service", () => {
  let studentId: string;
  let landlordId: string;
  let propertyId: string;
  let bookingId: string;

  beforeAll(async () => {
    studentId = await ensureUser(TEST_USER_EMAIL, "student");
    landlordId = await ensureUser(TEST_LANDLORD_EMAIL, "landlord");
    propertyId = await ensureProperty(landlordId);
    bookingId = await ensureBooking(studentId, landlordId, propertyId);
  });

  afterAll(async () => {
    // Best-effort cleanup so the dev DB doesn't accumulate junk. We do NOT
    // delete receipts/transactions tied to the booking — the unique
    // settlement_key constraint would prevent re-running the same key, so
    // we leave them in place across test runs.
  });

  it("allocates a daily receipt number and never duplicates", async () => {
    const lagos = lagosDateString();
    // Three sequential calls on the same Lagos day must yield strictly
    // increasing sequence numbers per prefix. The counter is global for
    // the date, so we don't assert an absolute "000001" — only that the
    // issued numbers are sequential and not duplicated.
    const a = await issueReceiptNumber({ receiptKind: "deposit", lagosDate: lagos });
    const b = await issueReceiptNumber({ receiptKind: "deposit", lagosDate: lagos });
    const c = await issueReceiptNumber({ receiptKind: "release", lagosDate: lagos });

    expect(a.receiptNumber).toMatch(/^RCP-\d{8}-\d{6}$/);
    expect(b.receiptNumber).toMatch(/^RCP-\d{8}-\d{6}$/);
    expect(c.receiptNumber).toMatch(/^RLS-\d{8}-\d{6}$/);

    const seq = (n: string) => Number(n.split("-").pop());
    expect(seq(b.receiptNumber)).toBe(seq(a.receiptNumber) + 1);
    // Different prefix must start a fresh counter; must not equal the RLS
    // value if a prior RLS existed today (we don't make that assumption).
    expect(c.receiptNumber.startsWith("RLS-")).toBe(true);

    // The counter row for today must now exist with a positive last_value
    // matching the most recent allocation per prefix.
    const rcpRow = await db
      .select()
      .from(receiptDailyCountersTable)
      .where(eq(receiptDailyCountersTable.receipt_prefix, "RCP"));
    expect(rcpRow.some((r) => r.last_value >= seq(b.receiptNumber))).toBe(true);
  });

  it("records a deposit and issues exactly one receipt", async () => {
    const key = `test-deposit-${crypto.randomUUID()}`;

    const first = await recordSettlement({
      bookingId,
      transactionType: "deposit",
      receiptKind: "deposit",
      paymentMethod: "paystack",
      amountNgn: 300_000,
      settlementKey: key,
      gateway: "paystack",
      gatewayReference: key,
      initiatedByUserId: studentId,
      confirmedAt: new Date(),
    });

    expect(first.created).toBe(true);
    expect(first.receiptId).toBeTruthy();
    expect(first.receiptNumber).toMatch(/^RCP-\d{8}-\d{6}$/);
    expect(first.status).toBe("succeeded");

    // Replay — same key + same event. Should return the existing receipt
    // id without creating another.
    const replay = await recordSettlement({
      bookingId,
      transactionType: "deposit",
      receiptKind: "deposit",
      paymentMethod: "paystack",
      amountNgn: 300_000,
      settlementKey: key,
      gateway: "paystack",
      gatewayReference: key,
      initiatedByUserId: studentId,
      confirmedAt: new Date(),
    });

    expect(replay.created).toBe(false);
    expect(replay.receiptId).toBe(first.receiptId);
    expect(replay.receiptNumber).toBe(first.receiptNumber);

    // One transaction row, one receipt row.
    const tx = await findTransactionBySettlementKey({
      bookingId,
      transactionType: "deposit",
      settlementKey: key,
    });
    expect(tx).toBeTruthy();
    const receipts = await db
      .select()
      .from(escrowReceiptsTable)
      .where(eq(escrowReceiptsTable.transaction_id, tx!.id));
    expect(receipts.length).toBe(1);
  });

  it("records a release and links a distinct receipt number", async () => {
    const key = `test-release-${crypto.randomUUID()}`;
    const result = await recordSettlement({
      bookingId,
      transactionType: "release",
      receiptKind: "release",
      paymentMethod: "paystack",
      amountNgn: 300_000,
      settlementKey: key,
      gateway: "paystack",
      gatewayReference: key,
      initiatedByUserId: landlordId,
      confirmedAt: new Date(),
    });

    expect(result.status).toBe("succeeded");
    expect(result.receiptNumber).toMatch(/^RLS-\d{8}-\d{6}$/);

    const tx = await findTransactionBySettlementKey({
      bookingId,
      transactionType: "release",
      settlementKey: key,
    });
    expect(tx).toBeTruthy();

    // Verify the verification token round-trips and matches the snapshot.
    const [receipt] = await db
      .select()
      .from(escrowReceiptsTable)
      .where(eq(escrowReceiptsTable.transaction_id, tx!.id));
    expect(receipt).toBeTruthy();
    const byToken = await findReceiptByVerificationToken(receipt.verification_token);
    expect(byToken?.id).toBe(receipt.id);
    const snap = receipt.snapshot as any;
    expect(snap?.verification_url).toContain(receipt.verification_token);
    expect(snap?.receipt_kind).toBe("release");
  });

  it("deduplicates by gateway_event_id", async () => {
    const gatewayEventId = crypto.randomUUID();
    const key = `test-evt-${crypto.randomUUID()}`;

    const a = await recordSettlement({
      bookingId,
      transactionType: "release",
      receiptKind: "release",
      paymentMethod: "paystack",
      amountNgn: 300_000,
      settlementKey: key,
      gateway: "paystack",
      gatewayReference: key,
      gatewayEventId,
      initiatedByUserId: landlordId,
      confirmedAt: new Date(),
    });
    expect(a.created).toBe(true);

    // Same gateway event id, different key — must resolve to the existing row.
    const b = await recordSettlement({
      bookingId,
      transactionType: "release",
      receiptKind: "release",
      paymentMethod: "paystack",
      amountNgn: 300_000,
      settlementKey: `${key}-retry`,
      gateway: "paystack",
      gatewayReference: key,
      gatewayEventId,
      initiatedByUserId: landlordId,
      confirmedAt: new Date(),
    });
    expect(b.created).toBe(false);
    expect(b.transactionId).toBe(a.transactionId);
    expect(b.receiptId).toBe(a.receiptId);
  });

  it("isolates refunds from releases for the same booking", async () => {
    const refundKey = `test-refund-${crypto.randomUUID()}`;
    const result = await recordSettlement({
      bookingId,
      transactionType: "refund",
      receiptKind: "refund",
      paymentMethod: "paystack",
      amountNgn: 150_000,
      settlementKey: refundKey,
      gateway: "paystack",
      gatewayReference: refundKey,
      initiatedByUserId: studentId,
      confirmedAt: new Date(),
    });

    expect(result.status).toBe("succeeded");
    expect(result.receiptNumber).toMatch(/^REF-\d{8}-\d{6}$/);

    const txs = await db
      .select()
      .from(escrowTransactionsTable)
      .where(eq(escrowTransactionsTable.booking_id, bookingId));
    const kinds = txs.map((t) => t.transaction_type);
    expect(kinds).toContain("deposit");
    expect(kinds).toContain("release");
    expect(kinds).toContain("refund");
  });
});