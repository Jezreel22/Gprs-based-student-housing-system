/**
 * lib/maps/travel.ts
 *
 * Travel-time helpers for property distances. Two tiers:
 *
 *  - **Heuristic estimates** (pure, zero API calls): used on listing cards so
 *    every property shows a rough walk/drive time without firing a Directions
 *    request per card. Effective speeds already absorb a typical urban road
 *    detour (~1.3× straight-line distance) and a small town's pace — tuned for
 *    Biu, not Lagos. They're intentionally conservative (over-estimate) so the
 *    precise Mapbox times on the detail page are a pleasant surprise, never a
 *    broken promise.
 *
 *  - **Precise durations** are fetched from the Mapbox Directions API via the
 *    server endpoint /api/maps/travel-time (Feature 2 + 5). These helpers only
 *    compute the *estimates* and format durations; the endpoint and client hook
 *    live separately.
 *
 * All functions are pure — safe to unit-test without a browser.
 */

// Effective straight-line speeds (km/h). Walking pace 4.5 km/h, with a ~1.15
// road detour folded in → 3.9; round to 4.0. Biu driving averages ~25 km/h
// with a ~1.25 detour → 20.
const WALK_EFFECTIVE_KMH = 4.0;
const DRIVE_EFFECTIVE_KMH = 20;
const MIN_MINUTES = 1; // never show "<1 min" / "0 min"

/** Estimated walking time for a straight-line distance in km. */
export function estimateWalkMinutes(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return MIN_MINUTES;
  return Math.max(MIN_MINUTES, Math.round((km / WALK_EFFECTIVE_KMH) * 60));
}

/** Estimated driving time for a straight-line distance in km. */
export function estimateDriveMinutes(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return MIN_MINUTES;
  return Math.max(MIN_MINUTES, Math.round((km / DRIVE_EFFECTIVE_KMH) * 60));
}

/**
 * Format a duration in minutes for compact display.
 *   1   → "1 min"
 *   42  → "42 min"
 *   65  → "1 hr 5 min"
 *   125 → "2 hr 5 min"
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < MIN_MINUTES) minutes = MIN_MINUTES;
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

export type TravelProfile = "walking" | "driving";

/** Heuristic minutes for a given profile (no API call). */
export function estimateMinutes(km: number, profile: TravelProfile): number {
  return profile === "walking" ? estimateWalkMinutes(km) : estimateDriveMinutes(km);
}
