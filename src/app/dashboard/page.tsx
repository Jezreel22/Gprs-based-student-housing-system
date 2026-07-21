"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getGetMyPropertiesQueryOptions, getGetBookingsQueryOptions, usePublishProperty, useDeleteProperty, useUpdateProperty } from "@/api";
import NavBar from "@/components/NavBar";
import PropertyCard from "@/components/PropertyCard";
import PayoutDetailsCard from "@/components/PayoutDetailsCard";
import AvatarUploader from "@/components/AvatarUploader";
import TrustCard from "@/components/TrustCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Home, Plus, ShieldCheck, ShieldAlert, Calendar, Clock,
  AlertCircle, Lock, ArrowRight, MessageSquare, CreditCard, ClipboardList, Search
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface StoredUser {
  id: string; email: string; role: string;
  first_name?: string; last_name?: string;
  profile_photo_url?: string | null;
  verification_status?: string;
}

function formatNGN(n?: number | null) {
  return n ? `₦${n.toLocaleString("en-NG")}` : "₦—";
}

const BOOKING_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Awaiting Payment", color: "#717171" },
  pending_occupancy: { label: "Awaiting Move-in", color: "#FF5A5F" },
  pending_review: { label: "In Review", color: "#F57F17" },
  completed: { label: "Completed", color: "#34A853" },
  cancelled: { label: "Cancelled", color: "#EBEBEB" },
  disputed: { label: "Disputed", color: "#E1444A" },
};

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const token = localStorage.getItem("naub_token");
    const raw = localStorage.getItem("naub_user");
    if (!token || !raw) { router.push("/login"); return; }
    try { setUser(JSON.parse(raw)); } catch { router.push("/login"); }
  }, [router]);

  const isLandlord = ["landlord", "agent"].includes(user?.role ?? "");
  const isStudent = user?.role === "student";
  const isAdmin = user?.role === "escrow_officer";

  const { data: myProperties } = useQuery({
    ...getGetMyPropertiesQueryOptions(),
    enabled: !!user && isLandlord,
  });

  const { data: myBookings, refetch: refetchBookings } = useQuery({
    ...getGetBookingsQueryOptions(),
    enabled: !!user,
  });

  const publishMutation = usePublishProperty();
  const deleteMutation = useDeleteProperty();
  const updateMutation = useUpdateProperty();

  const handleLogout = () => {
    localStorage.removeItem("naub_token");
    localStorage.removeItem("naub_user");
    router.push("/");
    window.dispatchEvent(new Event("storage"));
  };

  const handlePublish = (id: string) => {
    publishMutation.mutate({ id }, {
      onSuccess: () => toast({ title: "Listing published", description: "Your property is now live and visible to students." }),
      onError: () => toast({ variant: "destructive", title: "Failed to publish" }),
    });
  };

  const handleUnpublish = (id: string) => {
    // Soft-remove: the listing stays in our records (so booking history and
    // escrow audit trails are preserved) but disappears from the public
    // landing + browse pages.
    updateMutation.mutate(
      { id, data: { listing_status: "draft" as any } },
      {
        onSuccess: () => toast({ title: "Listing unpublished", description: "Students can no longer see or book this property." }),
        onError: (e: any) => toast({ variant: "destructive", title: "Couldn't unpublish", description: e?.message ?? "Please try again" }),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => toast({ title: "Listing removed" }),
      onError: (e: any) => toast({
        variant: "destructive",
        title: "Couldn't delete listing",
        description: e?.message ?? "It may have existing bookings — try unpublishing it instead.",
      }),
    });
  };

  if (!user) return null;

  if (isAdmin) {
    router.push("/admin");
    return null;
  }

  const properties = myProperties?.data ?? [];
  const bookings = (myBookings ?? []) as any[];

  // For students: active/recent bookings (also flag unpaid bookings so the
  // dashboard can prompt the student to complete payment).
  const activeBooking = isStudent ? bookings.find((b: any) =>
    ["pending_payment", "pending_occupancy", "pending_review", "disputed"].includes(b.booking_status)
  ) : null;

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <AvatarUploader
              user={user}
              size={80}
              hint="Tap to update photo"
            />
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Welcome back, {user.first_name ?? user.email.split("@")[0]}
              </h1>
              <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground capitalize">
                {user.role.replace("_", " ")}
              </span>
              {/* Verification badge only matters for landlords/agents who list
                  properties — students don't go through KYC, so hide it for them. */}
              {isLandlord && (
                user.verification_status === "verified" ? (
                  <Badge className="bg-green-100 text-green-700 border-0 text-xs">
                    <ShieldCheck className="h-3 w-3 mr-1" /> Verified
                  </Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">
                    <ShieldAlert className="h-3 w-3 mr-1" /> Pending Verification
                  </Badge>
                )
              )}
            </div>
          </div>
          </div>
          <div className="flex items-center gap-2">
            {isLandlord && (
              <Link href="/properties/new">
                <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2">
                  <Plus className="h-4 w-4" /> List a Property
                </Button>
              </Link>
            )}
            {isStudent && (
              <Link href="/properties">
                <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2">
                  <Home className="h-4 w-4" /> Browse Listings
                </Button>
              </Link>
            )}
            <Button variant="outline" onClick={handleLogout}>Log out</Button>
          </div>
        </div>

        {/* Trust score — only landlords and agents are scored; students don't
            get one, so the card is hidden for them. */}
        {isLandlord && (
          <div className="mb-8">
            <TrustCard
              userId={user.id}
              role={user.role}
              verificationStatus={user.verification_status}
            />
          </div>
        )}

        {/* Active booking banner (students) */}
        {isStudent && activeBooking && (
          <div className="mb-6 bg-white rounded-2xl border border-[#EBEBEB] p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="font-semibold text-lg">Active Booking</h2>
                  <Link href="/bookings" className="text-xs text-primary hover:underline">See all bookings →</Link>
                </div>
                <p className="text-sm text-muted-foreground">{activeBooking.property?.address}</p>
                <div className="mt-2">
                  <Badge
                    style={{
                      background: BOOKING_STATUS_MAP[activeBooking.booking_status]?.color + "20",
                      color: BOOKING_STATUS_MAP[activeBooking.booking_status]?.color,
                      border: "none",
                    }}
                    className="text-xs"
                  >
                    {BOOKING_STATUS_MAP[activeBooking.booking_status]?.label}
                  </Badge>
                </div>
              </div>
              {activeBooking.booking_status === "pending_occupancy" && (
                <Link href={`/bookings/${activeBooking.id}`}>
                  <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2 shrink-0">
                    <Lock className="h-4 w-4" /> Enter Occupancy Code
                  </Button>
                </Link>
              )}
              {activeBooking.booking_status === "pending_payment" && (
                <Link href={`/bookings/${activeBooking.id}`}>
                  <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2 shrink-0">
                    <CreditCard className="h-4 w-4" /> Complete Payment
                  </Button>
                </Link>
              )}
              {activeBooking.booking_status === "pending_review" && (
                <Link href={`/bookings/${activeBooking.id}`}>
                  <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2 shrink-0">
                    <Lock className="h-4 w-4" /> Approve & Release Payment
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* LANDLORD/AGENT VIEW */}
        {isLandlord && (
          <div className="space-y-6">
            <PayoutDetailsCard />
            <Tabs defaultValue="listings" className="space-y-6">
            <TabsList className="bg-white border border-[#EBEBEB] h-auto p-1 rounded-xl">
              <TabsTrigger value="listings" className="rounded-lg px-5">My Listings ({properties.length})</TabsTrigger>
              <TabsTrigger value="bookings" className="rounded-lg px-5">Bookings ({bookings.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="listings">
              {properties.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                  <Home className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-60" />
                  <h3 className="text-lg font-semibold mb-2">No listings yet</h3>
                  <p className="text-muted-foreground mb-6">Create your first property listing to start receiving bookings.</p>
                  <Link href="/properties/new">
                    <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2">
                      <Plus className="h-4 w-4" /> Add Your First Property
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {properties.map((p: any) => (
                    <div key={p.id} className="relative">
                      <PropertyCard property={p} />
                      {/* Action buttons overlaid below card */}
                      <div className="flex gap-2 mt-2">
                        {p.listing_status === "live" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-xs"
                            onClick={() => handleUnpublish(p.id)}
                            disabled={updateMutation.isPending || publishMutation.isPending}
                          >
                            Unpublish
                          </Button>
                        )}
                        <Link href={`/properties/${p.id}`} className="flex-1">
                          <Button size="sm" variant="outline" className="w-full text-xs">View</Button>
                        </Link>
                        {p.listing_status !== "live" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-destructive"
                            onClick={() => handleDelete(p.id)}
                            disabled={deleteMutation.isPending}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="bookings">
              {bookings.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                  <ClipboardList className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-60" />
                  <h3 className="text-lg font-semibold mb-2">No bookings yet</h3>
                  <p className="text-muted-foreground">Once students book your properties, they'll appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {bookings.map((b: any) => {
                    const status = BOOKING_STATUS_MAP[b.booking_status] ?? { label: b.booking_status, color: "#717171" };
                    return (
                      <div key={b.id} className="bg-white rounded-xl border border-[#EBEBEB] p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{b.property?.address ?? "Property"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Student: {b.student?.first_name} {b.student?.last_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatNGN(b.total_amount_ngn)} · Escrow ref: {b.escrow_account_reference}
                          </p>
                          {/* Code chip — only meaningful while the student still
                              has to confirm move-in. The endpoint only returns the
                              code for the landlord, so it won't render for students. */}
                          {b.property?.occupancy_code && ["pending_occupancy", "pending_review"].includes(b.booking_status) && (
                            <div className="mt-2 inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 text-xs">
                              <Lock className="h-3 w-3 text-amber-700" />
                              <span className="text-muted-foreground">Code:</span>
                              <span className="font-mono font-bold tracking-[0.2em] text-amber-900">{b.property.occupancy_code}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge style={{ background: status.color + "20", color: status.color, border: "none" }} className="text-xs">
                            {status.label}
                          </Badge>
                          {b.student?.id && (
                            <Link href={`/messages/${b.student.id}`}>
                              <Button size="sm" variant="ghost" className="text-xs gap-1">
                                <MessageSquare className="h-3 w-3" /> Message
                              </Button>
                            </Link>
                          )}
                          <Link href={`/bookings/${b.id}`}>
                            <Button size="sm" variant="outline" className="text-xs gap-1">
                              View <ArrowRight className="h-3 w-3" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
          </div>
        )}

        {/* STUDENT VIEW */}
        {isStudent && (
          <Tabs defaultValue="bookings" className="space-y-6">
            <TabsList className="bg-white border border-[#EBEBEB] h-auto p-1 rounded-xl">
              <TabsTrigger value="bookings" className="rounded-lg px-5">My Bookings ({bookings.length})</TabsTrigger>
              <TabsTrigger value="browse" className="rounded-lg px-5">Find Housing</TabsTrigger>
            </TabsList>

            <TabsContent value="bookings">
              {bookings.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                  <Search className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-60" />
                  <h3 className="text-lg font-semibold mb-2">No bookings yet</h3>
                  <p className="text-muted-foreground mb-6">Browse our verified listings and book your ideal student home.</p>
                  <Link href="/properties">
                    <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2">
                      Browse Listings
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {bookings.map((b: any) => {
                    const status = BOOKING_STATUS_MAP[b.booking_status] ?? { label: b.booking_status, color: "#717171" };
                    return (
                      <div key={b.id} className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm mb-1">{b.property?.address ?? "Property"}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>Rent: {formatNGN(b.rent_amount_ngn)}/mo</span>
                              <span>·</span>
                              <span>Deposit: {formatNGN(b.deposit_amount_ngn)}</span>
                              <span>·</span>
                              <span>Escrow: {b.escrow_account_reference}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge style={{ background: status.color + "20", color: status.color, border: "none" }} className="text-xs">
                              {status.label}
                            </Badge>
                            <Link href={`/bookings/${b.id}`}>
                              <Button size="sm" variant="outline" className="text-xs gap-1">
                                Details <ArrowRight className="h-3 w-3" />
                              </Button>
                            </Link>
                          </div>
                        </div>
                        {b.booking_status === "pending_occupancy" && (
                          <div className="mt-3 pt-3 border-t border-[#EBEBEB]">
                            <Link href={`/bookings/${b.id}`}>
                              <Button size="sm" style={{ background: "#FF5A5F", color: "#fff", border: "none" }} className="gap-2 text-xs">
                                <Lock className="h-3.5 w-3.5" /> Enter Occupancy Code to Confirm Move-in
                              </Button>
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="browse">
              <div className="bg-white rounded-2xl border border-[#EBEBEB] p-8 text-center">
                <Home className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-60" />
                <h3 className="text-xl font-semibold mb-3">Find Your Perfect Home</h3>
                <p className="text-muted-foreground mb-6">Browse all verified listings near NAUB campus</p>
                <Link href="/properties">
                  <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }} size="lg" className="rounded-full px-8">
                    Browse All Listings
                  </Button>
                </Link>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}