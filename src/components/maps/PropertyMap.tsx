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
 *
 * Feature 5 additions (all optional, backward-compatible):
 *  - Renders a route polyline layer when `route` is provided.
 *  - Exposes an imperative handle with `setRoute` / `fitToBounds` so the
 *    RouteCard can drive the polyline + camera.
 */

import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import type mapboxgl from "mapbox-gl";
import type { FeatureCollection, LineString } from "geojson";
import { useMapbox } from "@/hooks/use-mapbox";
import {
  buildDirectionsUrl,
  buildMarkerIcon,
  iconElement,
} from "@/lib/maps/utils";

export interface PropertyMapHandle {
  /** Replace the route polyline layer (pass null to hide it). */
  setRoute: (line: LineString | null) => void;
  /** Fit the map to a list of [lng,lat] points. */
  fitToBounds: (points: [number, number][], padding?: number) => void;
}

interface PropertyMapProps {
  lat: number;
  lng: number;
  /** Used for the marker colour (verified=green, premium=purple, default=red). */
  verified?: boolean;
  rentAmountNgn?: number | null;
  height?: number;
  className?: string;
  /** Optional route polyline (GeoJSON LineString in [lng,lat] order). */
  route?: LineString | null;
  /** Hex colour for the route line. Defaults to the brand red. */
  routeColour?: string;
}

const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";
const EMPTY_ROUTE_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

const PropertyMap = forwardRef<PropertyMapHandle, PropertyMapProps>(function PropertyMap(
  {
    lat,
    lng,
    verified = false,
    rentAmountNgn = null,
    height = 320,
    className = "",
    route = null,
    routeColour,
  },
  ref
) {
  const { isLoaded, isError, mapboxgl } = useMapbox();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  // Route data that arrived before the map style finished loading —
  // flushed by the "load" handler in the init effect.
  const pendingRouteRef = useRef<LineString | null>(null);

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

      // Route polyline layer (Feature 5). Source + layer created once on
      // "load"; data swapped via setData when the `route` prop changes.
      mapInstanceRef.current.on("load", () => {
        const map = mapInstanceRef.current;
        if (!map) return;
        map.addSource("route-line", { type: "geojson", data: EMPTY_ROUTE_FC });
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
        // Flush any route data that arrived before the style finished loading.
        const pending = pendingRouteRef.current;
        if (pending) {
          (map.getSource("route-line") as mapboxgl.GeoJSONSource).setData({
            type: "Feature",
            geometry: pending,
            properties: {},
          });
          pendingRouteRef.current = null;
        }
      });
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

  // Route data effect — mutates the source (created once on "load"). If the
  // style hasn't loaded yet, buffer the route into a ref; the load handler
  // flushes it. Mirrors the accuracy-circle pattern in MapView.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const data = route
      ? { type: "Feature" as const, geometry: route, properties: {} }
      : EMPTY_ROUTE_FC;
    const source = map.getSource("route-line") as
      | mapboxgl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(data);
    } else if (route) {
      pendingRouteRef.current = route;
    }
  }, [route]);

  // Keep layer paint in sync if the routeColour prop changes after init.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !routeColour) return;
    if (!map.getLayer("route-line")) return;
    map.setPaintProperty("route-line", "line-color", routeColour);
  }, [routeColour]);

  // Imperative handle so the parent (RouteCard) can drive the polyline +
  // camera fit.
  useImperativeHandle(ref, () => ({
    setRoute: (line: LineString | null) => {
      const map = mapInstanceRef.current;
      if (!map) return;
      const data = line
        ? { type: "Feature" as const, geometry: line, properties: {} }
        : EMPTY_ROUTE_FC;
      const source = map.getSource("route-line") as mapboxgl.GeoJSONSource | undefined;
      if (source) source.setData(data);
    },
    fitToBounds: (points: [number, number][], padding = 64) => {
      const map = mapInstanceRef.current;
      if (!map || points.length === 0) return;
      if (points.length === 1) {
        map.flyTo({ center: points[0], zoom: Math.max(map.getZoom(), 14) });
        return;
      }
      const bounds = points.reduce(
        (b, [lng, lat]) => {
          if (lng < b[0]) b[0] = lng;
          if (lat < b[1]) b[1] = lat;
          if (lng > b[2]) b[2] = lng;
          if (lat > b[3]) b[3] = lat;
          return b;
        },
        [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number]
      );
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding, duration: 700 }
      );
    },
  }));

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
});

export default PropertyMap;
