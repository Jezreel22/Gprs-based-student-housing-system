-- 0001_trust_event_expiry.sql
--
-- Add expires_at to trust_events so negative fraud / dispute / property signals
-- age out instead of being a permanent drag on a user's score. Positive events
-- stay NULL (they never expire). The recompute folds
-- `active=true AND (expires_at IS NULL OR expires_at>now())` into the score.
--
-- The backfill preserves current truth: each negative event created before this
-- migration gets an expires_at of `created_at + rule_default_window`. That
-- means existing users won't suddenly see a score change today — only as new
-- time passes will older events drop off.

ALTER TABLE "trust_events" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "trust_events_expires_idx" ON "trust_events"("expires_at");--> statement-breakpoint

-- Backfill: stamp expires_at on existing negative rows using each rule's
-- default decay window. Defaults here mirror DEFAULT_EXPIRY in
-- src/lib/trust/rules.ts — keep them in sync.
UPDATE "trust_events" SET "expires_at" = "created_at" + INTERVAL '12 months'
  WHERE "rule_key" = 'failed_identity_verification' AND "expires_at" IS NULL;--> statement-breakpoint
UPDATE "trust_events" SET "expires_at" = "created_at" + INTERVAL '18 months'
  WHERE "rule_key" = 'transaction_dispute' AND "expires_at" IS NULL;--> statement-breakpoint
UPDATE "trust_events" SET "expires_at" = "created_at" + INTERVAL '24 months'
  WHERE "rule_key" IN ('fake_property_listing', 'spam_activity') AND "expires_at" IS NULL;--> statement-breakpoint
