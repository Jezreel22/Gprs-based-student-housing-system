"use client";

/**
 * LocationPicker
 *
 * A reusable location capture component for the listing wizard.
 * Combines a Google Places autocomplete address search with an interactive
 * draggable map pin so landlords can pinpoint the exact property location
 * without needing to know lat/lng coordinates.
 *
 * Usage:
 *   <LocationPicker onChange={(coords, label) => { setLocation(coords); }} />
 *
 * `coords` is `{ lat: number; lng: number } | null` when a pin is placed.
 * `label` is a human-readable string (reverse-geocoded from the pin position,
 * or from the Places result).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useGoogleMaps } from "@/hooks/use-google-maps";
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

export default function LocationPicker({
  onChange,
  initialCoords = null,
  initialLabel = "",
  className = "",
}: LocationPickerProps) {
  const { isLoaded, isError, google } = useGoogleMaps();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  const [coords, setCoords] = useState<MapCentre | null>(initialCoords);
  const [label, setLabel] = useState(initialLabel);
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Initialise or re-initialise the map whenever the google global becomes available.
  useEffect(() => {
    if (!isLoaded || !google || !mapRef.current) return;

    // If a map already exists, just update the marker position.
    if (mapInstanceRef.current) {
      if (coords) {
        markerRef.current?.setPosition(coords);
        mapInstanceRef.current.panTo(coords);
      }
      return;
    }

    // First mount: create the map.
    const map = new google.maps.Map(mapRef.current, {
      center: coords ?? NAUB_COORDS,
      zoom: NAUB_DEFAULT_ZOOM,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
      ],
    });

    // Single draggable marker — placed at initial coords or NAUB campus.
    const marker = new google.maps.Marker({
      position: coords ?? NAUB_COORDS,
      map,
      draggable: true,
      animation: google.maps.Animation.DROP,
    });

    mapInstanceRef.current = map;
    markerRef.current = marker;

    // When the user drags the pin, reverse-geocode and emit.
    marker.addListener("dragend", async () => {
      const pos = marker.getPosition();
      if (!pos) return;
      const lat = pos.lat();
      const lng = pos.lng();
      setCoords({ lat, lng });
      await reverseGeocode({ lat, lng });
    });

    // When the map is dragged (not marker), update the marker to match.
    map.addListener("dragend", () => {
      const c = map.getCenter();
      if (!c) return;
      if (marker.getPosition()?.lat() !== c.lat() || marker.getPosition()?.lng() !== c.lng()) {
        marker.setPosition(c);
      }
    });

    // Click on the map moves the marker.
    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      marker.setPosition(e.latLng);
      const newCoords = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      setCoords(newCoords);
      reverseGeocode(newCoords);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, google]);

  /**
   * Reverse geocode lat/lng to a human-readable label, then call onChange.
   */
  const reverseGeocode = useCallback(async (c: MapCentre) => {
    setIsGeocoding(true);
    try {
      const res = await fetch(
        `/api/geocode?latlng=${c.lat},${c.lng}`
      );
      if (!res.ok) throw new Error("Geocode failed");
      const data = await res.json();
      const first = data?.results?.[0];
      const resolvedLabel = first?.formatted_address ?? first?.address ?? label;
      setLabel(resolvedLabel);
      onChange(c, resolvedLabel);
    } catch {
      // Non-critical: keep the label we had; just emit coords.
      onChange(c, label);
    } finally {
      setIsGeocoding(false);
    }
  }, [onChange, label]);

  /**
   * Called when the user selects a place from the autocomplete.
   * Centers the map + pin on the chosen location and emits.
   */
  const handlePlaceSelect = useCallback(
    async (c: MapCentre, placeLabel: string) => {
      setCoords(c);
      setLabel(placeLabel);
      onChange(c, placeLabel);

      if (mapInstanceRef.current && markerRef.current && google) {
        mapInstanceRef.current.panTo(c);
        mapInstanceRef.current.setZoom(17);
        markerRef.current.setPosition(c);
      }
    },
    [google, onChange]
  );

  if (isError) {
    return (
      <div className={`rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 ${className}`}>
        <p>Map failed to load. Please check your Google Maps API key.</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Address search via Google Places */}
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
            Drag the pin to the exact property location, or tap anywhere on the map.
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
            <span>{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
          )}
        </div>
      )}
    </div>
  );
}
