/**
 * GET /api/geocode
 *
 * Server-side proxy for the Google Geocoding API.
 * Keeps the server-side API key (GOOGLE_MAPS_SERVER_API_KEY) out of the
 * browser. Accepts either `address` (forward geocoding) or `latlng`
 * (reverse geocoding), mirrors the same result shape used client-side.
 *
 * Rate-limit: callers should debounce before hitting this endpoint.
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
};

export async function GET(req: NextRequest) {
  try {
    const q = GeocodeQuery.parse(Object.fromEntries(getQueryParams(req)));

    if (!q.address && !q.latlng) {
      return errorResponse("Provide either `address` or `latlng`.", 400);
    }

    const apiKey =
      process.env.GOOGLE_MAPS_SERVER_API_KEY ??
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return errorResponse("Google Maps API key not configured.", 500);
    }

    const gcParams = new URLSearchParams({ key: apiKey });
    if (q.address) gcParams.set("address", q.address);
    if (q.latlng) gcParams.set("latlng", q.latlng);

    const upstream = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${gcParams.toString()}`,
      { next: { revalidate: 3600 } } // cache for 1 h in Next.js data cache
    );

    if (!upstream.ok) {
      return errorResponse("Geocoding service unavailable.", 502);
    }

    const body = await upstream.json();

    if (body.status === "ZERO_RESULTS") {
      return jsonResponse({ results: [] as GeocodingResult[] });
    }

    if (body.status !== "OK") {
      return errorResponse(`Geocoding error: ${body.status}`, 502);
    }

    const results: GeocodingResult[] = (body.results ?? []).map(
      (r: {
        place_id: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        types: string[];
      }) => ({
        place_id: r.place_id,
        formatted_address: r.formatted_address,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        types: r.types,
      })
    );

    return jsonResponse({ results });
  } catch (err) {
    return handleError(err, req);
  }
}
