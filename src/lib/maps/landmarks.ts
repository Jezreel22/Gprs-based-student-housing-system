/**
 * lib/maps/landmarks.ts
 *
 * Feature 6 -- Landmark Descriptions. Pure module: derives a one-line
 * human-readable phrase ("Opposite NAUB Main Gate", "Near the Central Market")
 * from a point, using a curated table of well-known Biu/NAUB landmarks plus
 * a forward-azimuth bearing function for any future directional phrasing.
 *
 * Coordinate accuracy: the `LANDMARKS` table is APPROXIMATE. Offsets from
 * NAUB {10.6102, 12.1978} are a few hundred metres to ~1 km -- close enough
 * for the natural prepositions below to read correctly, but not survey-grade.
 * The table is the single editable source of truth; tightening the numbers
 * later is a one-file change with no downstream callers to update.
 *
 * Dependency-free at runtime except for `haversineKm` (utils.ts). No React,
 * no `fetch`, no `document` -- safe to import from server or client.
 */

import { haversineKm } from "./utils";

/**
 * Coarse classification of a landmark. Useful for any future per-kind
 * phrasing (e.g. "Near the <bank>" vs. "Near the <gate>"); v1 ignores it.
 */
export type LandmarkKind =
  | "gate"
  | "bank"
  | "market"
  | "religious"
  | "institution"
  | "transit"
  | "military"
  | "hospital"
  | "recreation";

export interface Landmark {
  /** Display name, e.g. "NAUB Main Gate". */
  name: string;
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
  /** Coarse kind (unused by v1's phrasing but kept for future filtering). */
  kind: LandmarkKind;
}

/**
 * Curated table of well-known Biu / NAUB-area landmarks. Coordinates are
 * approximate; see file header. Distances from NAUB {10.6102, 12.1978}:
 *
 *   - NAUB Main Gate            ~40 m east
 *   - NAUB Second Gate          ~700 m west
 *   - Zenith Bank               ~220 m west
 *   - Central Market Biu        ~300 m north
 *   - Army Barracks             ~270 m south
 *   - Biu General Hospital      ~400 m NW
 *   - Central Mosque            ~260 m NW
 *   - St. Mary's Church         ~360 m east
 *   - Biu Motor Park            ~230 m SW
 *   - NAUB Postgraduate Hostel  ~100 m NW
 */
export const LANDMARKS: readonly Landmark[] = [
  { name: "NAUB Main Gate", lat: 10.6103, lng: 12.1982, kind: "gate" },
  { name: "NAUB Second Gate", lat: 10.6098, lng: 12.1915, kind: "gate" },
  { name: "Zenith Bank", lat: 10.6102, lng: 12.1958, kind: "bank" },
  { name: "Central Market Biu", lat: 10.6126, lng: 12.1985, kind: "market" },
  { name: "Army Barracks", lat: 10.608, lng: 12.199, kind: "military" },
  { name: "Biu General Hospital", lat: 10.6132, lng: 12.1955, kind: "hospital" },
  { name: "Central Mosque", lat: 10.6121, lng: 12.1962, kind: "religious" },
  { name: "St. Mary's Church", lat: 10.6109, lng: 12.201, kind: "religious" },
  { name: "Biu Motor Park", lat: 10.609, lng: 12.196, kind: "transit" },
  { name: "NAUB Postgraduate Hostel", lat: 10.6112, lng: 12.1969, kind: "institution" },
];

/**
 * Maximum radius (km) at which a curated landmark is considered "near enough"
 * to be phrased directly. Beyond this, `describeLandmark` falls back to the
 * nearest POI from Feature 4's amenities cache (if provided).
 */
const MAX_LANDMARK_RADIUS_KM = 1.5;

// ── Bearing ──────────────────────────────────────────────────────────────────

/**
 * Initial forward bearing (azimuth) in degrees from `from` to `to`.
 *
 *   0°   = due north
 *   90°  = due east
 *   180° = due south
 *   270° = due west
 *
 * Range is normalised to [0, 360). Invalid input (non-finite coords) returns
 * 0 -- callers treat the value as advisory (it's currently unused by v1's
 * preposition logic but kept exported for future directional phrasing).
 */
export function initialBearing(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  if (!isFinitePoint(from) || !isFinitePoint(to)) return 0;

  // Trig uses radians; convert inline so this module never reaches into
  // utils.ts's private `toRad` helper.
  const phi1 = (from.lat * Math.PI) / 180;
  const phi2 = (to.lat * Math.PI) / 180;
  const dLambda = ((to.lng - from.lng) * Math.PI) / 180;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// ── Description ──────────────────────────────────────────────────────────────

/**
 * Produce a human-readable landmark description for the given point.
 *
 * Returns null when:
 *   - `point` is null,
 *   - either coordinate is non-finite,
 *   - no curated landmark is within `MAX_LANDMARK_RADIUS_KM` AND
 *     `opts.fallbackPoi` is missing or empty.
 *
 * Otherwise returns a string of the form:
 *
 *   "<Preposition> <Landmark name>"
 *
 * -- e.g. "Opposite NAUB Main Gate", "Near the Central Market Biu",
 * "Brief drive from the Army Barracks" -- or, when no curated landmark is
 * in range but a fallback POI is supplied, "Near <POI name>".
 *
 * The fallback POI is intended to be the single nearest POI across all
 * categories from the existing Feature 4 nearby-amenities cache; the caller
 * is responsible for that selection (see `useNearbyAmenities`).
 */
export function describeLandmark(
  point: { lat: number; lng: number } | null,
  opts?: { readonly fallbackPoi?: { name: string } | null }
): string | null {
  if (!isFinitePoint(point)) return null;

  // Find the nearest curated landmark by great-circle distance.
  let nearest: { landmark: Landmark; km: number } | null = null;
  for (const landmark of LANDMARKS) {
    const km = haversineKm(landmark, point!);
    if (nearest === null || km < nearest.km) {
      nearest = { landmark, km };
    }
  }

  if (nearest && nearest.km < MAX_LANDMARK_RADIUS_KM) {
    return `${prepositionForKm(nearest.km)} ${nearest.landmark.name}`;
  }

  // Fallback: nearest POI from Feature 4 (if caller supplied one).
  const poiName = opts?.fallbackPoi?.name?.trim();
  if (poiName) return `Near ${poiName}`;

  return null;
}

// ── Internals ────────────────────────────────────────────────────────────────

/**
 * Map a km distance to a natural English preposition. The first matching
 * band wins. Bands were tuned so the demo property at 10.611, 12.1909
 * (~700 m west of NAUB) reads "Near NAUB Second Gate".
 */
function prepositionForKm(km: number): string {
  if (km < 0.06) return "Opposite";
  if (km < 0.15) return "Beside";
  if (km < 0.4) return "Near";
  if (km < 0.8) return "Close to";
  if (km < 1.2) return "Short walk from";
  if (km < MAX_LANDMARK_RADIUS_KM) return "Brief drive from";
  // Outside the curated range -- caller should have used the fallback branch.
  return "Near";
}

function isFinitePoint(
  p: { lat: number; lng: number } | null | undefined
): p is { lat: number; lng: number } {
  if (!p) return false;
  return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}