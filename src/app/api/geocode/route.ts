/**
 * GET /api/geocode
 *
 * Server-side proxy for geocoding. Tries Google Geocoding first (it has the
 * best coverage for Nigerian addresses), falls back to OpenStreetMap's
 * Nominatim (free, no key, smaller coverage but enough for "X, Biu" inputs).
 *
 * Without this fallback, the existing key in .env.local only has the Maps
 * JavaScript API enabled — Google rejects Geocoding requests with
 * REQUEST_DENIED, and addresses never get coordinates.
 *
 * Accepts either `address` (forward geocoding) or `latlng` (reverse).
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleError, jsonResponse, errorResponse, getQueryParams } from "@/lib/api";

const GeocodeQuery = z.object({
  address: z.string().min(2).max(300).optional(),
  latlng: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional(),
});

type GeocodingResult = {
  place_id: string;
  formatted_address: string;
  lat: number;
  lng: number;
  types: string[];
  source: "google" | "nominatim";
};

async function tryGoogle(q: { address?: string; latlng?: string }, apiKey: string): Promise<GeocodingResult[] | null> {
  const gcParams = new URLSearchParams({ key: apiKey });
  if (q.address) gcParams.set("address", q.address);
  if (q.latlng) gcParams.set("latlng", q.latlng);
  try {
    const upstream = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${gcParams.toString()}`,
      { next: { revalidate: 3600 } },
    );
    if (!upstream.ok) return null;
    const body = await upstream.json();
    if (body.status !== "OK" || !body.results?.length) return null;
    return body.results.map((r: any) => ({
      place_id: r.place_id,
      formatted_address: r.formatted_address,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      types: r.types ?? [],
      source: "google" as const,
    }));
  } catch {
    return null;
  }
}

async function tryNominatim(q: { address?: string; latlng?: string }): Promise<GeocodingResult[]> {
  // OpenStreetMap Nominatim — free, no key, decent coverage for towns.
  // Usage policy requires a meaningful User-Agent and a ~1 req/sec ceiling,
  // so the callers (and the backfill script) should throttle.
  const base = "https://nominatim.openstreetmap.org/search";
  const url = q.address
    ? `${base}?q=${encodeURIComponent(q.address)}&format=json&addressdetails=1&limit=1`
    : null;
  const reverseUrl = q.latlng
    ? `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(q.latlng.split(",")[0])}&lon=${encodeURIComponent(q.latlng.split(",")[1])}&format=json`
    : null;
  const target = url ?? reverseUrl;
  if (!target) return [];
  try {
    const upstream = await fetch(target, {
      headers: {
        // Nominatim's usage policy: identify your application.
        "User-Agent": "NAUB-Home-Finder/1.0 (geocoder fallback)",
        "Accept-Language": "en",
      },
      // Don't cache — results may be empty and we want fresh retries.
      cache: "no-store",
    });
    if (!upstream.ok) return [];
    const body = await upstream.json();
    const list: any[] = Array.isArray(body) ? body : [body];
    return list
      .filter((r) => r && (r.lat != null && r.lon != null))
      .map((r) => ({
        place_id: String(r.place_id ?? r.osm_id ?? `${r.lat},${r.lon}`),
        formatted_address: r.display_name ?? q.address ?? q.latlng ?? "",
        lat: Number(r.lat),
        lng: Number(r.lon),
        types: r.type ? [String(r.type)] : [],
        source: "nominatim" as const,
      }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const q = GeocodeQuery.parse(Object.fromEntries(getQueryParams(req)));

    if (!q.address && !q.latlng) {
      return errorResponse("Provide either `address` or `latlng`.", 400);
    }

    // Try Google first (better quality, especially in Nigeria); fall back to
    // Nominatim so the feature still works even when the Google Geocoding API
    // isn't enabled on the project.
    const apiKey =
      process.env.GOOGLE_MAPS_SERVER_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    let results: GeocodingResult[] | null = null;
    if (apiKey) {
      results = await tryGoogle(q, apiKey);
    }
    if (!results || results.length === 0) {
      results = await tryNominatim(q);
    }

    return jsonResponse({ results });
  } catch (err) {
    return handleError(err, req);
  }
}
