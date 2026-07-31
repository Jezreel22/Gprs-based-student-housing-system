/**
 * lib/maps/directions.ts
 *
 * Pure helpers for the route-navigation feature (program feature #5).
 * Maps Mapbox Directions responses into a camera-ready shape, and
 * synthesises a 2-vertex straight-line fallback when the upstream is
 * unreachable / unconfigured. All functions are pure — safe to unit-test
 * without a browser or network.
 *
 * Reuses `estimateMinutes` / `TravelProfile` from `@/lib/maps/travel` so the
 * fallback ETA matches the heuristic times used on listing cards.
 */

import type { LineString } from "geojson";
import {
  estimateWalkMinutes,
  estimateDriveMinutes,
  type TravelProfile,
} from "@/lib/maps/travel";

/** One maneuver in the route, as rendered in the steps panel. */
export interface RouteStep {
  /** Turn-instruction text, e.g. "Turn left onto Maiduguri Road". */
  instruction: string;
  /** Step length in metres. */
  distance_m: number;
  /**
   * Maneuver modifier from Mapbox: "left" | "right" | "straight" | "uturn" |
   * "depart" | "arrive" | undefined. Drives the icon selection in the UI.
   */
  modifier?: string;
  /** Optional street name (for the icon hover/title only). */
  name?: string;
}

/** The shape returned by the server route + hook and rendered by the UI. */
export interface DirectionsResponse {
  profile: TravelProfile;
  /** Total route distance in km (3 dp). */
  distance_km: number;
  /** Total route duration in minutes (clamped >= 1). */
  duration_min: number;
  /** GeoJSON LineString in [lng, lat] order — ready for Mapbox setData. */
  geometry: LineString;
  /** Ordered maneuvers. Empty for the straight-line fallback. */
  steps: RouteStep[];
  /** Source of truth for the UI's "Real" vs "(est.)" badge. */
  source: "mapbox" | "estimate";
}

/**
 * Subset of a Mapbox Directions `route` object that this module consumes.
 * Documented here so callers don't need to reach into the raw response
 * shape.
 */
export interface MapboxRouteLike {
  distance: number; // metres
  duration: number; // seconds
  geometry: { coordinates: [number, number][] }; // [lng, lat]
  legs?: ReadonlyArray<{
    steps?: ReadonlyArray<{
      maneuver?: {
        instruction?: string;
        modifier?: string;
      };
      name?: string;
      distance?: number;
    }>;
  }>;
}

/** Convert a Mapbox route into the camera-ready response shape. */
export function buildDirectionsResponse(
  route: MapboxRouteLike,
  profile: TravelProfile
): DirectionsResponse {
  const coords = route.geometry?.coordinates ?? [];
  const distance_km = Number((route.distance / 1000).toFixed(3));
  const duration_min = Math.max(1, Math.round(route.duration / 60));
  const steps = flattenSteps(route.legs);
  return {
    profile,
    distance_km,
    duration_min,
    geometry: { type: "LineString", coordinates: coords as [number, number][] },
    steps,
    source: "mapbox",
  };
}

/**
 * Pure fallback: a straight 2-vertex line between `from` and `to` with the
 * heuristic ETA. Lets the UI render *something* when Mapbox is unreachable
 * or unconfigured (no token, timeout, non-ok response, empty route). Never
 * throws on bad input — clamps to safe defaults.
 */
export function fallbackDirections(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
  profile: TravelProfile
): DirectionsResponse {
  const safeFrom =
    from && Number.isFinite(from.lat) && Number.isFinite(from.lng)
      ? from
      : { lat: 0, lng: 0 };
  const safeTo =
    to && Number.isFinite(to.lat) && Number.isFinite(to.lng)
      ? to
      : { lat: 0, lng: 0 };

  // Quick & dirty straight-line km so the ETA matches the existing
  // card heuristics. We don't import haversineKm here to keep this module
  // 100% synchronous / dependency-free; the angular distance is good
  // enough for a single fallback tile.
  const dLat = safeTo.lat - safeFrom.lat;
  const dLng = safeTo.lng - safeFrom.lng;
  // Equirectangular projection — accurate to ~0.5% at these scales,
  // matches the formatDistance rounding the UI uses.
  const meanLat = ((safeFrom.lat + safeTo.lat) * Math.PI) / 360;
  const kmX = dLng * 111.32 * Math.cos(meanLat);
  const kmY = dLat * 110.57;
  const km = Math.max(0, Math.sqrt(kmX * kmX + kmY * kmY));

  const duration_min =
    profile === "walking" ? estimateWalkMinutes(km) : estimateDriveMinutes(km);

  return {
    profile,
    distance_km: Number(km.toFixed(3)),
    duration_min,
    geometry: {
      type: "LineString",
      coordinates: [
        [safeFrom.lng, safeFrom.lat],
        [safeTo.lng, safeTo.lat],
      ],
    },
    steps: [],
    source: "estimate",
  };
}

// ── Internal ──────────────────────────────────────────────────────────────

function flattenSteps(
  legs?: ReadonlyArray<{
    steps?: ReadonlyArray<{
      maneuver?: { instruction?: string; modifier?: string };
      name?: string;
      distance?: number;
    }>;
  }>
): RouteStep[] {
  if (!legs || legs.length === 0) return [];
  const out: RouteStep[] = [];
  for (const leg of legs) {
    if (!leg.steps) continue;
    for (const s of leg.steps) {
      const instruction = s.maneuver?.instruction;
      if (!instruction) continue; // skip silent steps
      out.push({
        instruction,
        distance_m: Math.max(0, Math.round(s.distance ?? 0)),
        modifier: s.maneuver?.modifier,
        name: s.name,
      });
    }
  }
  return out;
}
