"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star, Heart } from "lucide-react";
import type { PropertySummary } from "@/api";
import { trustLevelForScore, trustLevelLabel } from "@/lib/trust/levels";
import { pickListingPhoto, LISTING_PHOTOS } from "@/lib/listing-photos";
import { TRUST_LEVEL_STYLES } from "./trust-level-styles";
import { useMyFavoriteIds, useToggleFavorite } from "@/hooks/use-favorites";

interface PropertyCardProps {
  property: PropertySummary;
}

function formatNGN(amount?: number | null) {
  if (!amount) return "₦—";
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}

function getPhotoUrl(property: PropertySummary) {
  if (property.hero_photo_url) return property.hero_photo_url;
  // Fall back to a stable rotation of bundled listing photos keyed off the
  // property id — so the same listing always shows the same photo, but
  // different listings look distinct. The onError fallback below is the
  // absolute safety net if even those bundled files 404.
  return pickListingPhoto(property.id ?? "default");
}

export default function PropertyCard({ property }: PropertyCardProps) {
  const landlord = property.landlord;
  const trustScore = property.trust_score ?? 0;
  const trustLevel = trustLevelForScore(trustScore);
  // Only the two "trust-positive" levels earn a visible badge — a "Low Trust"
  // or "High Risk" chip on a listing photo would scare users off listings the
  // algorithm hasn't finished reviewing. Average is the implicit baseline.
  const trustHighlight = trustLevel === "highly_trusted" || trustLevel === "trusted";
  const verified = landlord?.verification_status === "verified";
  const rating = landlord?.average_rating ?? null;

  // Favorites. We track whether the user is signed in via localStorage so the
  // hook can be enabled only when there's a session (anonymous users get sent
  // to /login on click instead of a failed 401 fetch).
  const router = useRouter();
  const [signedIn] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!localStorage.getItem("naub_token");
  });
  const { data: favoriteIds = [] } = useMyFavoriteIds(signedIn);
  const toggleMutation = useToggleFavorite();
  const isFavorite = favoriteIds.includes(property.id ?? "");

  const handleToggleFavorite = (e: React.MouseEvent) => {
    // The whole card is a <Link> — stop the click from navigating.
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      router.push(`/login?redirect=${encodeURIComponent(`/properties/${property.id}`)}`);
      return;
    }
    toggleMutation.mutate({ propertyId: property.id!, favorite: !isFavorite });
  };

  return (
    <Link href={`/properties/${property.id}`} className="block group">
      <div className="bg-white rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 group-hover:shadow-md">
        {/* Photo — tighter aspect + rounded corners so cards read as a row of small thumbnails (Airbnb feel) */}
        <div className="relative aspect-[4/3] overflow-hidden bg-[#f0f0f0]">
          <img
            src={getPhotoUrl(property)}
            alt={property.address ?? "Property"}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src = LISTING_PHOTOS[0];
            }}
          />

          {/* Trust badge — bottom-left, like Airbnb's "Guest favourite" overlay */}
          {trustHighlight && (() => {
            const style = TRUST_LEVEL_STYLES[trustLevel];
            return (
              <div
                className="absolute top-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm inline-flex items-center gap-1"
                style={{ background: style.bg, color: style.color }}
              >
                <style.Icon size={11} />
                {trustLevelLabel(trustLevel)} landlord
              </div>
            );
          })()}

          {/* Save / favorite heart — top-right. Airbnb-style: outline when not
              saved, filled red when saved. Clicking does not navigate (the
              whole card is a link) — see handleToggleFavorite. */}
          <button
            type="button"
            onClick={handleToggleFavorite}
            aria-label={isFavorite ? "Remove from saved" : "Save listing"}
            aria-pressed={isFavorite}
            className="absolute top-3 right-3 h-8 w-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:scale-110 active:scale-95 transition-transform"
          >
            <Heart
              className={`h-4 w-4 transition-colors ${isFavorite ? "fill-[#FF5A5F] text-[#FF5A5F]" : "text-foreground"}`}
            />
          </button>
        </div>

        {/* Info — compact, single column, no heavy landlord block */}
        <div className="pt-3 pb-1 px-1">
          {/* Title — line-clamped single line so cards stay equal height */}
          <h3 className="text-[15px] font-semibold text-foreground leading-5 line-clamp-1">
            {property.address ?? "Address not specified"}
          </h3>

          {/* Meta — e.g. "2 rooms · Verified landlord" or "2 rooms · Trusted landlord" */}
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
            {property.rooms ?? 1} {(property.rooms ?? 1) === 1 ? "room" : "rooms"}
            {trustHighlight && verified ? " · Trusted landlord" : verified ? " · Verified landlord" : ""}
          </p>

          {/* Trust score row — "84/100" next to the price line. Always shown so
              students can gauge reliability even on listings that don't earn
              the corner "Trusted landlord" pill. */}
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[15px] text-foreground">
              <span className="font-semibold">{formatNGN(property.rent_amount_ngn)}</span>
              <span className="text-muted-foreground font-normal"> /yr</span>
            </p>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold"
                style={{ background: TRUST_LEVEL_STYLES[trustLevel].bg, color: TRUST_LEVEL_STYLES[trustLevel].color }}
                title={`Trust score: ${trustScore}/100 (${trustLevelLabel(trustLevel)})`}
              >
                {(() => { const Icon = TRUST_LEVEL_STYLES[trustLevel].Icon; return <Icon size={10} />; })()}
                {trustScore}/100
              </span>
              {rating !== null && rating > 0 ? (
                <span className="flex items-center gap-0.5 text-sm text-foreground">
                  <Star className="h-3 w-3 fill-current" />
                  <span className="font-medium">{rating.toFixed(1)}</span>
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
