"use client";

/**
 * useTravelTime — fetches precise travel time + distance between two coords.
 * Returns `null` when the request hasn't run yet; otherwise either a real
 * Mapbox answer or an estimate fallback. The caller renders both the same way
 * (with a subtle "Real travel time" label that flips to "Estimated" when the
 * response carries source === "estimate").
 *
 * Caching is server-side (LRU in /api/maps/travel-time). This hook just gives
 * us a 1-hour staleTime so re-renders and quick profile switches don't repeat
 * requests — TanStack Query deduplicates across hooks calling the same params.
 */

import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";

import type { TravelProfile } from "@/lib/maps/travel";

export interface TravelTimeResult {
  distance_km: number;
  duration_min: number;
  source: "mapbox" | "estimate";
  profile: TravelProfile;
}

export function useTravelTime(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
  profile: TravelProfile = "driving"
): TravelTimeResult | null {
  const enabled = !!from && !!to;
  const { data } = useQuery({
    queryKey: ["travel-time", from?.lat ?? 0, from?.lng ?? 0, to?.lat ?? 0, to?.lng ?? 0, profile],
    queryFn: () =>
      customFetch<TravelTimeResult>(
        `/api/maps/travel-time?from_lat=${from!.lat}&from_lng=${from!.lng}` +
        `&to_lat=${to!.lat}&to_lng=${to!.lng}&profile=${profile}`
      ),
    enabled,
    // Long staleTime — Directions traffic doesn't shift on the timescale of a
    // listing browse, and the server LRU absorbs any cross-user dupes anyway.
    staleTime: 60 * 60 * 1000, // 1 h
    gcTime: 24 * 60 * 60 * 1000, // 24 h
    // Show the heuristic placeholder immediately (rendered via null in our hook)
    // while waiting, so no UI "loading" indicator is needed for fast mapbox calls.
    placeholderData: (prev) => prev,
  });
  return data ?? null;
}
