"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import type { PropertySummary } from "@/api";
import { trustLevelForScore, trustLevelLabel } from "@/lib/trust/levels";
import { TRUST_LEVEL_STYLES } from "./trust-level-styles";

interface PropertyCardProps {
  property: PropertySummary;
}

function formatNGN(amount?: number | null) {
  if (!amount) return "₦—";
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}

function getPhotoUrl(property: PropertySummary) {
  if (property.hero_photo_url) return property.hero_photo_url;
  // Fallback to a bundled house illustration so every listing without an
  // uploaded photo still looks like a property. Previously used picsum.photos,
  // which returned random photos — sometimes houses, sometimes landscapes.
  return "/placeholder-house.svg";
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
              (e.target as HTMLImageElement).src = "/placeholder-house.svg";
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

          {/* Verified tick — top-right */}
          {verified && (
            <div className="absolute top-3 right-3 bg-white rounded-full p-1 shadow-sm" title="Verified landlord">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-green-600" fill="currentColor" aria-hidden>
                <path d="M12 1l2.6 2.1 3.4-.4.8 3.3 3 1.7-1.7 3 1.7 3-3 1.7-.8 3.3-3.4-.4L12 23l-2.6-2.1-3.4.4-.8-3.3-3-1.7 1.7-3-1.7-3 3-1.7.8-3.3 3.4.4z" />
                <path d="M10.5 14.5l-2.5-2.5 1.4-1.4 1.1 1.1 4.1-4.1 1.4 1.4z" fill="white" />
              </svg>
            </div>
          )}
        </div>

        {/* Info — compact, single column, no heavy landlord block */}
        <div className="pt-3 pb-1 px-1">
          {/* Title — line-clamped single line so cards stay equal height */}
          <h3 className="text-[15px] font-semibold text-foreground leading-5 line-clamp-1">
            {property.address ?? "Address not specified"}
          </h3>

          {/* Meta — e.g. "Self-contained · 1 room" */}
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
            {property.rooms ?? 1} {(property.rooms ?? 1) === 1 ? "room" : "rooms"}
            {verified ? " · Verified landlord" : ""}
          </p>

          {/* Price + rating row */}
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[15px] text-foreground">
              <span className="font-semibold">{formatNGN(property.rent_amount_ngn)}</span>
              <span className="text-muted-foreground font-normal"> /yr</span>
            </p>
            {rating !== null && rating > 0 ? (
              <span className="flex items-center gap-0.5 text-sm text-foreground">
                <Star className="h-3 w-3 fill-current" />
                <span className="font-medium">{rating.toFixed(1)}</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
