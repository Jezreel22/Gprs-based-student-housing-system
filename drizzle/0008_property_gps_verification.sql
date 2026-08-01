-- 0008_property_gps_verification.sql
--
-- Adds three columns to `properties` for the GPS verification workflow
-- (Location Program Feature 7): an officer compares the landlord-submitted
-- coordinates (`latitude`/`longitude`) against officer-verified coordinates
-- and sets a status.
--
--   gps_verification_status  text, default 'pending'
--                            values: 'pending' | 'verified' | 'rejected'
--                            Mirrors users.verification_status. The GPS tab's
--                            queue filters on 'pending'.
--   verified_latitude        real, nullable — officer-confirmed coordinates
--   verified_longitude       real, nullable — officer-confirmed coordinates
--
-- The existing `geolocation_verified_at` timestamp continues to mean "this
-- property's pin has been verified" (drives the proximity score's 10-point
-- gpsVerified weight). It is set only on a 'verified' outcome — a 'rejected'
-- outcome leaves it NULL so rejected pins score zero.
--
-- Default 'pending' means all existing rows enter the GPS queue once the
-- feature ships — the intended UX (officers triage the backlog).
--
-- Mirrors propertiesTable in src/lib/db/schema.ts — keep in sync.

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "gps_verification_status" text DEFAULT 'pending';--> statement-breakpoint

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "verified_latitude" real;--> statement-breakpoint

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "verified_longitude" real;
