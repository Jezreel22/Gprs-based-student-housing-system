"use client";

/**
 * MapView
 *
 * Renders a Mapbox GL map centred on NAUB (or a provided centre), plots custom
 * property markers, and manages marker → popup → property-card synchronisation.
 *
 * Responsibilities:
 *  - Lazy-loads Mapbox GL (via useMapbox — client-only dynamic import)
 *  - Creates one mapboxgl.Marker per property
 *  - Opens a Popup with property details on marker/card selection
 *  - Emits `onIdle` (on moveend) so the parent can opt-in to "Search this area"
 *  - Exposes `selectedId` + `onSelectProperty` so cards/markers stay in sync
 *
 * This is a near 1:1 port of the previous Google Maps implementation — same
 * props, same imperative handle, same visual language — just on Mapbox GL.
 */

import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import type mapboxgl from "mapbox-gl";
import type { Feature, Polygon, FeatureCollection, LineString } from "geojson";
import { useMapbox } from "@/hooks/use-mapbox";
import {
  buildMarkerIcon,
  buildUserLocationIcon,
  buildNaubIcon,
  buildDirectionsUrl,
  formatDistance,
  formatNGN,
  markerColourForProperty,
  iconElement,
  applyIcon,
  accuracyCircleFeature,
} from "@/lib/maps/utils";
import { NAUB_COORDS, NAUB_DEFAULT_ZOOM, MARKER_COLOURS } from "@/lib/maps/constants";
import { trustLevelLabel, trustLevelForScore } from "@/lib/trust/levels";
import { TRUST_LEVEL_STYLES } from "@/components/trust-level-styles";
import type { MapBounds, MapCentre, NearbyProperty } from "@/lib/maps/types";
import { pickListingPhoto } from "@/lib/listing-photos";
import { Loader2, MapPin, AlertTriangle } from "lucide-react";

export interface MapViewHandle {
  /** Pan/zoom the map to a given coordinate */
  panTo: (coords: MapCentre, zoom?: number) => void;
  /** Smoothly fly to a coordinate — for deliberate destination moves (locate,
   *  search selection). Omits `essential` so reduced-motion users jump instead. */
  flyTo: (coords: MapCentre, zoom?: number) => void;
  /** Return current visible bounds */
  getBounds: () => MapBounds | null;
}

interface MapViewProps {
  properties: NearbyProperty[];
  centre?: MapCentre;
  zoom?: number;
  userLocation?: MapCentre | null;
  /** GPS accuracy of the user fix, in metres — renders the accuracy circle. */
  userAccuracy?: number | null;
  /**
   * Optional route polyline (GeoJSON LineString in [lng,lat] order).
   * Pass `null` to hide. Renders as a single line layer named `route-line`.
   */
  route?: LineString | null;
  /** Hex colour for the route line. Defaults to the brand red. */
  routeColour?: string;
  selectedId?: string | null;
  onSelectProperty?: (id: string | null) => void;
  onIdle?: (centre: MapCentre, bounds: MapBounds) => void;
  className?: string;
}

// ── Popup HTML builder ─────────────────────────────────────────────────────
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
          onerror="this.src='/listings/listing-1.jpeg'"
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

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

/** Placeholder data for the accuracy source until/unless a fix exists. */
const EMPTY_ACCURACY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

// ── Component ──────────────────────────────────────────────────────────────
const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  {
    properties,
    centre,
    zoom,
    userLocation,
    userAccuracy,
    route,
    routeColour,
    selectedId,
    onSelectProperty,
    onIdle,
    className = "",
  },
  ref
) {
  const { isLoaded, isError, mapboxgl } = useMapbox();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mbRef = useRef<typeof mapboxgl | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const naubMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // Accuracy data that arrived before the map style finished loading —
  // flushed by the "load" handler in the init effect.
  const pendingAccuracyDataRef = useRef<Feature<Polygon> | FeatureCollection | null>(null);
  // Route data that arrived before the map style finished loading.
  const pendingRouteRef = useRef<LineString | null>(null);
  // Last zoom prop we animated to. The prop is React state that never sees
  // wheel-zoom, so we must not reapply it on every centre change.
  const lastAppliedZoomRef = useRef<number | null>(null);
  // Set by the flyTo handle: a flyTo is always paired with a centre prop
  // update from the parent (both callers setCentre too), so the centre
  // effect must skip its competing easeTo exactly once.
  const suppressCentreAnimRef = useRef(false);

  // ── Initialise map (once) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !mapboxgl || !mapContainerRef.current || mapRef.current)
      return;

    mbRef.current = mapboxgl;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [
        (centre ?? NAUB_COORDS).lng,
        (centre ?? NAUB_COORDS).lat,
      ],
      zoom: zoom ?? NAUB_DEFAULT_ZOOM,
      attributionControl: true,
    });

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    // NAUB campus marker (always visible)
    const naubIcon = buildNaubIcon();
    naubMarkerRef.current = new mapboxgl.Marker({
      element: iconElement(naubIcon, { cursor: "default" }),
      anchor: "center",
    })
      .setLngLat([NAUB_COORDS.lng, NAUB_COORDS.lat])
      .addTo(map);

    // Shared popup for property details
    popupRef.current = new mapboxgl.Popup({
      offset: 34,
      maxWidth: "280px",
      closeButton: true,
    });
    popupRef.current.on("close", () => onSelectProperty?.(null));

    // Accuracy-circle source + layers. Unlike DOM markers, sources/layers
    // require the style to be loaded — create them once on "load". If the
    // data effect already ran with a fix (a cached geolocation resolving
    // mid-init), flush the buffered data. `map.remove()` on unmount disposes
    // the listener, source and layers, so no separate cleanup is needed.
    map.on("load", () => {
      map.addSource("user-accuracy", { type: "geojson", data: EMPTY_ACCURACY_FC });
      map.addLayer({
        id: "user-accuracy-fill",
        type: "fill",
        source: "user-accuracy",
        paint: { "fill-color": MARKER_COLOURS.user, "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "user-accuracy-line",
        type: "line",
        source: "user-accuracy",
        paint: {
          "line-color": MARKER_COLOURS.user,
          "line-opacity": 0.35,
          "line-width": 1.5,
        },
      });

      // Route polyline layer (Feature 5). Single source + single line layer;
      // data is swapped via setData on the route prop change.
      map.addSource("route-line", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route-line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": routeColour ?? "#FF5A5F",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });

      const pending = pendingAccuracyDataRef.current;
      if (pending) {
        (map.getSource("user-accuracy") as mapboxgl.GeoJSONSource).setData(pending);
        pendingAccuracyDataRef.current = null;
      }
      const pendingRoute = pendingRouteRef.current;
      if (pendingRoute) {
        (map.getSource("route-line") as mapboxgl.GeoJSONSource).setData({
          type: "Feature",
          geometry: pendingRoute,
          properties: {},
        });
        pendingRouteRef.current = null;
      }
    });

    mapRef.current = map;
    setMapReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, mapboxgl]);

  // ── Expose handle to parent ──────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    panTo: (coords: MapCentre, z?: number) => {
      const map = mapRef.current;
      if (!map) return;
      map.easeTo({
        center: [coords.lng, coords.lat],
        zoom: z ?? map.getZoom(),
        duration: 600,
      });
    },
    flyTo: (coords: MapCentre, z?: number) => {
      const map = mapRef.current;
      if (!map) return;
      suppressCentreAnimRef.current = true;
      map.flyTo({
        center: [coords.lng, coords.lat],
        zoom: z ?? map.getZoom(),
        duration: 1000,
      });
    },
    getBounds: (): MapBounds | null => {
      const b = mapRef.current?.getBounds();
      if (!b) return null;
      return {
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      } satisfies MapBounds;
    },
  }));

  // ── moveend → Search-this-area ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !onIdle) return;

    let debounce: ReturnType<typeof setTimeout>;
    const handler = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const c = map.getCenter();
        const b = map.getBounds();
        if (!c || !b) return;
        onIdle(
          { lat: c.lat, lng: c.lng },
          {
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          }
        );
      }, 600);
    };

    map.on("moveend", handler);
    return () => {
      clearTimeout(debounce);
      map.off("moveend", handler);
    };
  }, [mapReady, onIdle]);

  // ── Click empty map → deselect ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const handler = () => onSelectProperty?.(null);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [mapReady, onSelectProperty]);

  // ── Pan to new centre when prop changes ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !centre) return;
    // Track zoom-prop changes regardless of how we animate.
    const zoomChanged = lastAppliedZoomRef.current !== zoom;
    lastAppliedZoomRef.current = zoom ?? null;
    // A flyTo just started for this same destination — don't fight it.
    if (suppressCentreAnimRef.current) {
      suppressCentreAnimRef.current = false;
      return;
    }
    // Animate the zoom only when the zoom PROP changed. It's React state that
    // never sees wheel-zoom, so reapplying it on every centre change would snap
    // the user's manual zoom back to the stale state value.
    map.easeTo({
      center: [centre.lng, centre.lat],
      zoom: zoomChanged ? (zoom ?? map.getZoom()) : map.getZoom(),
      duration: 600,
    });
  }, [mapReady, centre, zoom]);

  // ── User location marker ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mb = mbRef.current;
    if (!mapReady || !map || !mb) return;

    userMarkerRef.current?.remove();
    userMarkerRef.current = null;

    if (!userLocation) return;

    userMarkerRef.current = new mb.Marker({
      element: iconElement(buildUserLocationIcon(), { cursor: "default" }),
      anchor: "center",
    })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map);
  }, [mapReady, userLocation]);

  // ── Accuracy circle data ─────────────────────────────────────────────────
  // Only mutates the source (created once on "load" in the init effect). If
  // the style hasn't loaded yet, buffer the data — the load handler flushes
  // it. Empty FeatureCollection hides the circle when there's no fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const data =
      userLocation && userAccuracy != null
        ? accuracyCircleFeature(userLocation.lat, userLocation.lng, userAccuracy)
        : EMPTY_ACCURACY_FC;
    const source = map.getSource("user-accuracy") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      pendingAccuracyDataRef.current = data;
    }
  }, [mapReady, userLocation, userAccuracy]);

  // ── Route polyline data ──────────────────────────────────────────────────
  // Mirrors the accuracy-circle pattern. Empty/FeatureCollection hides the
  // line. The line is set as a single Feature wrapping the LineString, which
  // is what Mapbox's GeoJSONSource expects for a single-geometry line layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const data = route
      ? { type: "Feature" as const, geometry: route, properties: {} }
      : { type: "FeatureCollection" as const, features: [] };
    const source = map.getSource("route-line") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else if (route) {
      pendingRouteRef.current = route;
    }
  }, [mapReady, route]);

  // ── Route paint (colour) sync ────────────────────────────────────────────
  // The load handler captured the initial `routeColour`; this keeps the
  // layer paint in sync if the parent ever changes the prop.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !routeColour) return;
    if (!map.getLayer("route-line")) return;
    map.setPaintProperty("route-line", "line-color", routeColour);
  }, [mapReady, routeColour]);

  // ── Property markers (add / remove) ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mb = mbRef.current;
    if (!mapReady || !map || !mb) return;

    const currentIds = new Set(properties.map((p) => p.id));

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add new markers
    properties.forEach((p) => {
      if (markersRef.current.has(p.id)) return;

      const colour = markerColourForProperty(
        p.trust_score,
        p.rent_amount_ngn,
        p.landlord?.verification_status ?? null
      );
      const isSelected = p.id === selectedId;
      const el = iconElement(buildMarkerIcon(colour, isSelected ? 44 : 36));

      const marker = new mb.Marker({ element: el, anchor: "bottom" })
        .setLngLat([p.longitude, p.latitude])
        .addTo(map);

      // Marker clicks must not bubble to the map's deselect handler.
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectProperty?.(p.id);
      });

      const node = marker.getElement();
      node.style.zIndex = isSelected ? "500" : "100";

      markersRef.current.set(p.id, marker);
    });
  }, [mapReady, properties, selectedId, onSelectProperty, mapboxgl]);

  // ── Highlight selected marker + open/close popup ──────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    markersRef.current.forEach((marker, id) => {
      const p = properties.find((pr) => pr.id === id);
      if (!p) return;
      const colour = markerColourForProperty(
        p.trust_score,
        p.rent_amount_ngn,
        p.landlord?.verification_status ?? null
      );
      const isSelected = id === selectedId;
      // Re-style the existing element in place (mapbox-gl v3 has no setElement).
      applyIcon(marker.getElement(), buildMarkerIcon(colour, isSelected ? 44 : 36), isSelected ? 44 : 36);
      marker.getElement().style.zIndex = isSelected ? "500" : "100";
    });

    // Popup follows the selection so card-clicks and marker-clicks behave alike.
    if (selectedId) {
      const p = properties.find((pr) => pr.id === selectedId);
      if (p && popupRef.current) {
        popupRef.current
          .setLngLat([p.longitude, p.latitude])
          .setHTML(buildInfoWindowContent(p, userLocation))
          .addTo(map);
      }
    } else {
      popupRef.current?.remove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, properties, userLocation, mapReady]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      userMarkerRef.current?.remove();
      naubMarkerRef.current?.remove();
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
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
          Map failed to load.
        </p>
        <p className="text-xs text-amber-600 text-center px-6">
          Check that <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> is set to a valid
          Mapbox public access token.
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
