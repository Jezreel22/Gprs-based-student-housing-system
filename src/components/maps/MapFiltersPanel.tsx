"use client";

/**
 * MapFiltersPanel
 *
 * Sidebar/sheet for filtering nearby properties. Integrates with existing
 * filter patterns from /properties/page.tsx — same controls, same styling.
 */

import { RADIUS_OPTIONS, type RadiusKm } from "@/lib/maps/constants";
import type { MapFilters } from "@/lib/maps/types";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, ShieldCheck } from "lucide-react";

interface MapFiltersPanelProps {
  filters: MapFilters;
  onChange: (filters: MapFilters) => void;
  propertyCount: number;
}

export default function MapFiltersPanel({
  filters,
  onChange,
  propertyCount,
}: MapFiltersPanelProps) {
  const set = (partial: Partial<MapFilters>) =>
    onChange({ ...filters, ...partial });

  const hasActiveFilters =
    (filters.rent_min ?? 0) > 0 ||
    (filters.rent_max ?? 200_000) < 200_000 ||
    filters.rooms != null ||
    (filters.trust_score_min ?? 0) > 0 ||
    filters.verified_only;

  const reset = () =>
    onChange({
      radius_km: filters.radius_km,
      rent_min: undefined,
      rent_max: undefined,
      rooms: undefined,
      trust_score_min: undefined,
      verified_only: false,
    });

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">
          Filters
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            {propertyCount} {propertyCount === 1 ? "property" : "properties"}
          </span>
        </h3>
        {hasActiveFilters && (
          <button
            onClick={reset}
            className="flex items-center gap-1 text-xs text-destructive hover:underline font-medium"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Search radius */}
      <div>
        <label className="text-xs font-semibold text-foreground mb-2 block">
          Search Radius
        </label>
        <div className="flex gap-2 flex-wrap">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => set({ radius_km: r })}
              className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
              style={{
                background:
                  filters.radius_km === r ? "#FF5A5F" : "#fff",
                color: filters.radius_km === r ? "#fff" : "#222",
                borderColor:
                  filters.radius_km === r ? "#FF5A5F" : "#EBEBEB",
              }}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>

      {/* Rent range */}
      <div>
        <label className="text-xs font-semibold text-foreground mb-2 block">
          Rent range:{" "}
          <span className="font-normal text-muted-foreground">
            ₦{(filters.rent_min ?? 0).toLocaleString("en-NG")} – ₦
            {(filters.rent_max ?? 200_000).toLocaleString("en-NG")}/yr
          </span>
        </label>
        <Slider
          min={0}
          max={200_000}
          step={5_000}
          value={[filters.rent_min ?? 0, filters.rent_max ?? 200_000]}
          onValueChange={([min, max]) =>
            set({
              rent_min: min > 0 ? min : undefined,
              rent_max: max < 200_000 ? max : undefined,
            })
          }
        />
      </div>

      {/* Rooms */}
      <div>
        <label className="text-xs font-semibold text-foreground mb-2 block">
          Rooms
        </label>
        <div className="flex gap-2 flex-wrap">
          {["Any", "1", "2", "3", "4+"].map((r) => {
            const val = r === "Any" ? undefined : parseInt(r);
            const active = filters.rooms === val;
            return (
              <button
                key={r}
                onClick={() => set({ rooms: val })}
                className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
                style={{
                  background: active ? "#FF5A5F" : "#fff",
                  color: active ? "#fff" : "#222",
                  borderColor: active ? "#FF5A5F" : "#EBEBEB",
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* Min trust score */}
      <div>
        <label className="text-xs font-semibold text-foreground mb-2 block">
          Min. Trust Score:{" "}
          <span className="font-normal text-muted-foreground">
            {(filters.trust_score_min ?? 0) > 0
              ? filters.trust_score_min
              : "Any"}
          </span>
        </label>
        <Slider
          min={0}
          max={100}
          step={10}
          value={[filters.trust_score_min ?? 0]}
          onValueChange={([v]) =>
            set({ trust_score_min: v > 0 ? v : undefined })
          }
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>Any</span>
          <span>50</span>
          <span>70</span>
          <span>90+</span>
        </div>
      </div>

      {/* Verified only */}
      <div>
        <button
          onClick={() => set({ verified_only: !filters.verified_only })}
          className={`w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
            filters.verified_only
              ? "bg-green-50 border-green-300 text-green-700"
              : "bg-white border-[#EBEBEB] text-foreground hover:border-green-300"
          }`}
        >
          <ShieldCheck
            className={`h-4 w-4 ${
              filters.verified_only ? "text-green-600" : "text-muted-foreground"
            }`}
          />
          Verified landlords only
        </button>
      </div>
    </div>
  );
}
