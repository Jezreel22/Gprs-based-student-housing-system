"use client";

/**
 * LocationSearch
 *
 * Google Places Autocomplete input bound to Nigerian locations.
 * Calls onSelect with the chosen place's coordinates.
 */

import { useEffect, useRef, useState } from "react";
import { useGoogleMaps } from "@/hooks/use-google-maps";
import { Search, X, Loader2 } from "lucide-react";
import type { MapCentre } from "@/lib/maps/types";

interface LocationSearchProps {
  onSelect: (coords: MapCentre, label: string) => void;
  placeholder?: string;
  className?: string;
}

export default function LocationSearch({
  onSelect,
  placeholder = "Search Biu, Maiduguri, or any address…",
  className = "",
}: LocationSearchProps) {
  const { isLoaded } = useGoogleMaps();
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isLoaded || !inputRef.current || autocompleteRef.current) return;

    const ac = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "ng" },
      fields: ["geometry", "formatted_address", "name"],
      types: ["geocode", "establishment"],
    });

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place.geometry?.location) return;
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const label = place.formatted_address ?? place.name ?? "";
      setValue(label);
      onSelect({ lat, lng }, label);
    });

    autocompleteRef.current = ac;
  }, [isLoaded, onSelect]);

  const clear = () => {
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <div
      className={`relative flex items-center bg-white border rounded-xl shadow-sm transition-shadow ${
        isFocused
          ? "border-primary ring-2 ring-primary/20 shadow-md"
          : "border-[#EBEBEB]"
      } ${className}`}
    >
      {!isLoaded ? (
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
        placeholder={placeholder}
        disabled={!isLoaded}
        className="w-full pl-9 pr-8 py-2.5 text-sm bg-transparent border-0 outline-none placeholder:text-muted-foreground disabled:opacity-50"
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
    </div>
  );
}
