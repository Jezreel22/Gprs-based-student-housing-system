"use client";

/**
 * RouteCard — detail-page card for Feature 5 (route navigation).
 *
 * Visual shell mirrors the existing Distances card on /properties/[id]:
 *   bg-white rounded-2xl p-6 border border-[#EBEBEB]
 *
 * Renders nothing when `directions === null` (graceful empty), matching the
 * NearbyAmenitiesCard / Distances pattern. The "View route details" link
 * uses the existing `buildDirectionsUrl` helper so users can deep-link into
 * Google Maps for a more detailed route without us having to re-render the
 * Mapbox panel ourselves.
 */

import { useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  CornerDownRight,
  Footprints,
  Car,
  ExternalLink,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { buildDirectionsUrl } from "@/lib/maps/utils";
import { formatDuration, type TravelProfile } from "@/lib/maps/travel";
import { formatDistance } from "@/lib/maps/utils";
import type { DirectionsResponse, RouteStep } from "@/lib/maps/directions";
import type { GeolocationErrorCode } from "@/hooks/use-geolocation";

interface RouteCardProps {
  /** Resolved directions from `useDirections`, or null while loading / empty. */
  directions: DirectionsResponse | null;
  /** Property coords (the destination). Used for the "Open in Google Maps" link. */
  property: { lat: number; lng: number };
  /** Origin coords (user location or NAUB). */
  origin: { lat: number; lng: number };
  /** Whether the user has a live GPS fix. Hides "From your location" when false. */
  hasUserLocation: boolean;
  /** Loading skeleton flag. */
  isLoading: boolean;
  /** Controlled profile (so the toggle in the parent stays in sync). */
  profile: TravelProfile;
  onProfileChange: (p: TravelProfile) => void;
  /**
   * Called when the user taps "Use my location" (only shown when there's no
   * GPS fix yet). Wires to the page's `useGeolocation().requestLocation`.
   * Omitting it hides the button entirely.
   */
  onUseMyLocation?: () => void;
  /** True while the browser is acquiring a fix — shows a spinner on the button. */
  isLocating?: boolean;
  /** Last geolocation error, surfaced as a short inline hint. */
  locationError?: GeolocationErrorCode | null;
}

const STEPS_DEFAULT = 12;

/** Short inline hints for geolocation failures, keyed by the typed error code. */
const LOCATION_ERROR_HINT: Record<GeolocationErrorCode, string> = {
  permission_denied: "Location permission denied — enable it in your browser.",
  position_unavailable: "Couldn't get a location fix right now.",
  timeout: "Getting your location timed out — try again.",
  unsupported: "Location isn't supported on this device.",
  insecure_context: "Location needs HTTPS on this device.",
};

export default function RouteCard({
  directions,
  property,
  origin,
  hasUserLocation,
  isLoading,
  profile,
  onProfileChange,
  onUseMyLocation,
  isLocating = false,
  locationError = null,
}: RouteCardProps) {
  const [showAll, setShowAll] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(true);

  if (isLoading) {
    return (
      <section className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#FFF0F0] flex items-center justify-center">
            <Route className="h-4 w-4 text-primary" />
          </div>
          <h2 className="text-base font-bold text-foreground">Route</h2>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      </section>
    );
  }

  if (!directions) return null;

  const isEstimate = directions.source === "estimate";
  const stepList = showAll ? directions.steps : directions.steps.slice(0, STEPS_DEFAULT);
  const hiddenCount = Math.max(0, directions.steps.length - STEPS_DEFAULT);

  return (
    <section className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#FFF0F0] flex items-center justify-center">
            <Route className="h-4 w-4 text-primary" />
          </div>
          <h2 className="text-base font-bold text-foreground">Route</h2>
          {isEstimate && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              est.
            </span>
          )}
        </div>

        {/* Profile toggle */}
        <div className="inline-flex rounded-lg border border-[#EBEBEB] bg-[#F7F7F7] p-0.5">
          <ProfileChip
            label="Walk"
            icon={<Footprints className="h-3.5 w-3.5" />}
            active={profile === "walking"}
            onClick={() => onProfileChange("walking")}
          />
          <ProfileChip
            label="Drive"
            icon={<Car className="h-3.5 w-3.5" />}
            active={profile === "driving"}
            onClick={() => onProfileChange("driving")}
          />
        </div>
      </div>

      {/* Origin + summary */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Navigation className="h-3.5 w-3.5 text-[#2563EB]" />
          {hasUserLocation ? "From your location" : "From NAUB"}
        </span>
        <span className="text-muted-foreground/40">→</span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-primary" />
          This property
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl border border-[#EBEBEB] bg-[#FAFAFA] p-3">
          <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
            Distance
          </p>
          <p className="text-base font-bold text-foreground">
            {formatDistance(directions.distance_km)}
          </p>
        </div>
        <div className="rounded-xl border border-[#EBEBEB] bg-[#FAFAFA] p-3">
          <p className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
            ETA
          </p>
          <p className="text-base font-bold text-foreground">
            {formatDuration(directions.duration_min)}
          </p>
        </div>
      </div>

      {/* Open in Google Maps */}
      <a
        href={buildDirectionsUrl(property, origin)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mb-4"
      >
        Open in Google Maps <ExternalLink className="h-3.5 w-3.5" />
      </a>

      {/* Steps panel */}
      {directions.steps.length > 0 && (
        <Collapsible open={stepsOpen} onOpenChange={setStepsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-foreground hover:bg-[#F7F7F7] rounded-lg"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Turn-by-turn ({directions.steps.length})
              </span>
              {stepsOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 space-y-2.5">
              {stepList.map((step, i) => (
                <StepRow key={i} step={step} />
              ))}
            </ol>
            {hiddenCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll((v) => !v)}
                className="w-full mt-2 text-xs text-primary hover:bg-[#FFF0F0]"
              >
                {showAll ? "Show less" : `Show ${hiddenCount} more step${hiddenCount === 1 ? "" : "s"}`}
              </Button>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {directions.steps.length === 0 && !isEstimate && (
        <p className="text-xs text-muted-foreground">
          Detailed turns are unavailable for this route.
        </p>
      )}
    </section>
  );
}

// ── Local primitives ──────────────────────────────────────────────────────

function ProfileChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-white text-foreground shadow-sm border border-[#EBEBEB]"
          : "text-muted-foreground hover:text-foreground"
      }`}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

function StepRow({ step }: { step: RouteStep }) {
  return (
    <li className="flex items-start gap-2.5">
      <div className="mt-0.5 w-6 h-6 rounded-full bg-[#FFF0F0] flex items-center justify-center shrink-0">
        <StepIcon modifier={step.modifier} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">{step.instruction}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatStepDistance(step.distance_m)}
        </p>
      </div>
    </li>
  );
}

function StepIcon({ modifier }: { modifier?: string }) {
  const className = "h-3.5 w-3.5 text-primary";
  switch (modifier) {
    case "left":
      return <ArrowLeft className={className} />;
    case "right":
      return <ArrowRight className={className} />;
    case "sharp left":
      return <CornerDownLeft className={className} />;
    case "sharp right":
      return <CornerDownRight className={className} />;
    case "uturn":
      return <ArrowDown className={className} />;
    default:
      return <ArrowUp className={className} />;
  }
}

function formatStepDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
