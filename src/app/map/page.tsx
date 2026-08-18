"use client";

/**
 * /map page — full Mapbox GL + nearby properties experience.
 *
 * Layout:
 *  Desktop: [Filters sidebar | Map (flex-1) | Property list panel]
 *  Mobile:  Map on top, property list below
 *
 * Features implemented:
 *  ✓ Centres on NAUB by default
 *  ✓ "Use My Location" button
 *  ✓ Address autocomplete search (Mapbox Geocoding, /api/geocode fallback)
 *  ✓ Custom markers (verified/premium/standard)
 *  ✓ Marker ↔ card selection sync
 *  ✓ Info-window with property details
 *  ✓ "Search this area" on map drag/zoom
 *  ✓ Radius, rent, rooms, trust, verified filters
 *  ✓ Distance from NAUB + distance from user shown on every card
 *  ✓ "Get Directions" on every card and info-window
 *  ✓ Graceful error states for Map API / Geolocation failures
 */

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import NavBar from "@/components/NavBar";
import LocationSearch from "@/components/maps/LocationSearch";
import MapFiltersPanel from "@/components/maps/MapFiltersPanel";
import NearbyPropertyCard from "@/components/maps/NearbyPropertyCard";
import RouteOverlay from "@/components/maps/RouteOverlay";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useDirections } from "@/hooks/use-directions";
import { useNearbyProperties } from "@/hooks/use-nearby-properties";
import type { TravelProfile } from "@/lib/maps/travel";
import { NAUB_COORDS, NAUB_DEFAULT_ZOOM } from "@/lib/maps/constants";
import { formatAccuracy } from "@/lib/maps/utils";
import type {
  MapBounds,
  MapCentre,
  MapFilters,
} from "@/lib/maps/types";
import MapView, { MapViewHandle } from "@/components/maps/MapView";
import { Button } from "@/components/ui/button";
import {
  Navigation,
  SlidersHorizontal,
  X,
  Search,
  Loader2,
  RotateCw,
  MapPinOff,
} from "lucide-react";

// MapView is imported directly above — the mapbox-gl runtime itself is
// lazy-loaded inside it (useMapbox), so the page bundle stays lean.
const DEFAULT_FILTERS: MapFilters = {
  radius_km: 5,
  rent_min: undefined,
  rent_max: undefined,
  rooms: undefined,
  trust_score_min: undefined,
  verified_only: false,
};

// ── Geolocation error messages ─────────────────────────────────────────────
// Timeout is the most common failure mode on mobile (no GPS lock indoors or
// with GPS disabled). These messages are actionable so the user knows the
// fallback is to search for an address instead.
const GEO_ERROR_MESSAGES: Record<string, string> = {
  permission_denied:
    "Location access was denied. Check your browser or phone settings to allow location access, then try again.",
  position_unavailable:
    "Couldn't find your location — make sure location services are turned on in your phone settings, then try again.",
  timeout:
    "Taking too long to find you — try again outdoors or near a window, or search for an address instead.",
  unsupported:
    "Your browser doesn't support location. Try searching for an address on the map.",
};

function MapPageInner() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [centre, setCentre] = useState<MapCentre>(NAUB_COORDS);
  const [mapZoom, setMapZoom] = useState(NAUB_DEFAULT_ZOOM);
  const [pendingBounds, setPendingBounds] = useState<MapBounds | null>(null);
  const [activeBounds, setActiveBounds] = useState<MapBounds | null>(null);
  const [showSearchArea, setShowSearchArea] = useState(false);
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchLabel, setSearchLabel] = useState("Near NAUB campus");
  const [routeProfile, setRouteProfile] = useState<TravelProfile>("driving");

  const mapRef = useRef<MapViewHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Geolocation ───────────────────────────────────────────────────────────
  const geo = useGeolocation();

  const handleUseMyLocation = useCallback(() => {
    geo.requestLocation();
  }, [geo]);

  // When a new fix resolves, re-centre on it. Identity compare (not lat/lng
  // values): each fix is a fresh state object, so a cached fix within the
  // 60s maximumAge with identical coordinates still re-centres — the old
  // value compare made a second click a no-op after the user panned away.
  const prevGeoCoords = useRef<typeof geo.coords>(null);
  useEffect(() => {
    if (!geo.coords || prevGeoCoords.current === geo.coords) return;
    prevGeoCoords.current = geo.coords;
    setCentre(geo.coords); // drives the nearby-properties query
    setMapZoom(15);
    setSearchLabel("Your location");
    setShowSearchArea(false);
    // Smooth flight; MapView suppresses its competing centre easeTo once.
    mapRef.current?.flyTo(geo.coords, 15);
  }, [geo.coords]);

  // ── Nearby properties ─────────────────────────────────────────────────────
  const { data, isLoading, isFetching, error } = useNearbyProperties({
    centre,
    filters,
    bounds: activeBounds ?? undefined,
  });

  const properties = data?.data ?? [];

  // ── Selected property + route overlay (Feature 5) ────────────────────────
  const selectedProperty = selectedId
    ? properties.find((p) => p.id === selectedId) ?? null
    : null;
  // Origin: user GPS when available, NAUB otherwise (matches the detail page
  // and the Distances card's reference convention).
  const routeOrigin: { lat: number; lng: number } = geo.coords ?? NAUB_COORDS;
  const routeDestination = selectedProperty
    ? { lat: selectedProperty.latitude, lng: selectedProperty.longitude }
    : null;
  // Only fetch when both endpoints exist; otherwise hook is disabled.
  const routeDirections = useDirections(
    routeDestination ? routeOrigin : null,
    routeDestination,
    routeProfile
  );
  const routeIsLoading = !!selectedProperty && routeDirections === null;

  // ── Map events ────────────────────────────────────────────────────────────
  const handleMapIdle = useCallback(
    (idleCentre: MapCentre, bounds: MapBounds) => {
      // Only show "Search this area" if the user actually moved the map
      // (not on the initial load).
      setPendingBounds(bounds);
      setShowSearchArea(true);
    },
    []
  );

  const searchThisArea = useCallback(() => {
    if (!pendingBounds) return;
    const bounds = mapRef.current?.getBounds() ?? pendingBounds;
    const newCentre = {
      lat: (bounds.north + bounds.south) / 2,
      lng: (bounds.east + bounds.west) / 2,
    };
    setCentre(newCentre);
    setActiveBounds(bounds);
    setShowSearchArea(false);
    setSearchLabel("This area");
  }, [pendingBounds]);

  // ── Location search ───────────────────────────────────────────────────────
  const handleLocationSelect = useCallback(
    (coords: MapCentre, label: string) => {
      setCentre(coords);
      setMapZoom(15);
      setSearchLabel(label);
      setActiveBounds(null);
      setShowSearchArea(false);
      mapRef.current?.flyTo(coords, 15);
    },
    []
  );

  // ── Card/marker selection ─────────────────────────────────────────────────
  const handleSelectProperty = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      // Scroll card into view in the side panel
      setTimeout(() => {
        panelRef.current
          ?.querySelector(`[data-property-id="${id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  }, []);

  const handleCardClick = useCallback(
    (id: string, lat: number, lng: number) => {
      setSelectedId(id);
      mapRef.current?.panTo({ lat, lng });
    },
    []
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F7F7F7] flex flex-col">
      <NavBar />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#EBEBEB] px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 z-20">
        {/* Title */}
        <div className="shrink-0">
          <h1 className="text-base font-bold text-foreground leading-tight">
            Find Accommodation
          </h1>
          <p className="text-xs text-muted-foreground">{searchLabel}</p>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search */}
        <div className="w-full sm:w-72">
          <Suspense>
            <LocationSearch
              onSelect={handleLocationSelect}
              className="w-full"
            />
          </Suspense>
        </div>

        {/* Use my location */}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={handleUseMyLocation}
          disabled={geo.isLoading}
          id="use-my-location-btn"
        >
          {geo.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {geo.isLoading ? "Locating…" : "Use my location"}
          </span>
        </Button>

        {/* Filter toggle (mobile) */}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0 sm:hidden"
          onClick={() => setFiltersOpen(!filtersOpen)}
          id="map-filters-toggle"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filters
        </Button>
      </div>

      {/* Geolocation / API error banner */}
      {(geo.error || error) && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-800">
          <span>
            {geo.error
              ? GEO_ERROR_MESSAGES[geo.error]
              : "Failed to load nearby properties."}
          </span>
          {geo.error && (
            <div className="flex items-center gap-3">
              {/* Retry is only offered when it could actually succeed —
                  re-requesting after a hard denial or on an unsupported
                  browser would just fail again. */}
              {(geo.error === "position_unavailable" || geo.error === "timeout") && (
                <button
                  onClick={geo.requestLocation}
                  className="font-semibold underline underline-offset-2 hover:text-amber-900"
                >
                  Try again
                </button>
              )}
              <button onClick={geo.clearError} aria-label="Dismiss error">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Filters sidebar (desktop) ────────────────────────────────── */}
        <aside
          className={`hidden lg:flex flex-col w-64 shrink-0 border-r border-[#EBEBEB] bg-white overflow-y-auto p-4 z-10`}
        >
          <MapFiltersPanel
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setShowSearchArea(false);
            }}
            propertyCount={properties.length}
          />
        </aside>

        {/* ── Map + panel wrapper ──────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
          {/* ── Map ────────────────────────────────────────────────────── */}
          <div className="relative flex-1 min-h-[55vw] lg:min-h-0">
            <MapView
              ref={mapRef}
              properties={properties}
              centre={centre}
              zoom={mapZoom}
              userLocation={geo.coords}
              userAccuracy={geo.coords?.accuracy}
              route={routeDirections?.geometry ?? null}
              selectedId={selectedId}
              onSelectProperty={handleSelectProperty}
              onIdle={handleMapIdle}
              className="w-full h-full"
            />

            {/* "Search this area" floating button */}
            {showSearchArea && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
                <button
                  onClick={searchThisArea}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold text-white shadow-lg transition-all hover:scale-105 active:scale-95"
                  style={{ background: "#FF5A5F" }}
                  id="search-this-area-btn"
                >
                  <Search className="h-4 w-4" />
                  Search this area
                </button>
              </div>
            )}

            {/* Properties loading indicator */}
            {isFetching && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-white border border-[#EBEBEB] rounded-full px-3 py-1.5 flex items-center gap-2 shadow text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                Updating…
              </div>
            )}

            {/* GPS accuracy chip — visible whenever a location fix exists */}
            {geo.coords && (
              <div
                className="absolute bottom-4 left-4 z-20 bg-white border border-[#EBEBEB] rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow text-xs"
                role="status"
                aria-label={`Location accuracy: ${formatAccuracy(geo.coords.accuracy)}`}
              >
                <Navigation className="h-3.5 w-3.5 text-[#2563EB]" />
                <span className="font-semibold text-foreground">
                  {formatAccuracy(geo.coords.accuracy)}
                </span>
                <span className="text-muted-foreground">accuracy</span>
              </div>
            )}
          </div>

          {/* ── Nearby property panel ────────────────────────────────────── */}
          <aside
            ref={panelRef}
            className="w-full lg:w-80 xl:w-96 bg-white border-t lg:border-t-0 lg:border-l border-[#EBEBEB] flex flex-col overflow-hidden"
          >
            {/* Panel header */}
            <div className="px-4 py-3 border-b border-[#EBEBEB] flex items-center justify-between shrink-0">
              <div>
                <p className="text-sm font-bold text-foreground">
                  {isLoading
                    ? "Loading…"
                    : `${data?.total ?? 0} ${(data?.total ?? 0) === 1 ? "property" : "properties"}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  within {filters.radius_km} km
                </p>
              </div>
              {selectedId && (
                <button
                  onClick={() => setSelectedId(null)}
                  className="p-1.5 rounded-full hover:bg-gray-100 text-muted-foreground transition-colors"
                  title="Deselect"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Property list */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex gap-3 p-3.5 rounded-xl border border-[#EBEBEB] animate-pulse"
                  >
                    <div className="w-20 h-20 rounded-lg bg-gray-100 shrink-0" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3 bg-gray-100 rounded w-3/4" />
                      <div className="h-3 bg-gray-100 rounded w-1/2" />
                      <div className="h-3 bg-gray-100 rounded w-2/3" />
                    </div>
                  </div>
                ))
              ) : properties.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#F7F7F7] border border-[#EBEBEB] flex items-center justify-center">
                    <MapPinOff className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    No properties found here
                  </p>
                  <p className="text-xs text-muted-foreground max-w-[200px]">
                    Try increasing the radius or clearing filters.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 mt-2"
                    onClick={() => {
                      setCentre(NAUB_COORDS);
                      setMapZoom(NAUB_DEFAULT_ZOOM);
                      setSearchLabel("Near NAUB campus");
                      setActiveBounds(null);
                      setShowSearchArea(false);
                    }}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Reset to NAUB
                  </Button>
                </div>
              ) : (
                properties.map((p) => (
                  <div key={p.id} data-property-id={p.id}>
                    <NearbyPropertyCard
                      property={p}
                      isSelected={selectedId === p.id}
                      userLocation={geo.coords}
                      onClick={() => handleCardClick(p.id, p.latitude, p.longitude)}
                    />
                  </div>
                ))
              )}
            </div>

            {/* Feature 5 — route overlay panel (visible only when a property
                is selected). Compact summary + link to the full RouteCard on
                the detail page. */}
            {selectedProperty && (
              <RouteOverlay
                directions={routeDirections}
                propertyId={selectedProperty.id}
                hasUserLocation={!!geo.coords}
                isLoading={routeIsLoading}
                profile={routeProfile}
              />
            )}

            {/* Mobile filters drawer */}
            {filtersOpen && (
              <div className="lg:hidden border-t border-[#EBEBEB] p-4 bg-white">
                <MapFiltersPanel
                  filters={filters}
                  onChange={(f) => {
                    setFilters(f);
                    setShowSearchArea(false);
                  }}
                  propertyCount={properties.length}
                />
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F7F7F7] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <MapPageInner />
    </Suspense>
  );
}
