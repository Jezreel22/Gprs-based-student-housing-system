/**
 * GET /api/maps/directions
 *
 * Precise Mapbox Directions route between two lat/lng pairs: full geometry
 * (GeoJSON LineString) plus ordered steps for the steps panel. Backs
 * Feature 5 — the property detail page's RouteCard and the browse map's
 * route overlay.
 *
 * Caching: a small in-memory LRU keyed on rounded coordinates (4 decimals
 * ≈ 11 m) and the profile (walking/driving), mirroring the corrected
 * travel-time cache. Coords are rounded so a few metres of jitter still
 * hits. Cache lives in module scope; Vercel/serverless may cold-start
 * between invocations and lose it, but on a warm instance it cuts repeated
 * API calls to zero. Each entry carries the full response, so no further
 * Mapbox traffic is needed until eviction.
 *
 * Fallback: if the Mapbox token is missing, the call errors out, or the
 * route is impossible, we synthesise a straight-line fallback with
 * `source: "estimate"` and the heuristic ETA from travel.ts — so the UI
 * can render *something* rather than blocking on a network failure. This
 * also means the card always appears (with an "estimated" badge) instead
 * of disappearing.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError, jsonResponse, getQueryParams } from "@/lib/api";
import {
  type TravelProfile,
} from "@/lib/maps/travel";
import {
  buildDirectionsResponse,
  fallbackDirections,
  type DirectionsResponse,
  type MapboxRouteLike,
} from "@/lib/maps/directions";

export const runtime = "nodejs";
// Allow up to 15 s for the Mapbox call before falling back to an estimate.
export const maxDuration = 15;

const DirectionsQuery = z.object({
  from_lat: z.coerce.number().min(-90).max(90),
  from_lng: z.coerce.number().min(-180).max(180),
  to_lat: z.coerce.number().min(-90).max(90),
  to_lng: z.coerce.number().min(-180).max(180),
  profile: z.enum(["walking", "driving"]).default("driving"),
});

// ── Tiny LRU cache ─────────────────────────────────────────────────────────
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  key: string;
  value: DirectionsResponse;
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

function cacheGet(key: string): DirectionsResponse | null {
  const now = Date.now();
  for (let i = 0; i < cache.length; i++) {
    const e = cache[i];
    if (e.key === key && e.expiresAt > now) return e.value;
  }
  return null;
}

function cachePut(value: DirectionsResponse, key: string): void {
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

// ── Mapbox Directions call ────────────────────────────────────────────────
async function fetchMapboxRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile: TravelProfile,
  token: string,
  signal: AbortSignal
): Promise<MapboxRouteLike | null> {
  const profileId = profile === "walking" ? "walking" : "driving";
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profileId}/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json() as { routes?: MapboxRouteLike[] };
    const route = data.routes?.[0];
    if (!route) return null;
    return route;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const params = DirectionsQuery.parse(Object.fromEntries(getQueryParams(req)));
    const from = { lat: params.from_lat, lng: params.from_lng };
    const to = { lat: params.to_lat, lng: params.to_lng };
    const key = cacheKey(params);

    // Cache hit — skip the network entirely.
    const hit = cacheGet(key);
    if (hit) return jsonResponse(hit);

    // Heuristic baseline (also used as the fallback when Mapbox is unreachable).
    const fallback = fallbackDirections(from, to, params.profile);

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      // No token configured → always return the estimate with source=estimate.
      return jsonResponse(fallback);
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10_000); // 10 s ceiling on the upstream call
    const route = await fetchMapboxRoute(from, to, params.profile, token, ac.signal);
    clearTimeout(timeout);

    const response = route
      ? buildDirectionsResponse(route, params.profile)
      : fallback;
    cachePut(response, key);
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}
