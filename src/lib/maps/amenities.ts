/**
 * lib/maps/amenities.ts
 *
 * Nearby amenities (Location Program Feature 4). This module is pure — no
 * `fetch`, no browser globals — so it typechecks and unit-tests in isolation
 * the same way `utils.ts`, `travel.ts`, and `proximity-score.ts` do. The actual
 * Mapbox POI fetch + caching lives in the server route
 * `/api/properties/[id]/nearby-amenities`; this module defines the category set,
 * the response shape, and two small pure helpers.
 *
 * Amenity score contract: `amenityScore()` produces the 0–1 value that
 * `computeProximityScore({ amenityScore })` (Feature 3) consumes. When a caller
 * omits `amenityScore`, `computeProximityScore` renormalises that 5-pt weight
 * across the rest of the components so the overall 0–100 span is unchanged — so
 * feeding a real value here is purely additive.
 *
 * Note: this module deliberately imports no React/lucide — icons live in the
 * client component (`NearbyAmenitiesCard.tsx`), keyed off `AmenityCategory.key`.
 * Keeping the icon mapping client-side matches how `proximity-score.ts`/`travel.ts`
 * stay pure (server-importable, unit-testable without a DOM).
 */

/**
 * A single nearby-amenity category. `query` is the free-text string sent to the
 * Mapbox Geocoding `mapbox.places` endpoint with `types=poi`; `key` is the
 * stable identifier used in the response payload, the cache key, and the UI's
 * icon mapping.
 */
export interface AmenityCategory {
  key: string;
  label: string;
  /** Mapbox geocoding query terms. Chosen for Nigerian context (markets, motor
   *  parks, filling stations) where generic western terms under-perform. */
  query: string;
}

/**
 * The fixed category set shown on the property detail page. Kept deliberately
 * small (~10): each is one Mapbox call per cold request, bounded by the 1-hour
 * server + client caches.
 */
export const AMENITY_CATEGORIES: readonly AmenityCategory[] = [
  { key: "groceries", label: "Groceries", query: "supermarket market grocery store" },
  { key: "shops", label: "Shops", query: "shop store shopping" },
  { key: "restaurants", label: "Restaurants", query: "restaurant food eatery" },
  { key: "cafes", label: "Cafés", query: "coffee cafe bakery" },
  { key: "schools", label: "Schools", query: "primary secondary school education" },
  { key: "health", label: "Health", query: "hospital clinic medical" },
  { key: "pharmacy", label: "Pharmacy", query: "pharmacy chemist drugstore" },
  { key: "transit", label: "Transit", query: "bus stop motor park transit" },
  { key: "bank", label: "Bank / ATM", query: "bank atm" },
  { key: "fuel", label: "Fuel", query: "petrol filling station fuel" },
];

/** A single nearby place returned to the client. */
export interface NearbyAmenity {
  id: string;
  name: string;
  /** The `AmenityCategory.key` this result belongs to. */
  category: string;
  /** Straight-line distance from the property, in metres. */
  distanceMeters: number;
  lng: number;
  lat: number;
}

export type AmenitySource = "mapbox" | "empty";

/** Response shape for `GET /api/properties/[id]/nearby-amenities`. */
export interface NearbyAmenitiesResponse {
  centre: { lat: number; lng: number };
  /** `AmenityCategory.key` → nearest places for that category (empty arrays
   *  omitted by the route; the client treats a missing key as "none"). */
  categories: Record<string, NearbyAmenity[]>;
  /** 0–1 amenity index, from `amenityScore()`. */
  score: number;
  source: AmenitySource;
  fetchedAt: number;
}

/**
 * Distinct categories that must be present for the amenity score to reach 1.0.
 * Tuned so that a listing near a reasonable mix of essentials (e.g. groceries +
 * school + health + transit + one more) scores full marks; sparser areas score
 * proportionally less.
 */
export const AMENITY_SCORE_TARGET = 5;

/**
 * Map the number of distinct non-empty categories to a 0–1 amenity index — the
 * value `computeProximityScore({ amenityScore })` consumes. Pure and
 * deterministic: server and client agree.
 *
 * Curve: `min(1, coveredCategories / AMENITY_SCORE_TARGET)`. 0 categories → 0,
 * ≥ TARGET distinct categories → 1, linear in between.
 *
 * Accepts either a `Record<categoryKey, NearbyAmenity[]>` (as returned by the
 * route) or a `Record<categoryKey, count>` for convenience.
 */
export function amenityScore(
  categories: Record<string, unknown[]> | Record<string, number>
): number {
  const values = Object.values(categories);
  let covered = 0;
  for (const v of values) {
    const n = typeof v === "number" ? v : Array.isArray(v) ? v.length : 0;
    if (n > 0) covered += 1;
  }
  return Math.min(1, covered / AMENITY_SCORE_TARGET);
}

/**
 * Format a straight-line distance in metres. Mirrors the rounding idiom of
 * `formatAccuracy` / `formatDistance` in `utils.ts`.
 *   < 1000 m → "450 m"
 *   ≥ 1000 m → "1.8 km" (one decimal)
 */
export function formatAmenityDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
