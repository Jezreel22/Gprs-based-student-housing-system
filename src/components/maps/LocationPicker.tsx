"use client";

/**
 * LocationPicker
 *
 * A reusable location capture component for the listing wizard.
 * Combines an address search (Mapbox forward geocoding via LocationSearch)
 * with an interactive draggable map pin so landlords can pinpoint the exact
 * property location without needing to know lat/lng coordinates.
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
import LocationSearch from "./LocationSearch";
import { MapPin, Loader2 } from "lucide-react";
import { NAUB_COORDS, NAUB_DEFAULT_ZOOM } from "@/lib/maps/constants";
import type { MapCentre } from "@/lib/maps/types";

interface LocationPickerProps {
  onChange: (coords: MapCentre | null, label: string) => void;
  initialCoords?: MapCentre | null;
  initialLabel?: string;
  className?: string;
}

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

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

      {/* Interactive map with draggable pin */}
      {isLoaded && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">
            Drag the pin to the exact property location, or tap anywhere on the
            map.
          </p>
          <div className="relative rounded-xl overflow-hidden border border-[#EBEBEB]">
            <div ref={mapRef} className="w-full h-52" />
            {!coords && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none">
                <span className="text-xs text-white bg-black/60 px-2 py-1 rounded">
                  Drag pin to set location
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live coords readout */}
      {coords && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {isGeocoding ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Getting address…
            </span>
          ) : label ? (
            <span className="line-clamp-1">{label}</span>
          ) : (
            <span>
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
