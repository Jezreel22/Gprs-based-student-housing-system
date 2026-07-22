-- 0004_property_favorites.sql
--
-- A student's "saved" listings — the Airbnb-style heart on PropertyCard and
-- the property detail page. One row per (user_id, property_id) — the
-- composite unique index dedupes toggles and makes "is this favorited?" a
-- cheap lookup.
--
-- Cascade-delete on both FKs so removing a user or a property cleans up the
-- favorites table automatically.
--
-- Mirrors propertyFavoritesTable in src/lib/db/schema.ts — keep in sync.

CREATE TABLE IF NOT EXISTS "property_favorites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_property_favorite"
  ON "property_favorites" ("user_id", "property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_property_favorites_user"
  ON "property_favorites" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_property_favorites_property"
  ON "property_favorites" ("property_id");
