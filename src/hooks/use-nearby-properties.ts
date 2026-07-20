/**
 * useNearbyProperties
 *
 * Fetches properties near a given lat/lng from GET /api/properties/nearby.
 * Wraps TanStack Query for caching and deduplication.
 * Results are sorted nearest-first by the server.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  MapBounds,
  MapCentre,
  MapFilters,
  NearbyPropertiesResponse,
} from "@/lib/maps/types";

interface UseNearbyPropertiesOptions {
  centre: MapCentre;
  filters: MapFilters;
  bounds?: MapBounds;
  /** Set to false to pause fetching (e.g. while the user is dragging) */
  enabled?: boolean;
}

async function fetchNearbyProperties(
  centre: MapCentre,
  filters: MapFilters,
  bounds?: MapBounds
): Promise<NearbyPropertiesResponse> {
  const params = new URLSearchParams({
    lat: String(centre.lat),
    lng: String(centre.lng),
    radius_km: String(filters.radius_km),
    page_size: "50",
  });

  if (filters.rent_min != null) params.set("rent_min", String(filters.rent_min));
  if (filters.rent_max != null) params.set("rent_max", String(filters.rent_max));
  if (filters.rooms != null) params.set("rooms", String(filters.rooms));
  if (filters.trust_score_min != null)
    params.set("trust_score_min", String(filters.trust_score_min));
  if (filters.verified_only) params.set("verified_only", "true");

  if (bounds) {
    params.set("bounds_north", String(bounds.north));
    params.set("bounds_south", String(bounds.south));
    params.set("bounds_east", String(bounds.east));
    params.set("bounds_west", String(bounds.west));
  }

  const res = await fetch(`/api/properties/nearby?${params.toString()}`);
  if (!res.ok) throw new Error(`Nearby properties fetch failed (${res.status})`);
  return res.json() as Promise<NearbyPropertiesResponse>;
}

export function useNearbyProperties({
  centre,
  filters,
  bounds,
  enabled = true,
}: UseNearbyPropertiesOptions) {
  return useQuery({
    queryKey: [
      "nearby-properties",
      centre.lat.toFixed(5),
      centre.lng.toFixed(5),
      filters,
      bounds,
    ],
    queryFn: () => fetchNearbyProperties(centre, filters, bounds),
    enabled,
    staleTime: 30_000,       // 30 s — map data is fairly fresh
    gcTime: 5 * 60_000,      // keep in cache for 5 min
    placeholderData: (prev) => prev, // no flash when centre changes
  });
}
