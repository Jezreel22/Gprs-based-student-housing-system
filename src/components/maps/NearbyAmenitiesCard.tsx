"use client";

/**
 * NearbyAmenitiesCard — the "What's nearby" section on the property detail
 * page. Reads the result of `useNearbyAmenities(propertyId)` and renders one
 * row per non-empty category (icon swatch + label + count + nearest distance
 * + Google Maps directions link). Loading renders a quiet skeleton inside the
 * same card frame; the empty path renders nothing.
 *
 * Visual idiom mirrors the property's own "Amenities" card
 * (page.tsx:400–419): `bg-white rounded-2xl p-6 border border-[#EBEBEB]`,
 * `w-8 h-8 rounded-lg` swatch with `#FFF0F0` background + `text-primary` icon.
 *
 * Icons are mapped here (client-side) rather than in `amenities.ts` so the
 * pure module stays free of `lucide-react`.
 */

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useNearbyAmenities } from "@/hooks/use-nearby-amenities";
import {
  AMENITY_CATEGORIES,
  formatAmenityDistance,
  type NearbyAmenity,
} from "@/lib/maps/amenities";
import { buildDirectionsUrl } from "@/lib/maps/utils";
import {
  ShoppingCart,
  Store,
  Utensils,
  Coffee,
  GraduationCap,
  Hospital,
  Plus,
  Bus,
  Landmark,
  Fuel,
  ExternalLink,
} from "lucide-react";

const ICON_FOR_KEY: Record<string, React.ElementType> = {
  groceries: ShoppingCart,
  shops: Store,
  restaurants: Utensils,
  cafes: Coffee,
  schools: GraduationCap,
  health: Hospital,
  pharmacy: Plus,
  transit: Bus,
  bank: Landmark,
  fuel: Fuel,
};

function Row({ category, places }: { category: string; places: NearbyAmenity[] }) {
  const meta = AMENITY_CATEGORIES.find((c) => c.key === category);
  if (!meta) return null;
  const Icon = ICON_FOR_KEY[category] ?? Store;
  const nearest = places[0];
  const rest = places.length - 1;
  return (
    <div className="flex items-center gap-3 p-3 bg-[#FAFAFA] rounded-xl border border-[#EBEBEB]">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "#FFF0F0" }}
      >
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{meta.label}</span>
          <span className="text-xs text-muted-foreground">
            {rest > 0 ? `${places.length} nearby` : "Nearby"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">{nearest.name}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          {formatAmenityDistance(nearest.distanceMeters)}
        </span>
        <Link
          href={buildDirectionsUrl({ lat: nearest.lat, lng: nearest.lng })}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
          aria-label={`Directions to ${nearest.name}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
      <h2 className="text-base font-bold text-foreground mb-4">What's nearby</h2>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function NearbyAmenitiesCard({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useNearbyAmenities(propertyId);

  if (isLoading && !data) return <LoadingCard />;
  if (!data || data.source === "empty") return null;

  // Order rows by the `AMENITY_CATEGORIES` declaration order so the card
  // layout is stable across renders.
  const ordered = AMENITY_CATEGORIES
    .map((c) => data.categories[c.key])
    .filter((arr): arr is NearbyAmenity[] => Array.isArray(arr) && arr.length > 0);
  if (ordered.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-base font-bold text-foreground">What's nearby</h2>
        <span className="text-xs text-muted-foreground">From Mapbox</span>
      </div>
      <div className="space-y-3">
        {ordered.map((places) => (
          <Row key={places[0].category} category={places[0].category} places={places} />
        ))}
      </div>
    </div>
  );
}
