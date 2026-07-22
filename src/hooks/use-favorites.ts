"use client";

/**
 * Favorites hooks.
 *
 * - useMyFavoriteIds() — the list of property IDs the signed-in user has
 *   saved. Used by PropertyCard / detail page to render the right heart
 *   state without an N+1 query per card.
 * - useToggleFavorite(propertyId) — optimistic add/remove mutation. Calls
 *   POST or DELETE on /api/properties/:id/favorite and updates the ids list.
 *
 * Anonymous users: both hooks are inert (queries disabled). Callers are
 * responsible for redirecting to /login when an anonymous user clicks the
 * heart.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";

const IDS_QUERY_KEY = ["me", "favorite-ids"] as const;

export function useMyFavoriteIds(enabled = true) {
  return useQuery<string[]>({
    queryKey: IDS_QUERY_KEY,
    enabled,
    queryFn: () => customFetch<{ data: string[] }>("/api/me/favorites/ids").then((r) => r.data),
    staleTime: 30_000,
  });
}

interface ToggleResponse {
  isFavorite: boolean;
  favoriteCount: number;
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation<
    ToggleResponse,
    Error,
    { propertyId: string; favorite: boolean },
    { prev: string[] }
  >({
    mutationFn: async ({ propertyId, favorite }) => {
      const method = favorite ? "POST" : "DELETE";
      return customFetch<ToggleResponse>(`/api/properties/${propertyId}/favorite`, { method });
    },
    // Optimistically update the ids list so the heart flips instantly.
    onMutate: async ({ propertyId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: IDS_QUERY_KEY });
      const prev = queryClient.getQueryData<string[]>(IDS_QUERY_KEY) ?? [];
      queryClient.setQueryData<string[]>(IDS_QUERY_KEY, () => {
        const set = new Set(prev);
        if (favorite) set.add(propertyId);
        else set.delete(propertyId);
        return Array.from(set);
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      // Revert on failure.
      if (ctx?.prev) queryClient.setQueryData(IDS_QUERY_KEY, ctx.prev);
    },
    onSettled: () => {
      // Refetch the saved-properties list on the dashboard so the Saved tab
      // stays in sync with the toggle.
      queryClient.invalidateQueries({ queryKey: ["me", "favorites"] });
    },
  });
}
