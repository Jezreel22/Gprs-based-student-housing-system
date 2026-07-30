/**
 * lib/maps/geo-sql.ts
 *
 * Server-only geospatial SQL helpers. Kept separate from `utils.ts` (which is
 * imported into client bundles) so we don't drag drizzle's `sql` builder into
 * the client. Both the list (`/api/properties`) and map (`/api/properties/nearby`)
 * routes compute distance-from-NAUB; centralising the formula here removes the
 * duplication that previously existed, and keeps a single source of truth for
 * the NAUB coordinates (previously defined independently in the nearby route).
 */

import { sql, type SQL } from "drizzle-orm";
import { NAUB_COORDS } from "@/lib/maps/constants";

/** Canonical NAUB campus coordinates — single source of truth for routes. */
export const NAUB_LAT = NAUB_COORDS.lat;
export const NAUB_LNG = NAUB_COORDS.lng;

/**
 * Haversine distance in PostgreSQL between a (lat, lng) column pair and a
 * reference point, returning kilometres. Spherical law of cosines — accurate to
 * within ~1 m at these scales; LEAST/GREATEST guard against floating-point drift
 * past the acos domain. The literal 6371 is the mean Earth radius in km.
 *
 * Pass drizzle column references, e.g. `haversineDistanceSql(propertiesTable.latitude,
 * propertiesTable.longitude, NAUB_LAT, NAUB_LNG)`. The columns are accepted as
 * `unknown` because each column carries a distinct Drizzle column type whose
 * `name` differs ("latitude" vs "longitude"); narrowing to a single generic
 * parameter would force the caller to use one column type only.
 */
export function haversineDistanceSql(
  latCol: unknown,
  lngCol: unknown,
  refLat: number,
  refLng: number
): SQL<number> {
  const latFragment = sql`${latCol as SQL<number>}`;
  const lngFragment = sql`${lngCol as SQL<number>}`;
  return sql<number>`(
    6371 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians(${refLat})) *
        cos(${latFragment}) *
        cos(${lngFragment} - radians(${refLng})) +
        sin(radians(${refLat})) *
        sin(${latFragment})
      ))
    )
  )`;
}
