/**
 * useGeolocation — wraps the browser Geolocation API with React state.
 *
 * Returns the current position (including GPS accuracy in metres), the fix
 * timestamp, loading state, and a typed error so callers can give precise
 * error messages (permission-denied, unavailable, timeout).
 *
 * Deliberately one-shot (`getCurrentPosition`, not `watchPosition`): location
 * is fetched only when `requestLocation` is called, so we never poll or drain
 * the battery. `maximumAge: 60s` lets the browser serve a recent cached fix.
 */
"use client";

import { useState, useCallback } from "react";

export type GeolocationErrorCode =
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unsupported";

export interface GeolocationState {
  coords: { lat: number; lng: number; accuracy: number } | null;
  isLoading: boolean;
  error: GeolocationErrorCode | null;
  /** Epoch ms of when the position fix was acquired; null until the first fix. */
  timestamp: number | null;
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    coords: null,
    isLoading: false,
    error: null,
    timestamp: null,
  });

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState({ coords: null, isLoading: false, error: "unsupported", timestamp: null });
      return;
    }

    setState((s) => ({ ...s, isLoading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
          isLoading: false,
          error: null,
          timestamp: position.timestamp,
        });
      },
      (err) => {
        const code: GeolocationErrorCode =
          err.code === 1
            ? "permission_denied"
            : err.code === 2
              ? "position_unavailable"
              : "timeout";
        setState({ coords: null, isLoading: false, error: code, timestamp: null });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 }
    );
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return { ...state, requestLocation, clearError };
}
