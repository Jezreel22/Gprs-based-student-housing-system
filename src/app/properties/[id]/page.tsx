"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getGetPropertyQueryOptions } from "@/api";
import NavBar from "@/components/NavBar";
import TrustBadge from "@/components/TrustBadge";
import Avatar from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bed, MapPin, Wifi, Zap, Droplets, Shield, Car, ChefHat,
  Star, ShieldCheck, ShieldAlert, MessageSquare, ChevronLeft, ChevronRight,
  FileCheck, Images, Lock, BadgeCheck, Phone, ExternalLink, Calendar,
  Home, CheckCircle2
} from "lucide-react";

const AMENITY_MAP: Record<string, { label: string; Icon: React.ElementType }> = {
  wifi: { label: "WiFi", Icon: Wifi },
  electricity_backup: { label: "Power Backup", Icon: Zap },
  water: { label: "Running Water", Icon: Droplets },
  security: { label: "Security", Icon: Shield },
  parking: { label: "Parking", Icon: Car },
  kitchen: { label: "Kitchen", Icon: ChefHat },
};

function formatNGN(amount?: number | null) {
  if (!amount) return "N/A";
  return `₦${amount.toLocaleString("en-NG")}`;
}

function getPhotoUrls(property: any): string[] {
  if (property.photos && property.photos.length > 0) {
    return property.photos.map((p: any) => p.photo_url);
  }
  // No uploaded photos — fall back to a bundled house illustration so the
  // gallery always looks like a property.
  return ["/placeholder-house.svg"];
}

function StatusBadge({ status }: { status?: string | null }) {
  const config: Record<string, { label: string; bg: string }> = {
    live:      { label: "Available",   bg: "#16A34A" },
    occupied:  { label: "Occupied",    bg: "#DC2626" },
    pending:   { label: "Pending",     bg: "#D97706" },
    suspended: { label: "Suspended",   bg: "#6B7280" },
  };
  const c = config[status ?? ""] ?? { label: status ?? "Unknown", bg: "#6B7280" };
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-white"
          style={{ background: c.bg }}>
      <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
      {c.label}
    </span>
  );
}

export default function PropertyDetail() {
  const params = useParams<{ id: string }>();
  const [photoIdx, setPhotoIdx] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem("naub_user") ?? "null")); } catch { setUser(null); }
    setHydrated(true);
  }, []);

  const { data: property, isLoading, error } = useQuery(
    getGetPropertyQueryOptions(params.id)
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-6xl mx-auto px-4 py-10 space-y-6">
          <div className="h-[420px] bg-gray-100 rounded-2xl animate-pulse" />
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="h-8 bg-gray-100 rounded-xl animate-pulse w-2/3" />
              <div className="h-4 bg-gray-100 rounded-xl animate-pulse w-1/3" />
              <div className="h-32 bg-gray-100 rounded-xl animate-pulse" />
            </div>
            <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-6xl mx-auto px-4 py-32 text-center">
          <div className="text-6xl mb-4">🏚️</div>
          <h2 className="text-2xl font-bold mb-2">Property not found</h2>
          <p className="text-muted-foreground mb-6">This listing may have been removed or is no longer available.</p>
          <Link href="/properties">
            <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="rounded-full px-6">
              Back to Listings
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const photos = getPhotoUrls(property);
  const amenities = (property.amenities ?? {}) as Record<string, boolean>;
  const activeAmenities = Object.entries(amenities).filter(([, v]) => v);
  const landlord = property.landlord as any;
  const trustScore = property.trust_score ?? 0;
  const landlordTrust = landlord?.trust_score ?? null;
  const isOwnListing = user && landlord && user.id === landlord.id;
  const canBook = user?.role === "student" && property.listing_status === "live" && !isOwnListing;
  const ratings = (property as any).ratings ?? [];

  const prevPhoto = () => setPhotoIdx(i => (i - 1 + photos.length) % photos.length);
  const nextPhoto = () => setPhotoIdx(i => (i + 1) % photos.length);

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/" className="hover:text-foreground transition-colors flex items-center gap-1">
            <Home className="h-3.5 w-3.5" /> Home
          </Link>
          <ChevronRight className="h-3.5 w-3.5 opacity-40" />
          <Link href="/properties" className="hover:text-foreground transition-colors">Listings</Link>
          <ChevronRight className="h-3.5 w-3.5 opacity-40" />
          <span className="text-foreground font-medium truncate max-w-[200px]">{property.address}</span>
        </div>

        {/* Photo gallery */}
        <div className="mb-6">
          {/* Main photo */}
          <div className="relative rounded-2xl overflow-hidden bg-gray-100 mb-2" style={{ height: "420px" }}>
            <img
              src={photos[photoIdx]}
              alt={`Property photo ${photoIdx + 1}`}
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).src = "https://picsum.photos/seed/house/1200/700"; }}
            />

            {/* Overlay top-left: status + photo count */}
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <StatusBadge status={property.listing_status} />
            </div>

            {/* Photo counter */}
            <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-black/50 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
              <Images className="h-3.5 w-3.5" />
              {photoIdx + 1} / {photos.length}
            </div>

            {/* Nav arrows */}
            {photos.length > 1 && (
              <>
                <button onClick={prevPhoto}
                  className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2.5 shadow-lg transition-all hover:scale-105">
                  <ChevronLeft className="h-5 w-5 text-foreground" />
                </button>
                <button onClick={nextPhoto}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2.5 shadow-lg transition-all hover:scale-105">
                  <ChevronRight className="h-5 w-5 text-foreground" />
                </button>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((src, i) => (
                <button key={i} onClick={() => setPhotoIdx(i)}
                  className="shrink-0 rounded-xl overflow-hidden transition-all"
                  style={{
                    width: 80, height: 56,
                    outline: i === photoIdx ? "2.5px solid #FF5A5F" : "2.5px solid transparent",
                    opacity: i === photoIdx ? 1 : 0.55,
                  }}>
                  <img src={src} alt="" className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = "https://picsum.photos/seed/thumb/80/56"; }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content grid */}
        <div className="grid lg:grid-cols-3 gap-8">

          {/* Left column: details */}
          <div className="lg:col-span-2 space-y-8">

            {/* Title block */}
            <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                <div>
                  <h1 className="text-2xl font-bold text-foreground">{property.address}</h1>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Bed className="h-4 w-4" />
                      {property.rooms ?? 1} {(property.rooms ?? 1) === 1 ? "room" : "rooms"}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      {property.address}
                    </span>
                    {property.lease_duration_days && (
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {Math.ceil(property.lease_duration_days / 30)}-month lease
                      </span>
                    )}
                  </div>
                </div>
                <TrustBadge score={trustScore} size="md" />
              </div>

              {/* Ratings summary */}
              {ratings.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(s => {
                      const avg = ratings.reduce((a: number, r: any) => a + r.stars, 0) / ratings.length;
                      return <Star key={s} className={`h-4 w-4 ${s <= Math.round(avg) ? "fill-primary text-primary" : "text-gray-200"}`} />;
                    })}
                  </div>
                  <span className="text-sm text-muted-foreground">{ratings.length} review{ratings.length !== 1 ? "s" : ""}</span>
                </div>
              )}
            </div>

            {/* About */}
            {property.description && (
              <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
                <h2 className="text-base font-bold text-foreground mb-3">About This Property</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{property.description}</p>
              </div>
            )}

            {/* Amenities */}
            {activeAmenities.length > 0 && (
              <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
                <h2 className="text-base font-bold text-foreground mb-4">Amenities</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {activeAmenities.map(([key]) => {
                    const amenity = AMENITY_MAP[key];
                    const label = amenity?.label ?? key.replace(/_/g, " ");
                    const Icon = amenity?.Icon ?? CheckCircle2;
                    return (
                      <div key={key} className="flex items-center gap-2.5 p-3 bg-[#FAFAFA] rounded-xl border border-[#EBEBEB]">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#FFF0F0" }}>
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-sm font-medium capitalize">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* House rules */}
            {property.house_rules && (
              <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
                <h2 className="text-base font-bold text-foreground mb-3">House Rules</h2>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800 leading-relaxed">
                  {property.house_rules}
                </div>
              </div>
            )}

            {/* Map */}
            <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
              <h2 className="text-base font-bold text-foreground mb-4">Location</h2>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#FFF0F0" }}>
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm font-medium">{property.address}</span>
              </div>

              {property.latitude && property.longitude ? (
                <div className="rounded-xl overflow-hidden border border-[#EBEBEB]" style={{ height: 280 }}>
                  <iframe
                    title="Property location"
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${property.longitude - 0.01}%2C${property.latitude - 0.01}%2C${property.longitude + 0.01}%2C${property.latitude + 0.01}&layer=mapnik&marker=${property.latitude}%2C${property.longitude}`}
                  />
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden border border-[#EBEBEB] bg-[#F7F7F7] flex flex-col items-center justify-center gap-3"
                     style={{ height: 200 }}>
                  <div className="w-12 h-12 rounded-2xl bg-white border border-[#EBEBEB] flex items-center justify-center">
                    <MapPin className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">Exact coordinates not available</p>
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(property.address ?? "")}`}
                     target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> View on Google Maps
                  </a>
                </div>
              )}
            </div>

            {/* Reviews */}
            {ratings.length > 0 && (
              <div className="bg-white rounded-2xl p-6 border border-[#EBEBEB]">
                <h2 className="text-base font-bold text-foreground mb-4">
                  Reviews ({ratings.length})
                </h2>
                <div className="space-y-4">
                  {ratings.slice(0, 4).map((r: any) => (
                    <div key={r.id} className="border-b border-[#EBEBEB] last:border-0 pb-4 last:pb-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar user={r.rater} size={36} />
                          <div>
                            <p className="text-sm font-semibold">{r.rater?.first_name} {r.rater?.last_name}</p>
                            <p className="text-xs text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleDateString("en-NG", { month: "short", year: "numeric" }) : ""}</p>
                          </div>
                        </div>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star key={s} className={`h-3.5 w-3.5 ${s <= r.stars ? "fill-primary text-primary" : "text-gray-200"}`} />
                          ))}
                        </div>
                      </div>
                      {r.review_text && <p className="text-sm text-muted-foreground leading-relaxed">{r.review_text}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column: sticky booking sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">

              {/* Booking card */}
              <div className="bg-white rounded-2xl border border-[#EBEBEB] shadow-lg overflow-hidden">
                {/* Price header */}
                <div className="p-6 pb-4">
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-3xl font-extrabold text-foreground">
                      {formatNGN(property.rent_amount_ngn)}
                    </span>
                    <span className="text-sm text-muted-foreground font-normal">/year</span>
                  </div>
                  {property.deposit_amount_ngn && (
                    <p className="text-xs text-muted-foreground">
                      Security deposit: <span className="font-medium text-foreground">{formatNGN(property.deposit_amount_ngn)}</span>
                    </p>
                  )}
                </div>

                <Separator />

                <div className="p-6 pt-5 space-y-3">
                  {canBook ? (
                    <Link href={`/bookings/new?property_id=${property.id}`}>
                      <Button className="w-full rounded-xl h-12 font-semibold text-base"
                              style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                        Reserve This Property
                      </Button>
                    </Link>
                  ) : property.listing_status === "occupied" ? (
                    <Button disabled className="w-full rounded-xl h-12 font-semibold">
                      Currently Occupied
                    </Button>
                  ) : !user ? (
                    <Link href="/login">
                      <Button className="w-full rounded-xl h-12 font-semibold text-base"
                              style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                        Log In to Book
                      </Button>
                    </Link>
                  ) : isOwnListing ? (
                    <Link href="/dashboard">
                      <Button variant="outline" className="w-full rounded-xl h-12 font-semibold">
                        Manage Listing
                      </Button>
                    </Link>
                  ) : (
                    <Button disabled className="w-full rounded-xl h-12 font-semibold">
                      Not Available
                    </Button>
                  )}

                  {user && landlord && !isOwnListing && (
                    <Link href={`/messages/${landlord.id}`}>
                      <Button variant="outline" className="w-full rounded-xl h-10 gap-2 text-sm">
                        <MessageSquare className="h-4 w-4" />
                        Message Landlord
                      </Button>
                    </Link>
                  )}
                </div>

                {/* Escrow guarantee */}
                <div className="mx-6 mb-5 rounded-xl p-3 flex items-start gap-2.5" style={{ background: "#F0FDF4" }}>
                  <Lock className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-green-800 leading-relaxed">
                    <span className="font-semibold">Escrow protected.</span> Your payment is held securely and released only after you confirm occupancy.
                  </p>
                </div>
              </div>

              {/* Landlord card */}
              {landlord && (
                <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
                  <div className="px-5 pt-5 pb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Listed by</p>
                    <div className="flex items-center gap-3 mb-4">
                      <Avatar user={landlord} size={44} />
                      <div>
                        <p className="font-semibold text-sm">{landlord.first_name} {landlord.last_name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{landlord.role}</p>
                        {landlord.verification_status === "verified" ? (
                          <div className="flex items-center gap-1 mt-0.5">
                            <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-xs text-green-600 font-semibold">Verified</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 mt-0.5">
                            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                            <span className="text-xs text-amber-500 font-medium">Pending verification</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Trust score breakdown */}
                    <div className="rounded-xl border border-[#EBEBEB] p-3 bg-[#FAFAFA]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                          <BadgeCheck className="h-3.5 w-3.5 text-primary" /> Trust Score
                        </span>
                        <TrustBadge score={landlordTrust?.total_score ?? trustScore} size="sm" />
                      </div>
                      {landlordTrust && (
                        <div className="space-y-1.5 mt-2">
                          {[
                            { label: "Identity verified", val: landlordTrust.identity_verification_points },
                            { label: "Transactions completed", val: landlordTrust.transaction_completion_points },
                            { label: "Ratings average", val: landlordTrust.ratings_average_points },
                          ].map(item => (
                            <div key={item.label} className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">{item.label}</span>
                              <span className="text-xs font-semibold text-foreground">+{item.val ?? 0}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {landlord.phone_number && (
                      <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        <span>{landlord.phone_number}</span>
                      </div>
                    )}
                  </div>

                  {/* Platform guarantees */}
                  <div className="border-t border-[#EBEBEB] px-5 py-4 bg-[#F7F7F7] space-y-2">
                    {[
                      { icon: FileCheck, text: "Listing reviewed by our team" },
                      { icon: Shield, text: "Escrow payment protection" },
                      { icon: ShieldCheck, text: "Dispute resolution available" },
                    ].map(item => (
                      <div key={item.text} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <item.icon className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        <span>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}