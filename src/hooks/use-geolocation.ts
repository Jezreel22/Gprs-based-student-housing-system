/**
 * useGeolocation — wraps the browser Geolocation API with React state.
 *
 * Returns the current position, loading state, and a typed error so callers
 * can give precise error messages (permission-denied, unavailable, timeout).
 */
"use client";

import { useState, useCallback } from "react";

export type GeolocationErrorCode =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported";

export interface GeolocationState {
  coords: { lat: number; lng: number } | null;
  isLoading: boolean;
  error: GeolocationErrorCode | null;
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    coords: null,
    isLoading: false,
    error: null,
  });

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState({ coords: null, isLoading: false, error: "unsupported" });
      return;
    }

    setState((s) => ({ ...s, isLoading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          isLoading: false,
          error: null,
        });
      },
      (err) => {
        const code: GeolocationErrorCode =
          err.code === 1
            ? "permission_denied"
            : err.code === 2
              ? "position_unavailable"
              : "timeout";
        setState({ coords: null, isLoading: false, error: code });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 }
    );
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return { ...state, requestLocation, clearError };
}
