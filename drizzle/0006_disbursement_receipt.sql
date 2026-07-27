-- 0006_disbursement_receipt.sql
--
-- Adds `bookings.payout_receipt_upload_id` — a nullable FK to `uploads.id`
-- that records the receipt screenshot an escrow officer attaches when
-- confirming a managed-mode disbursement (`/api/bookings/[id]/mark-disbursed`).
--
-- Nullable on purpose: existing `completed` bookings predate this rule and
-- have no receipt; that's correct historical behavior. New `release_pending`
-- rows can only complete with a non-null receipt.
--
-- Mirrors the change in src/lib/db/schema.ts — keep in sync.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "payout_receipt_upload_id" uuid
  REFERENCES "uploads"("id") ON DELETE SET NULL;