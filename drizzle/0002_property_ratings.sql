-- 0002_property_ratings.sql
--
-- A student's rating of the *property/listing* itself — separate from the
-- user-centric `ratings` table (which rates landlords). One row per student per
-- booking: `booking_id` ties it to a real completed stay, and the
-- (booking_id, rater_id) unique constraint dedupes the two submission paths
-- (listing page + booking review flow). `property_id` is denormalized from
-- booking.property_id for cheap listing-page queries.
--
-- Mirrors propertyRatingsTable in src/lib/db/schema.ts — keep in sync.

CREATE TABLE "property_ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade,
  "rater_id" uuid NOT NULL REFERENCES "users"("id"),
  "stars" integer NOT NULL,
  "review_text" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "property_ratings_booking_rater_unq" UNIQUE ("booking_id", "rater_id")
);--> statement-breakpoint
CREATE INDEX "property_ratings_property_idx" ON "property_ratings" ("property_id");
