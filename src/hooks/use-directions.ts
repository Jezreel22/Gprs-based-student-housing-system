"use client";

/**
 * useDirections — fetches a full Mapbox Directions route (geometry + steps)
 * between two coords. Returns `null` until the request resolves; otherwise
 * either a real Mapbox answer or the server-side fallback estimate. The
 * caller renders both the same way (with an "(est.)" badge when
 * `source === "estimate"`).
 *
 * Caching: server-side (LRU in /api/maps/directions). This hook just gives
 * us a 1-hour staleTime so re-renders and quick profile switches don't
 * repeat requests — TanStack Query deduplicates across hooks calling the
 * same params.
 */

import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";

import type { TravelProfile } from "@/lib/maps/travel";
import type { DirectionsResponse } from "@/lib/maps/directions";

export function useDirections(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
  profile: TravelProfile = "driving"
): DirectionsResponse | null {
  const enabled = !!from && !!to;
  const { data } = useQuery({
    queryKey: ["directions", from?.lat ?? 0, from?.lng ?? 0, to?.lat ?? 0, to?.lng ?? 0, profile],
    queryFn: () =>
      customFetch<DirectionsResponse>(
        `/api/maps/directions?from_lat=${from!.lat}&from_lng=${from!.lng}` +
        `&to_lat=${to!.lat}&to_lng=${to!.lng}&profile=${profile}`
      ),
    enabled,
    // Long staleTime — routes don't shift on the timescale of a listing
    // browse, and the server LRU absorbs any cross-user dupes anyway.
    staleTime: 60 * 60 * 1000, // 1 h
    gcTime: 24 * 60 * 60 * 1000, // 24 h
    // Show the previous profile's geometry while a new one loads so the
    // map polyline doesn't flash to nothing on a profile switch.
    placeholderData: (prev) => prev,
  });
  return data ?? null;
}
