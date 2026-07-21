"use client";

/**
 * MapView
 *
 * Renders a Google Map centred on NAUB (or a provided centre), plots custom
 * property markers, and manages marker → info-window → property-card
 * synchronisation.
 *
 * Responsibilities:
 *  - Lazy-loads the Maps API (via useGoogleMaps)
 *  - Creates one google.maps.Marker per property
 *  - Clusters markers in dense areas (manual clustering via grid)
 *  - Opens an InfoWindow with property details on marker click
 *  - Emits `onIdle` so the parent can opt-in to "Search this area"
 *  - Exposes `selectedId` + `onSelectProperty` so cards/markers stay in sync
 */

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import {
  buildMarkerIcon,
  buildUserLocationIcon,
  buildDirectionsUrl,
  formatDistance,
  formatNGN,
  markerColourForProperty,
} from "@/lib/maps/utils";
import { NAUB_COORDS, NAUB_DEFAULT_ZOOM } from "@/lib/maps/constants";
import { trustLevelLabel, trustLevelForScore } from "@/lib/trust/levels";
import { TRUST_LEVEL_STYLES } from "@/components/trust-level-styles";
import type { MapBounds, MapCentre, NearbyProperty } from "@/lib/maps/types";
import { pickListingPhoto, LISTING_PHOTOS } from "@/lib/listing-photos";
import { Loader2, MapPin, AlertTriangle } from "lucide-react";

export interface MapViewHandle {
  /** Pan/zoom the map to a given coordinate */
  panTo: (coords: MapCentre, zoom?: number) => void;
  /** Return current visible bounds */
  getBounds: () => MapBounds | null;
}

interface MapViewProps {
  properties: NearbyProperty[];
  centre?: MapCentre;
  zoom?: number;
  userLocation?: MapCentre | null;
  selectedId?: string | null;
  onSelectProperty?: (id: string | null) => void;
  onIdle?: (centre: MapCentre, bounds: MapBounds) => void;
  className?: string;
}

// ── Info-window HTML builder ───────────────────────────────────────────────
function buildInfoWindowContent(
  p: NearbyProperty,
  userLocation: MapCentre | null | undefined
): string {
  const level = trustLevelForScore(p.trust_score);
  const style = TRUST_LEVEL_STYLES[level];
  const distFromNaub = formatDistance(p.distance_from_naub_km);
  const distFromUser =
    userLocation != null
      ? formatDistance(p.distance_from_centre_km, "from your location")
      : null;
  const verified = p.landlord?.verification_status === "verified";
  const img = p.hero_photo_url ?? pickListingPhoto(p.id ?? "default");

  return `
    <div style="font-family:'Plus Jakarta Sans',sans-serif;width:260px;border-radius:12px;overflow:hidden;background:#fff;">
      <div style="position:relative;">
        <img
          src="${img}"
          alt="Property"
          style="width:100%;height:140px;object-fit:cover;display:block;"
          onerror={'this.src="/listings/listing-1.jpeg"'}
        />
        ${
          verified
            ? `<div style="position:absolute;top:8px;right:8px;background:rgba(255,255,255,0.95);border-radius:20px;padding:3px 9px;font-size:11px;font-weight:700;color:#16A34A;display:flex;align-items:center;gap:4px;">
                Verified
              </div>`
            : ""
        }
      </div>
      <div style="padding:12px;">
        <div style="font-size:15px;font-weight:700;color:#111;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${p.address}
        </div>
        <div style="font-size:13px;font-weight:700;color:#FF5A5F;margin-bottom:6px;">
          ${formatNGN(p.rent_amount_ngn)}<span style="font-weight:400;color:#717171;font-size:11px;">/yr</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <span style="font-size:11px;background:${style.bg};color:${style.color};border-radius:20px;padding:2px 8px;font-weight:600;">
            ${p.trust_score}/100 · ${trustLevelLabel(level)}
          </span>
          <span style="font-size:11px;color:#717171;">${p.rooms} ${p.rooms === 1 ? "room" : "rooms"}</span>
        </div>
        <div style="font-size:11px;color:#717171;margin-bottom:4px;">${distFromNaub} from NAUB</div>
        ${distFromUser ? `<div style="font-size:11px;color:#717171;margin-bottom:8px;">${distFromUser}</div>` : ""}
        <div style="display:flex;gap:8px;margin-top:8px;">
          <a
            href="/properties/${p.id}"
            style="flex:1;text-align:center;background:#FF5A5F;color:#fff;border-radius:8px;padding:7px 0;font-size:12px;font-weight:700;text-decoration:none;"
          >View Details</a>
          <a
            href="${buildDirectionsUrl({ lat: p.latitude, lng: p.longitude }, userLocation)}"
            target="_blank"
            rel="noopener noreferrer"
            style="flex:1;text-align:center;background:#F0F0F0;color:#111;border-radius:8px;padding:7px 0;font-size:12px;font-weight:700;text-decoration:none;"
          >Directions</a>
        </div>
      </div>
    </div>
  `;
}

// ── Component ──────────────────────────────────────────────────────────────
const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    properties,
    centre,
    zoom,
    userLocation,
    selectedId,
    onSelectProperty,
    onIdle,
    className = "",
  },
  ref
) {
  const { isLoaded, isError } = useGoogleMaps();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const idleListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // ── Initialise map ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current || mapRef.current) return;

    const gmap = new google.maps.Map(mapContainerRef.current, {
      center: centre ?? NAUB_COORDS,
      zoom: zoom ?? NAUB_DEFAULT_ZOOM,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        {
          featureType: "transit",
          elementType: "labels.icon",
          stylers: [{ visibility: "off" }],
        },
      ],
    });

    // NAUB campus marker (always visible)
    new google.maps.Marker({
      position: NAUB_COORDS,
      map: gmap,
      title: "Nigerian Army University Biu (NAUB)",
      icon: {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
            <rect x="4" y="4" width="32" height="32" rx="8" fill="#1E3A5F" stroke="white" stroke-width="2.5"/>
            <text x="20" y="26" font-size="16" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="700">N</text>
          </svg>`
        )}`,
        scaledSize: new google.maps.Size(40, 40),
        anchor: new google.maps.Point(20, 20),
      },
      zIndex: 1000,
    });

    infoWindowRef.current = new google.maps.InfoWindow({
      maxWidth: 280,
      pixelOffset: new google.maps.Size(0, -5),
    });

    mapRef.current = gmap;
    setMapReady(true);
  }, [isLoaded, centre, zoom]);

  // ── Expose handle to parent ──────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    panTo: (coords: MapCentre, z?: number) => {
      mapRef.current?.panTo(coords);
      if (z != null) mapRef.current?.setZoom(z);
    },
    getBounds: (): MapBounds | null => {
      const b = mapRef.current?.getBounds();
      if (!b) return null;
      return {
        north: b.getNorthEast().lat(),
        south: b.getSouthWest().lat(),
        east: b.getNorthEast().lng(),
        west: b.getSouthWest().lng(),
      };
    },
  }));

  // ── Idle → Search-this-area ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !onIdle) return;

    if (idleListenerRef.current) {
      google.maps.event.removeListener(idleListenerRef.current);
    }

    let debounce: ReturnType<typeof setTimeout>;
    idleListenerRef.current = mapRef.current.addListener("idle", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const m = mapRef.current!;
        const c = m.getCenter()!;
        const b = m.getBounds()!;
        onIdle(
          { lat: c.lat(), lng: c.lng() },
          {
            north: b.getNorthEast().lat(),
            south: b.getSouthWest().lat(),
            east: b.getNorthEast().lng(),
            west: b.getSouthWest().lng(),
          }
        );
      }, 600);
    });

    return () => {
      if (idleListenerRef.current) {
        google.maps.event.removeListener(idleListenerRef.current);
      }
    };
  }, [mapReady, onIdle]);

  // ── Pan to new centre when prop changes ──────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !centre) return;
    mapRef.current.panTo(centre);
    if (zoom != null) mapRef.current.setZoom(zoom);
  }, [centre, zoom]);

  // ── User location marker ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    userMarkerRef.current?.setMap(null);
    userMarkerRef.current = null;

    if (!userLocation) return;

    const icon = buildUserLocationIcon();
    userMarkerRef.current = new google.maps.Marker({
      position: userLocation,
      map: mapRef.current,
      title: "Your location",
      icon: {
        url: icon.url,
        scaledSize: new google.maps.Size(icon.scaledSize.width, icon.scaledSize.height),
        anchor: new google.maps.Point(12, 12),
      },
      zIndex: 999,
    });
  }, [mapReady, userLocation]);

  // ── Property markers ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const currentIds = new Set(properties.map((p) => p.id));

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });

    // Add / update markers
    properties.forEach((p) => {
      const colour = markerColourForProperty(
        p.trust_score,
        p.rent_amount_ngn,
        p.landlord?.verification_status ?? null
      );
      const iconSpec = buildMarkerIcon(colour, selectedId === p.id ? 44 : 36);
      const icon = {
        url: iconSpec.url,
        scaledSize: new google.maps.Size(iconSpec.scaledSize.width, iconSpec.scaledSize.height),
        anchor: new google.maps.Point(iconSpec.scaledSize.width / 2, iconSpec.scaledSize.height / 2),
      };

      const existing = markersRef.current.get(p.id);
      if (existing) {
        existing.setIcon(icon);
        return;
      }

      const marker = new google.maps.Marker({
        position: { lat: p.latitude, lng: p.longitude },
        map: mapRef.current!,
        title: p.address,
        icon,
        zIndex: p.id === selectedId ? 500 : 100,
      });

      marker.addListener("click", () => {
        onSelectProperty?.(p.id);
        infoWindowRef.current?.setContent(
          buildInfoWindowContent(p, userLocation)
        );
        infoWindowRef.current?.open({
          anchor: marker,
          map: mapRef.current!,
          shouldFocus: false,
        });
      });

      markersRef.current.set(p.id, marker);
    });
  }, [mapReady, properties, selectedId, onSelectProperty, userLocation]);

  // ── Highlight selected marker ────────────────────────────────────────────
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const p = properties.find((pr) => pr.id === id);
      if (!p) return;
      const colour = markerColourForProperty(
        p.trust_score,
        p.rent_amount_ngn,
        p.landlord?.verification_status ?? null
      );
      const isSelected = id === selectedId;
      const iconSpec = buildMarkerIcon(colour, isSelected ? 44 : 36);
      marker.setIcon({
        url: iconSpec.url,
        scaledSize: new google.maps.Size(iconSpec.scaledSize.width, iconSpec.scaledSize.height),
        anchor: new google.maps.Point(iconSpec.scaledSize.width / 2, iconSpec.scaledSize.height / 2),
      });
      marker.setZIndex(isSelected ? 500 : 100);
    });
  }, [selectedId, properties]);

  // ── Close info-window when selection cleared ─────────────────────────────
  useEffect(() => {
    if (!selectedId) {
      infoWindowRef.current?.close();
    }
  }, [selectedId]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current.clear();
      userMarkerRef.current?.setMap(null);
      infoWindowRef.current?.close();
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl gap-3 ${className}`}
      >
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-semibold text-amber-800 text-center px-4">
          Google Maps failed to load.
        </p>
        <p className="text-xs text-amber-600 text-center px-6">
          Check that <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> is set and
          your API key has the Maps JavaScript API enabled.
        </p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Map canvas */}
      <div ref={mapContainerRef} className="w-full h-full rounded-2xl" />

      {/* Loading overlay */}
      {!isLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#F7F7F7] rounded-2xl gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white border border-[#EBEBEB] flex items-center justify-center shadow-sm">
            <MapPin className="h-6 w-6 text-primary" />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading map…
          </div>
        </div>
      )}
    </div>
  );
});

export default MapView;
