import "../load-env";
import { db } from "./index";
import { propertyPhotosTable, propertiesTable } from "./schema";
import { log } from "../log";
import { eq, like, or } from "drizzle-orm";

/**
 * Wipe stale property photos so every listing falls through to the bundled
 * WhatsApp-photo rotation (see src/lib/listing-photos.ts).
 *
 * Removes `property_photos` rows whose `photo_url` points at:
 *   - the old single-photo SVG placeholder (`/placeholder-house.svg`, and
 *     any `/placeholder*` variant)
 *   - locally-uploaded blobs served from the app's own upload endpoint
 *     (`/api/uploads/*`) — these were usually one-off test uploads
 *
 * It does NOT touch photos that point at legitimate external URLs
 * (`https://…`) or the new `/listings/*` bundled photos.
 *
 * Idempotent and safe to re-run. Usage: `npm run db:clear-photos`
 */
async function clearStalePhotos() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run db:clear-photos");
  }

  // Identify the rows we consider stale. We match on the URL prefix so this
  // survives any future rename of the bundled placeholder filename.
  const stale = or(
    like(propertyPhotosTable.photo_url, "/placeholder%"),
    like(propertyPhotosTable.photo_url, "/api/uploads/%"),
  );

  const before = await db
    .select({
      property_id: propertyPhotosTable.property_id,
      photo_url: propertyPhotosTable.photo_url,
    })
    .from(propertyPhotosTable)
    .where(stale);

  const result = await db.delete(propertyPhotosTable).where(stale).returning({
    id: propertyPhotosTable.id,
    property_id: propertyPhotosTable.property_id,
  });

  // Tally per-property so the summary is actionable.
  const byProperty = new Map<string, number>();
  for (const row of result) {
    byProperty.set(row.property_id, (byProperty.get(row.property_id) ?? 0) + 1);
  }

  // Look up addresses for the affected properties so the log is human-readable.
  const affectedIds = [...byProperty.keys()];
  const addresses = affectedIds.length
    ? await db
        .select({ id: propertiesTable.id, address: propertiesTable.address })
        .from(propertiesTable)
    : [];
  const addressById = new Map(addresses.map((p) => [p.id, p.address]));

  const summary = {
    cleared: result.length,
    matchedBeforeDelete: before.length,
    propertiesAffected: byProperty.size,
    perProperty: affectedIds.map((id) => ({
      property_id: id,
      address: addressById.get(id) ?? "(unknown)",
      cleared: byProperty.get(id) ?? 0,
    })),
  };

  log.info("db:clear-photos complete", summary as unknown as Record<string, unknown>);

  console.log("\nclear-photos summary:");
  console.log(`  cleared:            ${result.length} row(s)`);
  console.log(`  properties affected:${byProperty.size}`);
  for (const p of summary.perProperty) {
    console.log(`    - ${p.address}  (${p.cleared} photo(s))`);
  }
  console.log(
    "\nExisting listings now fall through to the bundled WhatsApp-photo rotation.",
  );
}

clearStalePhotos()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("db:clear-photos failed", { err });
    process.exit(1);
  });
