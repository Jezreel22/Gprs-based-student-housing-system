/**
 * lib/maps/utils.ts
 *
 * Pure utility functions for the maps module — no browser globals required.
 */

/**
 * Haversine distance between two lat/lng pairs, in kilometres.
 * Used client-side to compute distances in the UI without a server round-trip.
 */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aVal =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/**
 * Format a distance in km into a human-readable string.
 * < 1 km → "450 m from NAUB"
 * ≥ 1 km → "1.8 km from NAUB"
 */
export function formatDistance(km: number, suffix = "from NAUB"): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m ${suffix}`;
  }
  return `${km.toFixed(1)} km ${suffix}`;
}

/**
 * Format a price in Naira.
 */
export function formatNGN(amount: number | null | undefined): string {
  if (!amount) return "₦—";
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}

/**
 * Build the "Get Directions" Google Maps URL from the user's current location
 * to the property. Falls back to address search when origin is unknown.
 */
export function buildDirectionsUrl(
  destination: { lat: number; lng: number },
  origin?: { lat: number; lng: number } | null
): string {
  const dest = `${destination.lat},${destination.lng}`;
  if (origin) {
    const orig = `${origin.lat},${origin.lng}`;
    return `https://www.google.com/maps/dir/${orig}/${dest}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${dest}`;
}

/**
 * Pick the marker colour for a property based on its trust score and price.
 */
export function markerColourForProperty(
  trustScore: number,
  rentAmountNgn: number,
  verificationStatus: string | null
): string {
  if (verificationStatus === "verified" && trustScore >= 70) return "#16A34A";
  if (rentAmountNgn > 100_000) return "#7C3AED";
  return "#FF5A5F";
}

/**
 * Create a coloured SVG pin data URI for use as a Google Maps marker icon.
 * Returns a `{ url, scaledSize }` object compatible with google.maps.Icon.
 */
export function buildMarkerIcon(
  colour: string,
  size: number = 36
): { url: string; scaledSize: { width: number; height: number } } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">
    <circle cx="18" cy="15" r="11" fill="${colour}" stroke="white" stroke-width="2.5"/>
    <ellipse cx="18" cy="33" rx="4" ry="2" fill="${colour}" opacity="0.25"/>
    <line x1="18" y1="26" x2="18" y2="31" stroke="${colour}" stroke-width="2"/>
    <circle cx="18" cy="15" r="4.5" fill="white" opacity="0.9"/>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return { url, scaledSize: { width: size, height: size } };
}

/**
 * Build the SVG for the user location marker (pulsing blue dot style).
 */
export function buildUserLocationIcon(): {
  url: string;
  scaledSize: { width: number; height: number };
} {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="#2563EB" opacity="0.15"/>
    <circle cx="12" cy="12" r="6" fill="#2563EB" stroke="white" stroke-width="2"/>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return { url, scaledSize: { width: 24, height: 24 } };
}
