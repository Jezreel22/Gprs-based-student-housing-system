"use client";

/**
 * useNearbyAmenities — fetches nearby POI categories (shops, groceries,
 * schools, transit, health, …) for a property via the server-proxied
 * Mapbox Geocoding route. Backed by an in-memory LRU server-side (1 hour) and
 * a 1-hour client staleTime, so a user opening several listings in a session
 * hits the network at most once per property per hour.
 *
 * Returns `null` until the first response arrives; the UI renders its own
 * skeleton during that window. On the empty path (no coords, no token, no
 * Mapbox results) the response is `source: "empty"` with empty categories —
 * the caller checks and renders nothing.
 *
 * Mirrors `useTravelTime` (Location Program Feature 2).
 */

import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";

import type { NearbyAmenitiesResponse } from "@/lib/maps/amenities";

export function useNearbyAmenities(propertyId: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ["nearby-amenities", propertyId],
    queryFn: () =>
      customFetch<NearbyAmenitiesResponse>(
        `/api/properties/${propertyId}/nearby-amenities`
      ),
    enabled: !!propertyId,
    // POIs are very stable on the timescale of a listing browse; the server LRU
    // handles cross-user dedupe.
    staleTime: 60 * 60 * 1000, // 1 h
    gcTime: 24 * 60 * 60 * 1000, // 24 h
    placeholderData: (prev) => prev,
  });
  return { data: data ?? null, isLoading };
}
