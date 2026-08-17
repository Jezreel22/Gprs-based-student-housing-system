"use client";

/**
 * LocationSearch
 *
 * Debounced address search bound to Borno State (NAUB's operating area).
 *
 * Uses Mapbox's forward geocoding API (good coverage for Nigeria) when a
 * NEXT_PUBLIC_MAPBOX_TOKEN is available, and transparently falls back to the
 * app's own /api/geocode route (Nominatim, no key) otherwise — so the search
 * box keeps working even before a token is configured.
 *
 * Both providers receive `proximity=NAUB` and a `bbox` clamp to Borno State
 * so population-prominence ranking doesn't surface Lagos / Abuja / Port
 * Harcourt ahead of Biu. Without this clamp, a generic query like "shop"
 * returns Lagos results first.
 *
 * Calls onSelect with the chosen place's `{ lat, lng }` and label.
 */

import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import type { MapCentre } from "@/lib/maps/types";
import { NAUB_COORDS, BORNO_BBOX } from "@/lib/maps/constants";

interface MapboxFeature {
  center: [number, number]; // [lng, lat]
  place_name: string;
}

interface LocationSearchProps {
  onSelect: (coords: MapCentre, label: string) => void;
  placeholder?: string;
  className?: string;
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const COUNTRY = "ng";
// Mapbox `bbox` is west,south,east,north in lng,lat order.
const MAPBOX_BBOX = `${BORNO_BBOX.west},${BORNO_BBOX.south},${BORNO_BBOX.east},${BORNO_BBOX.north}`;
// Mapbox `proximity` is `lng,lat`. Pulls results toward NAUB even when the
// query is ambiguous.
const MAPBOX_PROXIMITY = `${NAUB_COORDS.lng},${NAUB_COORDS.lat}`;

export default function LocationSearch({
  onSelect,
  placeholder = "Search Biu, Maiduguri, or any address…",
  className = "",
}: LocationSearchProps) {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced search whenever the query changes.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 3) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let features: MapboxFeature[] = [];

        if (TOKEN) {
          const url =
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
              q
            )}.json` +
            `?access_token=${TOKEN}` +
            `&country=${COUNTRY}` +
            // Bias + clamp to Borno State so prominence ranking doesn't
            // surface Lagos/Abuja for queries like "shop" or "market".
            `&proximity=${MAPBOX_PROXIMITY}` +
            `&bbox=${MAPBOX_BBOX}` +
            `&limit=6` +
            `&autocomplete=true`;
          const res = await fetch(url, { signal: controller.signal });
          if (res.ok) {
            const body = await res.json();
            features = body.features ?? [];
          }
        }

        // Fallback (or no-token path): use the app's Nominatim-backed route.
        if (features.length === 0) {
          const res = await fetch(`/api/geocode?address=${encodeURIComponent(q)}`, {
            signal: controller.signal,
          });
          if (res.ok) {
            const body = await res.json();
            features = (body.results ?? []).map(
              (r: { lat: number; lng: number; formatted_address: string }) => ({
                center: [r.lng, r.lat] as [number, number],
                place_name: r.formatted_address,
              })
            );
          }
        }

        setResults(features);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [value]);

  const choose = (f: MapboxFeature) => {
    const label = f.place_name;
    setValue(label);
    setResults([]);
    setOpen(false);
    onSelect({ lat: f.center[1], lng: f.center[0] }, label);
  };

  const clear = () => {
    setValue("");
    setResults([]);
    inputRef.current?.focus();
  };

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      ref={boxRef}
      className={`relative flex items-center bg-white border rounded-xl shadow-sm transition-shadow ${
        isFocused
          ? "border-primary ring-2 ring-primary/20 shadow-md"
          : "border-[#EBEBEB]"
      } ${className}`}
    >
      {isLoading ? (
        <Loader2 className="absolute left-3 h-4 w-4 text-muted-foreground animate-spin" />
      ) : (
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
      )}

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full pl-9 pr-8 py-2.5 text-sm bg-transparent border-0 outline-none placeholder:text-muted-foreground"
        id="map-location-search"
        autoComplete="off"
      />

      {value && (
        <button
          onClick={clear}
          className="absolute right-2.5 p-0.5 rounded-full hover:bg-gray-100 text-muted-foreground transition-colors"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <ul className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-[#EBEBEB] rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.map((f, i) => (
            <li key={`${f.place_name}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus/input before click
                  choose(f);
                }}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-start gap-2"
              >
                <Search className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="line-clamp-2 text-foreground">{f.place_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
