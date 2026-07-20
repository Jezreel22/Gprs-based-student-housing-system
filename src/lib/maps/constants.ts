/**
 * lib/maps/constants.ts
 *
 * App-wide constants for the Google Maps module.
 */

/** Nigerian Army University Biu — default map centre */
export const NAUB_COORDS = { lat: 10.6102, lng: 12.1978 } as const;

/** Default zoom shows ~5 km radius comfortably */
export const NAUB_DEFAULT_ZOOM = 14;

/** Radius options shown in the filter dropdown (km) */
export const RADIUS_OPTIONS = [2, 5, 10, 20, 50] as const;
export type RadiusKm = (typeof RADIUS_OPTIONS)[number];

/** Fixed colour palette used by the custom map markers */
export const MARKER_COLOURS = {
  /** Highly-trusted / Trusted landlord — green shield */
  verified: "#16A34A",
  /** Standard listing */
  standard: "#FF5A5F",
  /** Premium (rent > 100k NGN/yr) */
  premium: "#7C3AED",
  /** User's current location */
  user: "#2563EB",
} as const;

/** How long (ms) to debounce map idle events before showing "Search area" btn */
export const MAP_IDLE_DEBOUNCE_MS = 600;
