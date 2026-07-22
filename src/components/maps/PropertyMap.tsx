"use client";

/**
 * PropertyMap
 *
 * Small single-property map for the listing detail page. Shows the property
 * pin on a real interactive Google Map with a "Get directions" affordance.
 * Falls back gracefully (via the caller) when lat/lng are null.
 *
 * Reuses useGoogleMaps + buildDirectionsUrl + buildMarkerIcon — same stack as
 * MapView and LocationPicker so we only load the Maps API once per page.
 */

import { useEffect, useRef } from "react";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import { buildDirectionsUrl, buildMarkerIcon } from "@/lib/maps/utils";

interface PropertyMapProps {
  lat: number;
  lng: number;
  /** Used for the marker colour (verified=green, premium=purple, default=red). */
  verified?: boolean;
  rentAmountNgn?: number | null;
  height?: number;
  className?: string;
}

export default function PropertyMap({
  lat,
  lng,
  verified = false,
  rentAmountNgn = null,
  height = 320,
  className = "",
}: PropertyMapProps) {
  const { isLoaded, isError, google } = useGoogleMaps();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);

  // Determine marker colour using the same rules as MapView's property markers.
  const colour =
    verified
      ? "#16A34A"
      : rentAmountNgn && rentAmountNgn > 100_000
        ? "#7C3AED"
        : "#FF5A5F";

  useEffect(() => {
    if (!isLoaded || !google || !mapRef.current) return;

    // Re-use an existing map instance if coords haven't changed (avoids
    // re-creating the map on every render). Otherwise build a fresh one.
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
        center: { lat, lng },
        zoom: 16,
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: true,
        fullscreenControl: true,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
        ],
      });
    } else {
      mapInstanceRef.current.setCenter({ lat, lng });
    }

    const icon = buildMarkerIcon(colour);
    new google.maps.Marker({
      position: { lat, lng },
      map: mapInstanceRef.current,
      icon: {
        url: icon.url,
        scaledSize: new google.maps.Size(icon.scaledSize.width, icon.scaledSize.height),
      },
      title: "Property location",
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, google, lat, lng, colour]);

  if (isError) {
    return (
      <div
        className={`rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 ${className}`}
        style={{ height }}
      >
        <p>Map failed to load. Check the Google Maps API key configuration.</p>
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
