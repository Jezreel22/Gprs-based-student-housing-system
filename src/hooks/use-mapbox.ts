"use client";

/**
 * useMapbox — loads Mapbox GL JS exactly once, on the client.
 *
 * Mapbox GL touches `window`/`document` at import time, so it MUST NOT be
 * imported at module scope in a server-rendered component. We therefore load it
 * with a dynamic `import()` inside an effect. The promise is cached so every
 * hook instance on the page shares one load (Mapbox GL also dedupes internally).
 *
 * The CSS is imported statically at the top — that's safe under SSR (Next just
 * extracts it) and avoids a flash of unstyled map controls.
 *
 * API shape intentionally mirrors the old `useGoogleMaps` hook so the map
 * components needed minimal changes:
 *   const { isLoaded, isError, mapboxgl } = useMapbox();
 */

import { useState, useEffect } from "react";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type MapboxModule = typeof mapboxgl;

// Singleton load state — shared across all hook instances in the page.
let loadPromise: Promise<MapboxModule | null> | null = null;

function loadMapbox(): Promise<MapboxModule | null> {
  if (loadPromise) return loadPromise;

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
  if (!token) {
    // eslint-disable-next-line no-console
    console.error("[useMapbox] NEXT_PUBLIC_MAPBOX_TOKEN is not set.");
    return Promise.resolve(null);
  }

  loadPromise = import("mapbox-gl")
    .then((mod) => {
      const mb = mod.default;
      mb.accessToken = token;
      return mb;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[useMapbox] Failed to load Mapbox GL:", err);
      loadPromise = null; // allow a retry on next mount
      return null;
    });

  return loadPromise;
}

interface UseMapboxResult {
  isLoaded: boolean;
  isError: boolean;
  mapboxgl: MapboxModule | undefined;
}

export function useMapbox(): UseMapboxResult {
  const [state, setState] = useState<{
    loaded: boolean;
    error: boolean;
    mb: MapboxModule | undefined;
  }>({ loaded: false, error: false, mb: undefined });

  useEffect(() => {
    let cancelled = false;

    loadMapbox().then((mb) => {
      if (cancelled) return;
      if (mb) setState({ loaded: true, error: false, mb });
      else setState({ loaded: false, error: true, mb: undefined });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    isLoaded: state.loaded,
    isError: state.error,
    mapboxgl: state.mb,
  };
}
