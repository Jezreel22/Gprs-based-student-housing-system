-- 0005_admin_escrow.sql
--
-- Admin Escrow Management module (`/admin/escrow`). Two changes:
--
-- 1. `bookings.under_verification_by_officer_at` — nullable timestamp. An
--    officer marks a payment "under verification" before it advances to
--    `pending_review`. Only bank_transfer bookings with no Paystack receipt
--    need this; gateway-confirmed payments skip the stage.
--
-- 2. `booking_admin_notes` — append-only internal notes an officer attaches
--    to a booking. No UPDATE/DELETE paths in code; immutability by convention.
--    Indexed on (booking_id, created_at) for the detail-drawer timeline.
--
-- Mirrors changes to src/lib/db/schema.ts — keep in sync.

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "under_verification_by_officer_at" timestamp;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "booking_admin_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade,
  "officer_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "note" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_admin_notes_booking_created_idx"
  ON "booking_admin_notes" ("booking_id", "created_at");
