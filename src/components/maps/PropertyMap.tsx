"use client";

/**
 * PropertyMap
 *
 * Small single-property map for the listing detail page. Shows the property
 * pin on a real interactive Mapbox map with a "Get directions" affordance.
 * Falls back gracefully (via the caller) when lat/lng are null.
 *
 * Reuses useMapbox + buildDirectionsUrl + buildMarkerIcon — same stack as
 * MapView and LocationPicker so we only load Mapbox GL once per page.
 */

import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { useMapbox } from "@/hooks/use-mapbox";
import {
  buildDirectionsUrl,
  buildMarkerIcon,
  iconElement,
} from "@/lib/maps/utils";

interface PropertyMapProps {
  lat: number;
  lng: number;
  /** Used for the marker colour (verified=green, premium=purple, default=red). */
  verified?: boolean;
  rentAmountNgn?: number | null;
  height?: number;
  className?: string;
}

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

export default function PropertyMap({
  lat,
  lng,
  verified = false,
  rentAmountNgn = null,
  height = 320,
  className = "",
}: PropertyMapProps) {
  const { isLoaded, isError, mapboxgl } = useMapbox();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // Determine marker colour using the same rules as MapView's property markers.
  const colour = verified
    ? "#16A34A"
    : rentAmountNgn && rentAmountNgn > 100_000
      ? "#7C3AED"
      : "#FF5A5F";

  useEffect(() => {
    if (!isLoaded || !mapboxgl || !mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new mapboxgl.Map({
        container: mapRef.current,
        style: MAP_STYLE,
        center: [lng, lat],
        zoom: 16,
        attributionControl: true,
      });
      mapInstanceRef.current.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "top-right"
      );
    } else {
      mapInstanceRef.current.setCenter([lng, lat]);
    }

    markerRef.current?.remove();
    markerRef.current = new mapboxgl.Marker({
      element: iconElement(buildMarkerIcon(colour)),
      anchor: "bottom",
    })
      .setLngLat([lng, lat])
      .addTo(mapInstanceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, mapboxgl, lat, lng, colour]);

  // Cleanup
  useEffect(() => {
    return () => {
      markerRef.current?.remove();
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  if (isError) {
    return (
      <div
        className={`rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 ${className}`}
        style={{ height }}
      >
        <p>Map failed to load. Check the Mapbox token configuration.</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div
        ref={mapRef}
        className="w-full rounded-xl overflow-hidden border border-[#EBEBEB] bg-[#F7F7F7]"
        style={{ height }}
      />
      <a
        href={buildDirectionsUrl({ lat, lng })}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
      >
        Open in Google Maps →
      </a>
    </div>
  );
}
