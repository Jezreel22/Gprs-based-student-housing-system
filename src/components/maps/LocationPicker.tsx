"use client";

/**
 * LocationPicker
 *
 * A reusable location capture component for the listing wizard.
 * Combines an address search (Mapbox forward geocoding via LocationSearch)
 * with an interactive draggable map pin and a "Use my current location"
 * button so landlords can pinpoint the exact property location without
 * needing to know lat/lng coordinates — and without needing to type
 * anything if they're already at the property with their phone.
 *
 * Usage:
 *   <LocationPicker onChange={(coords, label) => { setLocation(coords); }} />
 *
 * `coords` is `{ lat: number; lng: number } | null` when a pin is placed.
 * `label` is a human-readable string (reverse-geocoded from the pin position,
 * or from the search result).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type mapboxgl from "mapbox-gl";
import { useMapbox } from "@/hooks/use-mapbox";
import { useGeolocation } from "@/hooks/use-geolocation";
import LocationSearch from "./LocationSearch";
import { MapPin, Loader2, Navigation, CheckCircle2 } from "lucide-react";
import { NAUB_COORDS, NAUB_DEFAULT_ZOOM } from "@/lib/maps/constants";
import type { MapCentre } from "@/lib/maps/types";

interface LocationPickerProps {
  onChange: (coords: MapCentre | null, label: string) => void;
  initialCoords?: MapCentre | null;
  initialLabel?: string;
  className?: string;
}

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

// Plain-language messages for each geolocation error code. No jargon — this
// picker is shown in the listing wizard where users may not be technical.
// The drag-the-pin fallback is always available as an alternative.
const GEO_ERROR_MESSAGES: Record<string, string> = {
  permission_denied:
    "Location access was denied. Tap 'Allow' when your browser or phone asks, or drag the red pin instead.",
  position_unavailable:
    "Couldn't find your location. Try turning on location services in your phone settings, or drag the red pin.",
  timeout:
    "Taking too long to find you — try outdoors or near a window, or drag the red pin to your property instead.",
  unsupported:
    "Your browser doesn't support location. Drag the red pin on the map to your property.",
  insecure_context:
    "Location needs a secure connection. Open this site over HTTPS (localhost is okay for development), then try again or drag the red pin.",
};

export default function LocationPicker({
  onChange,
  initialCoords = null,
  initialLabel = "",
  className = "",
}: LocationPickerProps) {
  const { isLoaded, isError, mapboxgl } = useMapbox();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [coords, setCoords] = useState<MapCentre | null>(initialCoords);
  const [label, setLabel] = useState(initialLabel);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const geo = useGeolocation();

  /**
   * Move the pin + map to the given coords. Safe to call before the map has
   * finished loading — the map effect below will pick up the latest `coords`
   * state and initialise centred on it.
   */
  const placePinAt = useCallback(
    (c: MapCentre) => {
      setCoords(c);
      if (mapInstanceRef.current && markerRef.current) {
        markerRef.current.setLngLat([c.lng, c.lat]);
        mapInstanceRef.current.flyTo({
          center: [c.lng, c.lat],
          zoom: 17,
          duration: 800,
        });
      }
    },
    []
  );

  const handleUseMyLocation = useCallback(() => {
    geo.requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a GPS fix resolves, drop the pin at it and reverse-geocode the label.
  const prevGeoTimestamp = useRef<number | null>(null);
  useEffect(() => {
    if (!geo.coords || prevGeoTimestamp.current === geo.timestamp) return;
    prevGeoTimestamp.current = geo.timestamp;
    const c = { lat: geo.coords.lat, lng: geo.coords.lng };
    placePinAt(c);
    reverseGeocode(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.coords, geo.timestamp]);

  // Initialise or update the map when Mapbox GL becomes available.
  useEffect(() => {
    if (!isLoaded || !mapboxgl || !mapRef.current) return;

    // If a map already exists, just move the marker.
    if (mapInstanceRef.current) {
      if (coords) {
        markerRef.current?.setLngLat([coords.lng, coords.lat]);
        mapInstanceRef.current.panTo([coords.lng, coords.lat]);
      }
      return;
    }

    // First mount: create the map.
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: MAP_STYLE,
      center: [coords?.lng ?? NAUB_COORDS.lng, coords?.lat ?? NAUB_COORDS.lat],
      zoom: NAUB_DEFAULT_ZOOM,
      attributionControl: true,
    });
    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    // Single draggable marker.
    const marker = new mapboxgl.Marker({
      draggable: true,
      color: "#FF5A5F",
    })
      .setLngLat([coords?.lng ?? NAUB_COORDS.lng, coords?.lat ?? NAUB_COORDS.lat])
      .addTo(map);

    mapInstanceRef.current = map;
    markerRef.current = marker;

    // When the user drags the pin, reverse-geocode and emit.
    marker.on("dragend", () => {
      const lngLat = marker.getLngLat();
      const newCoords = { lat: lngLat.lat, lng: lngLat.lng };
      setCoords(newCoords);
      reverseGeocode(newCoords);
    });

    // Click on the map moves the marker.
    map.on("click", (e: mapboxgl.MapMouseEvent) => {
      const newCoords = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      marker.setLngLat([newCoords.lng, newCoords.lat]);
      setCoords(newCoords);
      reverseGeocode(newCoords);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, mapboxgl]);

  // Cleanup
  useEffect(() => {
    return () => {
      markerRef.current?.remove();
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  /**
   * Reverse geocode lat/lng to a human-readable label, then call onChange.
   * Uses the existing /api/geocode route (Nominatim-backed, no extra key).
   */
  const reverseGeocode = useCallback(
    async (c: MapCentre) => {
      setIsGeocoding(true);
      try {
        const res = await fetch(`/api/geocode?latlng=${c.lat},${c.lng}`);
        if (!res.ok) throw new Error("Geocode failed");
        const data = await res.json();
        const first = data?.results?.[0];
        const resolvedLabel = first?.formatted_address ?? label;
        setLabel(resolvedLabel);
        onChange(c, resolvedLabel);
      } catch {
        // Non-critical: keep the label we had; just emit coords.
        onChange(c, label);
      } finally {
        setIsGeocoding(false);
      }
    },
    [onChange, label]
  );

  /**
   * Called when the user selects a place from the autocomplete.
   * Centers the map + pin on the chosen location and emits.
   */
  const handlePlaceSelect = useCallback(
    (c: MapCentre, placeLabel: string) => {
      setCoords(c);
      setLabel(placeLabel);
      onChange(c, placeLabel);

      if (mapInstanceRef.current && markerRef.current) {
        mapInstanceRef.current.flyTo({
          center: [c.lng, c.lat],
          zoom: 17,
          duration: 800,
        });
        markerRef.current.setLngLat([c.lng, c.lat]);
      }
    },
    [onChange]
  );

  if (isError) {
    return (
      <div
        className={`rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 ${className}`}
      >
        <p>Map failed to load. Please check your Mapbox token.</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Address search */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Property location
        </label>
        {isLoaded ? (
          <LocationSearch
            onSelect={handlePlaceSelect}
            placeholder="Search address or landmark near NAUB…"
          />
        ) : (
          <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-[#EBEBEB] bg-white text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Loading map…
          </div>
        )}
      </div>

      {/*
        Stand-at-the-property-and-tap-here escape hatch. Visible whether or not
        the Mapbox map has loaded — a non-literate landlord on a 3G connection
        shouldn't need to wait for tiles. Big tap target, plain label.
      */}
      <button
        type="button"
        onClick={handleUseMyLocation}
        disabled={geo.isLoading}
        aria-label="Use my current location"
        className="flex items-center justify-center gap-2 h-12 px-4 rounded-xl border-2 border-primary/40 bg-primary/5 text-primary text-base font-semibold hover:bg-primary/10 hover:border-primary/60 disabled:opacity-60 transition-colors"
      >
        {geo.isLoading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin shrink-0" />
            <span>Finding your spot…</span>
          </>
        ) : (
          <>
            <Navigation className="h-5 w-5 shrink-0" />
            <span>Use my current location</span>
          </>
        )}
      </button>

      {/*
        Geolocation error — friendly one-liner with the drag-the-pin fallback.
        We don't hide the button on error: the user may want to retry, and the
        pin is always an alternative.
      */}
      {geo.error && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {GEO_ERROR_MESSAGES[geo.error] ?? GEO_ERROR_MESSAGES.unsupported}
        </p>
      )}

      {/* Interactive map with draggable pin */}
      {isLoaded && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">
            Or drag the red pin to the exact property location, or tap anywhere
            on the map.
          </p>
          <div className="relative rounded-xl overflow-hidden border border-[#EBEBEB]">
            <div ref={mapRef} className="w-full h-52" />
            {!coords && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                <span className="text-xs text-white bg-black/60 px-2 py-1 rounded">
                  Drag pin or tap to set location
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/*
        Confirmation chip — replaces the previous tiny text-only readout.
        Stays visible whether the pin came from search, drag, click, or the
        "Use my location" button. Green-on-cream matches the brand's success
        colour; the lat/lng fallback is only shown when no label resolved.
      */}
      {coords && (
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-sm">
            <p className="font-semibold text-emerald-900">Location pinned</p>
            {isGeocoding ? (
              <p className="flex items-center gap-1 text-emerald-700 text-xs mt-0.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Getting address…
              </p>
            ) : label ? (
              <p className="text-emerald-800 line-clamp-2 mt-0.5">{label}</p>
            ) : (
              <p className="text-emerald-800 text-xs mt-0.5 font-mono">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            )}
          </div>
          <MapPin className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        </div>
      )}
    </div>
  );
}
