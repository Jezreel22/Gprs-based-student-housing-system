"use client";

import Link from "next/link";
import { Bed, MapPin, ShieldCheck } from "lucide-react";
import TrustBadge from "./TrustBadge";
import type { PropertySummary } from "@/api";

interface PropertyCardProps {
  property: PropertySummary;
}

function formatNGN(amount?: number | null) {
  if (!amount) return "₦—";
  return `₦${amount.toLocaleString("en-NG")}`;
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

  return (
    <Link href={`/properties/${property.id}`} className="block group">
      <div className="bg-white rounded-xl overflow-hidden transition-all duration-200 group-hover:shadow-lg cursor-pointer border border-[#EBEBEB] group-hover:border-[#DCDCDC]">
        {/* Photo */}
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
          <div className="absolute top-3 left-3">
            <TrustBadge score={trustScore} size="sm" showLabel={false} />
          </div>
          {landlord?.verification_status === "verified" && (
            <div className="absolute top-3 right-3 bg-white rounded-full p-1 shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-4">
          {/* Address */}
          <div className="flex items-start gap-1.5 mb-2">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-foreground line-clamp-1">
              {property.address ?? "Address not specified"}
            </p>
          </div>

          {/* Rooms */}
          <div className="flex items-center gap-1 mb-3 text-muted-foreground">
            <Bed className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs">
              {property.rooms ?? 1} {(property.rooms ?? 1) === 1 ? "room" : "rooms"}
            </span>
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-1">
            <span className="text-base font-bold text-foreground">
              {formatNGN(property.rent_amount_ngn)}
            </span>
            <span className="text-xs text-muted-foreground">/month</span>
          </div>

          {/* Landlord */}
          {landlord && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#EBEBEB]">
              <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white shrink-0">
                {landlord.first_name?.[0] ?? landlord.role?.[0]?.toUpperCase() ?? "L"}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {landlord.first_name} {landlord.last_name}
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {landlord.role}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}