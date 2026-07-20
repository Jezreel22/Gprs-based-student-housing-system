"use client";

/**
 * NearbyPropertyCard
 *
 * Compact card used in the map side-panel. Highlights when its property is
 * selected (marker clicked). Clicking the card selects it and flies the map
 * to it.
 */

import Link from "next/link";
import { MapPin, Bed, ShieldCheck, ExternalLink, Navigation } from "lucide-react";
import TrustBadge from "@/components/TrustBadge";
import { formatDistance, formatNGN, buildDirectionsUrl } from "@/lib/maps/utils";
import type { MapCentre, NearbyProperty } from "@/lib/maps/types";

interface NearbyPropertyCardProps {
  property: NearbyProperty;
  isSelected?: boolean;
  userLocation?: MapCentre | null;
  onClick?: () => void;
}

export default function NearbyPropertyCard({
  property: p,
  isSelected = false,
  userLocation,
  onClick,
}: NearbyPropertyCardProps) {
  const verified = p.landlord?.verification_status === "verified";
  const img = p.hero_photo_url ?? "/placeholder-house.svg";

  return (
    <div
      onClick={onClick}
      className={`flex gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-150 ${
        isSelected
          ? "border-primary bg-red-50/60 shadow-md"
          : "border-[#EBEBEB] bg-white hover:border-primary/50 hover:shadow-sm"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-[#f0f0f0]">
        <img
          src={img}
          alt={p.address}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/placeholder-house.svg";
          }}
        />
        {verified && (
          <div className="absolute top-1 right-1 bg-white rounded-full p-0.5 shadow-sm">
            <ShieldCheck className="h-3 w-3 text-green-600" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2 mb-1">
          {p.address}
        </p>

        <p className="text-[13px] font-bold text-primary mb-1.5">
          {formatNGN(p.rent_amount_ngn)}
          <span className="font-normal text-xs text-muted-foreground">/yr</span>
        </p>

        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <TrustBadge score={p.trust_score} size="sm" showLabel={false} />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Bed className="h-3 w-3" />
            {p.rooms} {p.rooms === 1 ? "room" : "rooms"}
          </span>
        </div>

        {/* Distances */}
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            {formatDistance(p.distance_from_naub_km)}
          </span>
          {userLocation && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Navigation className="h-2.5 w-2.5 shrink-0" />
              {formatDistance(p.distance_from_centre_km, "from you")}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col justify-between items-end shrink-0 gap-2">
        <Link
          href={`/properties/${p.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline"
        >
          View <ExternalLink className="h-3 w-3" />
        </Link>
        <a
          href={buildDirectionsUrl(
            { lat: p.latitude, lng: p.longitude },
            userLocation
          )}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium"
          title="Get directions"
        >
          <Navigation className="h-3 w-3" /> Go
        </a>
      </div>
    </div>
  );
}
