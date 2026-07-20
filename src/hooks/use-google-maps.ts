/**
 * useGoogleMaps — lazy-loads the Google Maps JavaScript API exactly once.
 *
 * The script tag is appended to <head> on first call. Subsequent calls reuse
 * the same promise so we never double-load. The hook fires a state update when
 * the API is ready so consumers can re-render with the `google` global present.
 */
"use client";

import { useState, useEffect } from "react";

// Singleton load state — shared across all hook instances in the same page.
type LoadState = "idle" | "loading" | "ready" | "error";
let globalState: LoadState = "idle";
let resolvers: Array<(ready: boolean) => void> = [];

function notifyAll(ready: boolean) {
  resolvers.forEach((r) => r(ready));
  resolvers = [];
}

function loadScript(apiKey: string): Promise<boolean> {
  if (globalState === "ready") return Promise.resolve(true);
  if (globalState === "error") return Promise.resolve(false);

  const promise = new Promise<boolean>((resolve) => {
    resolvers.push(resolve);
  });

  if (globalState === "loading") return promise;

  globalState = "loading";

  // Define the callback before injecting the script.
  (window as unknown as Record<string, unknown>)["__naub_maps_ready"] = () => {
    globalState = "ready";
    notifyAll(true);
  };

  const script = document.createElement("script");
  script.id = "google-maps-script";
  script.src = [
    "https://maps.googleapis.com/maps/api/js",
    `?key=${apiKey}`,
    "&libraries=places,geometry",
    "&callback=__naub_maps_ready",
    "&loading=async",
  ].join("");
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    globalState = "error";
    notifyAll(false);
  };

  document.head.appendChild(script);
  return promise;
}

interface UseGoogleMapsResult {
  isLoaded: boolean;
  isError: boolean;
  google: typeof window.google | undefined;
}

export function useGoogleMaps(): UseGoogleMapsResult {
  const [state, setState] = useState<{ loaded: boolean; error: boolean }>({
    loaded: globalState === "ready",
    error: globalState === "error",
  });

  useEffect(() => {
    // Already ready — nothing to do.
    if (state.loaded || state.error) return;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!apiKey) {
      console.error(
        "[useGoogleMaps] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set."
      );
      setState({ loaded: false, error: true });
      return;
    }

    loadScript(apiKey).then((ready) => {
      setState({ loaded: ready, error: !ready });
    });
  }, [state.loaded, state.error]);

  return {
    isLoaded: state.loaded,
    isError: state.error,
    google: state.loaded ? window.google : undefined,
  };
}
