-- 0007_escrow_transactions_receipts.sql
--
-- Adds:
--   - escrow_transactions     append-only record for every confirmed escrow
--                             money movement (deposit / release / refund),
--                             keyed by booking + settlement_key.
--   - escrow_receipts         official immutable receipt document issued
--                             exactly once per successful transaction, with
--                             a stable receipt number and verification
--                             token.
--   - receipt_daily_counters  atomic Lagos-day issuance counter so receipt
--                             numbers (RCP-/RLS-/REF-) remain unique under
--                             concurrent webhook retries.
--
-- All money movements that go through the existing payment-marks funnel
-- (markBookingPaid, completeBookingPayout, markBookingDisbursed) and the
-- dispute settlement path now write to this table. Existing 0006
-- disbursement_receipt.sql remains in effect: the officer-uploaded manual
-- bank-transfer screenshot is stored in `uploads` and linked to
-- bookings.payout_receipt_upload_id; the new escrow_receipts row is a
-- separate immutable official document.
--
-- Mirrors the change in src/lib/db/schema.ts — keep in sync.

-- ─── escrow_transactions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "escrow_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id"),
  "original_transaction_id" uuid REFERENCES "escrow_transactions"("id"),
  "initiated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "evidence_upload_id" uuid REFERENCES "uploads"("id") ON DELETE SET NULL,
  "transaction_type" text NOT NULL,
  "transaction_status" text NOT NULL DEFAULT 'pending',
  "settlement_key" text NOT NULL,
  "amount_ngn" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'NGN',
  "payment_method" text NOT NULL,
  "gateway" text,
  "gateway_reference" text,
  "gateway_transaction_id" text,
  "gateway_transfer_code" text,
  "gateway_event_id" text,
  "failure_reason" text,
  "confirmed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escrow_transactions_amount_positive') THEN
    ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_amount_positive" CHECK ("amount_ngn" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escrow_transactions_type_check') THEN
    ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_type_check" CHECK ("transaction_type" IN ('deposit', 'release', 'refund'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escrow_transactions_status_check') THEN
    ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_status_check" CHECK ("transaction_status" IN ('pending', 'succeeded', 'failed', 'reversed', 'manual_review'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "escrow_transactions_booking_created_idx"
  ON "escrow_transactions" ("booking_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "escrow_transactions_status_created_idx"
  ON "escrow_transactions" ("transaction_status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "escrow_transactions_original_idx"
  ON "escrow_transactions" ("original_transaction_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'escrow_transactions_booking_type_settlement_key_idx') THEN
    CREATE UNIQUE INDEX "escrow_transactions_booking_type_settlement_key_idx"
      ON "escrow_transactions" ("booking_id", "transaction_type", "settlement_key");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'escrow_transactions_gateway_event_idx') THEN
    CREATE UNIQUE INDEX "escrow_transactions_gateway_event_idx"
      ON "escrow_transactions" ("gateway_event_id")
      WHERE "gateway_event_id" IS NOT NULL;
  END IF;
END $$;

-- ─── escrow_receipts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "escrow_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "transaction_id" uuid NOT NULL UNIQUE REFERENCES "escrow_transactions"("id"),
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id"),
  "receipt_number" text NOT NULL UNIQUE,
  "receipt_kind" text NOT NULL,
  "verification_token" uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "issued_at" timestamp NOT NULL DEFAULT now(),
  "issued_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "document_version" integer NOT NULL DEFAULT 1,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escrow_receipts_kind_check') THEN
    ALTER TABLE "escrow_receipts" ADD CONSTRAINT "escrow_receipts_kind_check" CHECK ("receipt_kind" IN ('deposit', 'release', 'refund'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "escrow_receipts_booking_issued_idx"
  ON "escrow_receipts" ("booking_id", "issued_at" DESC);
CREATE INDEX IF NOT EXISTS "escrow_receipts_issued_idx"
  ON "escrow_receipts" ("issued_at" DESC);

-- ─── receipt_daily_counters ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "receipt_daily_counters" (
  "receipt_date" date NOT NULL,
  "receipt_prefix" text NOT NULL,
  "last_value" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("receipt_date", "receipt_prefix")
);