/**
 * End-to-end Paystack webhook sweep against the dev DB.
 *
 * Seeds a synthetic booking + property + users, then posts three signed
 * webhook events to the local /api/payments/webhook handler:
 *
 *   1. charge.success   → marks the booking paid and issues the RCP receipt
 *   2. transfer.success → completes the booking and issues the RLS receipt
 *   3. refund.processed → settles the dispute refund leg and issues REF
 *
 * The script verifies each step by reading the DB after the webhook
 * returns 200. Run with:
 *
 *   pnpm tsx scripts/webhook-sweep.ts
 *
 * The script is idempotent on the synthetic IDs — re-running creates a new
 * booking and processes the flow again. Receipt numbers accumulate.
 */
import "@/lib/load-env";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bookingsTable,
  escrowReceiptsTable,
  escrowTransactionsTable,
  propertiesTable,
  usersTable,
} from "@/lib/db/schema";
import crypto from "node:crypto";

const SECRET = process.env.PAYSTACK_SECRET_KEY;
if (!SECRET) {
  console.error("PAYSTACK_SECRET_KEY is not set — cannot sign webhook bodies.");
  process.exit(1);
}

const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "http://localhost:3000/api/payments/webhook";

function sign(body: string): string {
  return createHmac("sha512", SECRET!).update(body).digest("hex");
}

async function postWebhook(event: any): Promise<{ status: number; text: string }> {
  const raw = JSON.stringify(event);
  const sig = sign(raw);
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-paystack-signature": sig,
    },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function seed(): Promise<{
  studentId: string;
  landlordId: string;
  propertyId: string;
  bookingId: string;
}> {
  const [student] = await db
    .insert(usersTable)
    .values({
      email: `sweep-student-${Date.now()}@naub.local`,
      role: "student",
      first_name: "Sweep",
      last_name: "Student",
    })
    .returning({ id: usersTable.id });

  const [landlord] = await db
    .insert(usersTable)
    .values({
      email: `sweep-landlord-${Date.now()}@naub.local`,
      role: "landlord",
      first_name: "Sweep",
      last_name: "Landlord",
      payout_bank_code: "044",
      payout_account_number: "0000000000",
      payout_account_name: "Sweep Landlord",
      paystack_recipient_code: "RCP_SWEEPMOCK",
      payout_details_set_at: new Date(),
    })
    .returning({ id: usersTable.id });

  const [property] = await db
    .insert(propertiesTable)
    .values({
      landlord_id: landlord.id,
      address: `Sweep Address ${Date.now()}`,
      rent_amount_ngn: 250_000,
      deposit_amount_ngn: 100_000,
      occupancy_code: `SW${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    })
    .returning({ id: propertiesTable.id });

  const reference = `NAUB-SWEEP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const [booking] = await db
    .insert(bookingsTable)
    .values({
      student_id: student.id,
      landlord_id: landlord.id,
      property_id: property.id,
      rent_amount_ngn: 250_000,
      deposit_amount_ngn: 100_000,
      total_amount_ngn: 350_000,
      escrow_account_reference: `SWEEP-${Date.now()}`,
      payment_method: "paystack",
      payment_transaction_id: reference,
      booking_status: "pending_payment",
    })
    .returning({ id: bookingsTable.id });

  return {
    studentId: student.id,
    landlordId: landlord.id,
    propertyId: property.id,
    bookingId: booking.id,
  };
}

async function expectOk(label: string, res: { status: number; text: string }) {
  if (res.status !== 200) {
    throw new Error(`${label} webhook returned ${res.status}: ${res.text}`);
  }
}

async function main() {
  const ctx = await seed();
  const reference = (await db.select().from(bookingsTable).where(eq(bookingsTable.id, ctx.bookingId)))[0].payment_transaction_id!;

  console.log(`▶ seeded booking ${ctx.bookingId} (paystack ref ${reference})`);

  // 1. charge.success
  const charge = await postWebhook({
    event: "charge.success",
    data: {
      status: "success",
      reference,
      amount: 350_000 * 100,
      metadata: { booking_id: ctx.bookingId },
      gateway_response: "Successful",
    },
  });
  await expectOk("charge.success", charge);
  console.log(`✓ charge.success accepted (HTTP 200)`);

  const bookingAfterCharge = (await db.select().from(bookingsTable).where(eq(bookingsTable.id, ctx.bookingId)))[0];
  if (bookingAfterCharge.booking_status !== "pending_occupancy") {
    throw new Error(`Expected pending_occupancy after charge.success, got ${bookingAfterCharge.booking_status}`);
  }

  // Receipt row should now exist for the deposit.
  const depositTx = (await db
    .select()
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.booking_id, ctx.bookingId)))[0];
  const depositReceipt = (await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.transaction_id, depositTx.id)))[0];
  if (!depositReceipt) throw new Error("deposit receipt not issued");
  console.log(`✓ deposit receipt ${depositReceipt.receipt_number}`);

  // Simulate the booking moving to release_pending with a transfer reference.
  const transferRef = `NAUB-PAYOUT-${ctx.bookingId.replace(/-/g, "").slice(0, 12).toUpperCase()}-1`;
  await db
    .update(bookingsTable)
    .set({
      booking_status: "release_pending",
      payout_transfer_reference: transferRef,
      payout_initiated_at: new Date(),
      payout_attempts: 1,
      updated_at: new Date(),
    })
    .where(eq(bookingsTable.id, ctx.bookingId));

  // 2. transfer.success
  const transfer = await postWebhook({
    event: "transfer.success",
    data: {
      reference: transferRef,
      transfer_code: `TRF_${crypto.randomBytes(4).toString("hex")}`,
      amount: 350_000 * 100,
      status: "success",
      gateway_response: "Transfer successful",
    },
  });
  await expectOk("transfer.success", transfer);
  console.log(`✓ transfer.success accepted`);

  const bookingAfterTransfer = (await db.select().from(bookingsTable).where(eq(bookingsTable.id, ctx.bookingId)))[0];
  if (bookingAfterTransfer.booking_status !== "completed") {
    throw new Error(`Expected completed after transfer.success, got ${bookingAfterTransfer.booking_status}`);
  }

  // 3. refund.processed — use a fresh dispute-style settlement key and
  //    hand-craft a synthetic Paystack event for it.
  const refundKey = `dispute:sweep:${ctx.bookingId}:student`;
  await db.insert(escrowTransactionsTable).values({
    booking_id: ctx.bookingId,
    transaction_type: "refund",
    transaction_status: "pending",
    settlement_key: refundKey,
    amount_ngn: 100_000,
    payment_method: "paystack",
    gateway: "paystack",
    gateway_reference: reference,
    initiated_by_user_id: ctx.studentId,
  });

  const refundEventId = `RFND_${crypto.randomBytes(4).toString("hex")}`;
  const refund = await postWebhook({
    event: "refund.processed",
    data: {
      id: refundEventId,
      reference: refundKey,
      merchant_reference: refundKey,
      transaction_reference: reference,
      amount: 100_000 * 100,
      status: "processed",
      gateway_response: "Refund processed successfully",
    },
  });
  await expectOk("refund.processed", refund);
  console.log(`✓ refund.processed accepted`);

  const refundTx = (await db
    .select()
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.settlement_key, refundKey)))[0];
  if (refundTx.transaction_status !== "succeeded") {
    throw new Error(`Expected refund succeeded, got ${refundTx.transaction_status}`);
  }
  const refundReceipt = (await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.transaction_id, refundTx.id)))[0];
  if (!refundReceipt) throw new Error("refund receipt not issued");
  console.log(`✓ refund receipt ${refundReceipt.receipt_number}`);

  // Replay protection: post the refund again with the same event id. The
  // receipt must not be re-issued and the status must not flip again.
  const replay = await postWebhook({
    event: "refund.processed",
    data: {
      id: refundEventId,
      reference: refundKey,
      merchant_reference: refundKey,
      transaction_reference: reference,
      amount: 100_000 * 100,
      status: "processed",
      gateway_response: "Refund processed successfully",
    },
  });
  await expectOk("refund.processed (replay)", replay);

  const allRefunds = await db
    .select()
    .from(escrowTransactionsTable)
    .where(eq(escrowTransactionsTable.settlement_key, refundKey));
  if (allRefunds.length !== 1) {
    throw new Error(`Refund replay produced ${allRefunds.length} rows; expected 1`);
  }
  const allRefundReceipts = await db
    .select()
    .from(escrowReceiptsTable)
    .where(eq(escrowReceiptsTable.transaction_id, allRefunds[0].id));
  if (allRefundReceipts.length !== 1) {
    throw new Error(`Refund replay produced ${allRefundReceipts.length} receipts; expected 1`);
  }
  console.log(`✓ refund replay is a no-op (single row + single receipt)`);

  console.log("\n✅ sweep passed for booking", ctx.bookingId);
}

main().catch((e) => {
  console.error("❌ sweep failed:", e?.message ?? e);
  process.exit(1);
});