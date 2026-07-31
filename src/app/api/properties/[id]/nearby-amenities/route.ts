/**
 * GET /api/properties/[id]/nearby-amenities
 *
 * Nearby points-of-interest (shops, groceries, schools, transit, health, …)
 * around a property, via the Mapbox Geocoding POI endpoint. Backs the
 * "What's nearby" card on the property detail page (Location Program
 * Feature 4).
 *
 * Caching: a small in-memory LRU keyed on the property id. Module-scope
 * (cleared on serverless cold-start). One entry per property → bounded by the
 * number of listings viewed in an hour, server-side; the client hook then
 * dedupes per-user with a 1-hour staleTime. On Vercel/serverless the LRU may
 * cold-start between invocations.
 *
 * Fallback: if the Mapbox token is missing, the call is aborted, or every
 * category returns nothing, we return `source: "empty"` with an empty
 * `categories` map and `score: 0`. The UI hides the card rather than render
 * a broken panel — never a 500.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { handleError, jsonResponse, getQueryParams } from "@/lib/api";
import { db } from "@/lib/db";
import { propertiesTable } from "@/lib/db/schema";
import { haversineKm } from "@/lib/maps/utils";
import {
  AMENITY_CATEGORIES,
  amenityScore,
  type NearbyAmenity,
  type NearbyAmenitiesResponse,
} from "@/lib/maps/amenities";

export const runtime = "nodejs";
// Allow up to 15 s for the per-category fan-out before falling back to empty.
export const maxDuration = 15;

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

// ── Tiny LRU cache ─────────────────────────────────────────────────────────
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
// Empty results get a much shorter TTL: POI coverage grows over time, so a
// property with no hits today may have some next week — but we still want to
// suppress the ~10-call Mapbox fan-out for repeat visitors in the meantime.
const CACHE_EMPTY_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  key: string;
  value: NearbyAmenitiesResponse;
  expiresAt: number;
}

const cache: CacheEntry[] = [];

function cacheGet(key: string): NearbyAmenitiesResponse | null {
  const now = Date.now();
  for (const e of cache) {
    if (e.key === key && e.expiresAt > now) return e.value;
  }
  return null;
}

function cachePut(
  value: NearbyAmenitiesResponse,
  key: string,
  ttlMs: number = CACHE_TTL_MS
): void {
  const now = Date.now();
  // Evict expired + duplicate keyed by the property id.
  for (let i = cache.length - 1; i >= 0; i--) {
    if (cache[i].expiresAt <= now || cache[i].key === key) cache.splice(i, 1);
  }
  cache.push({ key, value, expiresAt: now + ttlMs });
  if (cache.length > CACHE_MAX) cache.shift();
}

// ── Empty response helper ──────────────────────────────────────────────────
function emptyResponse(
  centre: { lat: number; lng: number } | null
): NearbyAmenitiesResponse {
  return {
    centre: centre ?? { lat: 0, lng: 0 },
    categories: {},
    score: 0,
    source: "empty",
    fetchedAt: Date.now(),
  };
}

// ── Mapbox POI fetch ───────────────────────────────────────────────────────
interface MapboxFeature {
  id?: string;
  text?: string;
  place_name?: string;
  center?: [number, number]; // [lng, lat]
  geometry?: { coordinates?: [number, number] };
}

async function fetchCategoryPois(
  query: string,
  centre: { lat: number; lng: number },
  token: string,
  signal: AbortSignal
): Promise<MapboxFeature[]> {
  // Note: `types=poi` is too restrictive for Nigeria (sparse POI coverage).
  // We search without type filtering and let the query terms drive relevance.
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${encodeURIComponent(token)}` +
    `&proximity=${centre.lng},${centre.lat}` +
    `&country=ng` +
    `&limit=3` +
    `&language=en`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: MapboxFeature[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const q = Query.parse(Object.fromEntries(getQueryParams(req)));

    // Cache key is the property id (lat/lng overrides change cents of a km at
    // most and a property's pin is fixed; the server LRU is already a 1-h
    // approximation).
    const hit = cacheGet(id);
    if (hit) return jsonResponse(hit);

    // Resolve centre: optional query override → DB row. Without a centre we
    // can't query Mapbox so we bail with empty.
    let centre: { lat: number; lng: number } | null = null;
    if (q.lat != null && q.lng != null) {
      centre = { lat: q.lat, lng: q.lng };
    }
    if (!centre) {
      const rows = await db
        .select({ latitude: propertiesTable.latitude, longitude: propertiesTable.longitude })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, id))
        .limit(1);
      const row = rows[0];
      if (row?.latitude != null && row?.longitude != null) {
        centre = { lat: row.latitude, lng: row.longitude };
      }
    }
    if (!centre) return jsonResponse(emptyResponse(null));

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return jsonResponse(emptyResponse(centre));

    // One fan-out over all categories, bounded by a single 10s timeout.
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10_000);
    const results = await Promise.all(
      AMENITY_CATEGORIES.map(async (cat) => {
        const features = await fetchCategoryPois(cat.query, centre!, token, ac.signal);
        const places: NearbyAmenity[] = [];
        for (const f of features) {
          const coord = f.center ?? f.geometry?.coordinates;
          if (!coord) continue;
          const [lng, lat] = coord;
          places.push({
            id: f.id ?? `${cat.key}-${lng}-${lat}`,
            name: f.text ?? f.place_name ?? cat.label,
            category: cat.key,
            distanceMeters: Math.round(haversineKm(centre!, { lat, lng }) * 1000),
            lat,
            lng,
          });
        }
        // Nearest-first, capped at 3 to bound the payload.
        places.sort((a, b) => a.distanceMeters - b.distanceMeters);
        return [cat.key, places.slice(0, 3)] as const;
      })
    );
    clearTimeout(timeout);

    const categories: Record<string, NearbyAmenity[]> = {};
    for (const [key, list] of results) {
      if (list.length > 0) categories[key] = list;
    }

    // No Mapbox results at all → empty response (UI hides the card). Negative-
    // cache it with a short TTL so repeat visitors don't each re-fan-out the
    // full set of Mapbox category queries for a property that has no POIs.
    if (Object.keys(categories).length === 0) {
      const empty = emptyResponse(centre);
      cachePut(empty, id, CACHE_EMPTY_TTL_MS);
      return jsonResponse(empty);
    }

    const response: NearbyAmenitiesResponse = {
      centre,
      categories,
      score: amenityScore(categories),
      source: "mapbox",
      fetchedAt: Date.now(),
    };
    cachePut(response, id);
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}
