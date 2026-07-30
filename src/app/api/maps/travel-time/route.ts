/**
 * GET /api/maps/travel-time
 *
 * Precise travel time + distance between two lat/lng pairs via the Mapbox
 * Directions API. Backs the property detail page's "Real travel time" rows
 * (Feature 2). Cards use heuristic estimates without calling this endpoint.
 *
 * Caching: a small in-memory LRU keyed on rounded coordinates (4 decimals ≈
 * 11 m) and the profile (walking/driving). Coords are rounded so that the
 * "same" pair reuses a cached answer even if the user nudges the map by a
 * few metres. The cache lives in module scope; on Vercel/serverless the
 * function may cold-start between invocations and lose it, but on a warm
 * instance (and in dev) it cuts repeated API calls to zero. Each entry also
 * carries its result, so no further Mapbox traffic is needed until eviction.
 *
 * Fallback: if the Mapbox token is missing, the call errors out, or the
 * route is impossible (e.g. unreachable coordinates), we return a heuristic
 * estimate from straight-line distance with `source: "estimate"` so the UI
 * can render *something* rather than blocking on a network failure.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError, jsonResponse, getQueryParams, errorResponse } from "@/lib/api";
import {
  estimateWalkMinutes,
  estimateDriveMinutes,
  type TravelProfile,
} from "@/lib/maps/travel";
import { haversineKm } from "@/lib/maps/utils";

export const runtime = "nodejs";
// Allow up to 15 s for the Mapbox call before falling back to an estimate.
export const maxDuration = 15;

const TravelTimeQuery = z.object({
  from_lat: z.coerce.number().min(-90).max(90),
  from_lng: z.coerce.number().min(-180).max(180),
  to_lat: z.coerce.number().min(-90).max(90),
  to_lng: z.coerce.number().min(-180).max(180),
  profile: z.enum(["walking", "driving"]).default("driving"),
});

type Source = "mapbox" | "estimate";
interface TravelTimeResponse {
  distance_km: number;
  duration_min: number;
  source: Source;
  profile: TravelProfile;
}

// ── Tiny LRU cache ─────────────────────────────────────────────────────────
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  key: string;
  value: TravelTimeResponse;
  expiresAt: number;
}

const cache: CacheEntry[] = [];

function cacheKey(q: {
  from_lat: number; from_lng: number; to_lat: number; to_lng: number; profile: TravelProfile;
}): string {
  // Round to 4 decimals (~11 m) so a few metres of jitter still hits.
  const r = (n: number) => n.toFixed(4);
  return `${r(q.from_lat)},${r(q.from_lng)}|${r(q.to_lat)},${r(q.to_lng)}|${q.profile}`;
}

function cacheGet(key: string): TravelTimeResponse | null {
  const now = Date.now();
  for (let i = 0; i < cache.length; i++) {
    const e = cache[i];
    if (e.key === key && e.expiresAt > now) return e.value;
  }
  return null;
}

function cachePut(value: TravelTimeResponse): void {
  const key = cacheKey(value as unknown as { from_lat: number; from_lng: number; to_lat: number; to_lng: number; profile: TravelProfile });
  const now = Date.now();
  // Evict expired + duplicate
  for (let i = cache.length - 1; i >= 0; i--) {
    const e = cache[i];
    if (e.expiresAt <= now || e.key === key) cache.splice(i, 1);
  }
  cache.push({ key, value, expiresAt: now + CACHE_TTL_MS });
  // Bound size
  if (cache.length > CACHE_MAX) cache.shift();
}

// ── Heuristic fallback (pure) ──────────────────────────────────────────────
function fallbackEstimate(
  km: number,
  profile: TravelProfile
): TravelTimeResponse {
  const duration_min = profile === "walking" ? estimateWalkMinutes(km) : estimateDriveMinutes(km);
  return {
    distance_km: Number(km.toFixed(3)),
    duration_min,
    source: "estimate",
    profile,
  };
}

// ── Mapbox Directions call ────────────────────────────────────────────────
async function fetchMapboxDuration(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile: TravelProfile,
  token: string,
  signal: AbortSignal
): Promise<TravelTimeResponse | null> {
  // Mapbox profiles: walking/foot, driving/driving-traffic (we use the basic
  // driving without traffic layer to keep cost down; durations are still
  // a far better estimate than straight-line speed). Coordinates must be
  // ordered lng,lat.
  const profileId = profile === "walking" ? "walking" : "driving";
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profileId}/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?geometries=geojson&overview=simplified&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json() as { routes?: Array<{ distance: number; duration: number }> };
    const route = data.routes?.[0];
    if (!route) return null;
    return {
      distance_km: Number((route.distance / 1000).toFixed(3)),
      duration_min: Math.max(1, Math.round(route.duration / 60)),
      source: "mapbox",
      profile,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const params = TravelTimeQuery.parse(Object.fromEntries(getQueryParams(req)));
    const from = { lat: params.from_lat, lng: params.from_lng };
    const to = { lat: params.to_lat, lng: params.to_lng };
    const key = cacheKey(params);

    // Cache hit — skip the network entirely.
    const hit = cacheGet(key);
    if (hit) return jsonResponse(hit);

    // Heuristic baseline — also used as the fallback if Mapbox is unreachable.
    const km = haversineKm(from, to);
    const fallback = fallbackEstimate(km, params.profile);

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      // No token configured → always return the estimate with source=estimate.
      return jsonResponse(fallback);
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10_000); // 10 s ceiling on the upstream call
    const result = await fetchMapboxDuration(from, to, params.profile, token, ac.signal);
    clearTimeout(timeout);

    const response = result ?? fallback;
    cachePut(response);
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}
