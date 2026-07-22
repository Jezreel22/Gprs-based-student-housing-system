import "../load-env";
import { isNull, or } from "drizzle-orm";
import { db } from "./index";
import { propertiesTable } from "./schema";
import { log } from "../log";

/**
 * Backfill latitude/longitude for every property that has NULL coords.
 * Calls Google's Geocoding API server-side via the same key the `/api/geocode`
 * route uses, then updates the property row.
 *
 * Usage: `npm run db:backfill-coords`
 *
 * Skips properties that already have coords. Throttles to ~10 req/sec so
 * we don't blast the API and trip its quota.
 *
 * Idempotent: re-running only updates the rows that are still missing.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const SLEEP_MS = 1100; // Nominatim usage policy: max 1 request per second

interface GeocodeResponse {
  status: string;
  results?: Array<{
    geometry: { location: { lat: number; lng: number } };
    formatted_address: string;
  }>;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  // Use OpenStreetMap Nominatim directly. The project's Google Maps API key
  // only has the Maps JavaScript API enabled (not Geocoding), so Google
  // returns REQUEST_DENIED for /geocode/json. Nominatim is free, keyless,
  // and has reasonable coverage for "X, Biu" / "X, Borno" inputs.
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&addressdetails=0&limit=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "NAUB-Home-Finder/1.0 (db:backfill-coords)",
        "Accept-Language": "en",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!body.length) return null;
    return { lat: Number(body[0].lat), lng: Number(body[0].lon) };
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run db:backfill-coords");
  }

  const missing = await db
    .select({ id: propertiesTable.id, address: propertiesTable.address })
    .from(propertiesTable)
    .where(or(isNull(propertiesTable.latitude), isNull(propertiesTable.longitude)));

  if (missing.length === 0) {
    console.log("All properties already have coordinates. Nothing to backfill.");
    return;
  }

  console.log(`Found ${missing.length} properties missing coordinates. Geocoding via Nominatim…\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of missing) {
    if (!row.address) {
      console.log(`  SKIP ${row.id}: no address`);
      skipped += 1;
      continue;
    }
    // If the address has no obvious country/region, Nominatim's free-text
    // search often returns the wrong country (e.g. "tabra" elsewhere).
    // Append ", Nigeria" if the address doesn't already mention it.
    const queryAddress = /nigeria|biu|borno|maiduguri/i.test(row.address)
      ? row.address
      : `${row.address}, Nigeria`;

    const coords = await geocode(queryAddress);
    if (!coords) {
      console.log(`  FAIL ${row.id}: ${row.address}`);
      failed += 1;
      await sleep(SLEEP_MS);
      continue;
    }
    await db
      .update(propertiesTable)
      .set({ latitude: coords.lat, longitude: coords.lng, updated_at: new Date() })
      .where(eqId(row.id));
    console.log(`  OK   ${row.id}: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}  ←  ${row.address}`);
    updated += 1;
    await sleep(SLEEP_MS);
  }

  console.log(
    `\nDone. updated=${updated}, failed=${failed}, skipped=${skipped}, total=${missing.length}`,
  );
}

function eqId(id: string) {
  // Drizzle's eq() — import inline so this file doesn't add a top-level import
  // that conflicts with the other scripts. (Keeps tree-shaking simple.)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { eq } = require("drizzle-orm");
  return eq(propertiesTable.id, id);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("db:backfill-coords failed", { err });
    process.exit(1);
  });
