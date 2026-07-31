"use client";

/**
 * RouteOverlay — browse-map companion to RouteCard.
 *
 * Mounted in the property panel on /map (right-side drawer) only when a
 * property is selected. Renders a compact origin/profile/ETA summary plus
 * a "View route details →" link to the property's detail page (where the
 * full steps panel lives). This avoids duplicating the turn list in two
 * places while still letting browsing users see "how far, how long".
 */

import { Car, ExternalLink, Footprints, MapPin, Navigation, Route } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, type TravelProfile } from "@/lib/maps/travel";
import { formatDistance } from "@/lib/maps/utils";
import type { DirectionsResponse } from "@/lib/maps/directions";

interface RouteOverlayProps {
  directions: DirectionsResponse | null;
  propertyId: string;
  hasUserLocation: boolean;
  isLoading: boolean;
  profile: TravelProfile;
}

export default function RouteOverlay({
  directions,
  propertyId,
  hasUserLocation,
  isLoading,
  profile,
}: RouteOverlayProps) {
  if (isLoading) {
    return (
      <div className="border-t border-[#EBEBEB] p-3 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }

  if (!directions) return null;

  const isEstimate = directions.source === "estimate";
  const ProfileIcon = profile === "walking" ? Footprints : Car;

  return (
    <div className="border-t border-[#EBEBEB] p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Route className="h-3.5 w-3.5 text-primary" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Route to here
        </p>
        {isEstimate && (
          <span className="text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
            est.
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 text-xs text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-1">
          <Navigation className="h-3 w-3 text-[#2563EB]" />
          {hasUserLocation ? "Your location" : "NAUB"}
        </span>
        <span className="text-muted-foreground/40">→</span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3 text-primary" />
          This property
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
            Distance
          </p>
          <p className="text-sm font-bold text-foreground">
            {formatDistance(directions.distance_km)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
            ETA
          </p>
          <p className="text-sm font-bold text-foreground inline-flex items-center gap-1">
            <ProfileIcon className="h-3 w-3" />
            {formatDuration(directions.duration_min)}
          </p>
        </div>
      </div>

      <a
        href={`/properties/${propertyId}`}
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        View route details <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
