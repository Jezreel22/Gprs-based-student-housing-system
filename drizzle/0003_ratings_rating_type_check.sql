-- 0003_ratings_rating_type_check.sql
--
-- Restrict ratings.rating_type to the single supported direction
-- ('student_rates_landlord'). The application layer already enforces this via
-- the Zod enum, but the DB column was plain text with no constraint, so any
-- legacy row or out-of-band insert could still sneak in. The CHECK constraint
-- mirrors the schema's `check("ratings_rating_type_check", ...)` in
-- src/lib/db/schema.ts — keep them in sync.

ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rating_type_check"
  CHECK ("rating_type" = 'student_rates_landlord');
