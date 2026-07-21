"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getGetBookingsQueryOptions } from "@/api";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ArrowRight, CreditCard, MessageSquare, Lock,
  ShoppingBag, CheckCircle, XCircle, Clock, Receipt
} from "lucide-react";
import { pickListingPhoto, LISTING_PHOTOS } from "@/lib/listing-photos";

interface StoredUser {
  id: string;
  email: string;
  role: string;
  first_name?: string;
  last_name?: string;
}

function formatNGN(n?: number | null) {
  return n ? `₦${n.toLocaleString("en-NG")}` : "₦—";
}

const BOOKING_STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Awaiting Payment", color: "#717171" },
  pending_occupancy: { label: "Awaiting Move-in", color: "#FF5A5F" },
  pending_review: { label: "Ready to Release", color: "#F57F17" },
  release_pending: { label: "Payout In Progress", color: "#1565C0" },
  release_failed: { label: "Payout Needs Attention", color: "#E1444A" },
  completed: { label: "Completed", color: "#34A853" },
  cancelled: { label: "Cancelled", color: "#717171" },
  disputed: { label: "Disputed", color: "#E1444A" },
};

// Which lifecycle statuses land in each section. Anything not listed falls back
// to "Active" so a new status never silently disappears from the page.
const COMPLETED_STATUSES = ["completed"];
const CANCELLED_STATUSES = ["cancelled"];

function statusGroup(status: string): "active" | "completed" | "cancelled" {
  if (COMPLETED_STATUSES.includes(status)) return "completed";
  if (CANCELLED_STATUSES.includes(status)) return "cancelled";
  return "active";
}

function BookingRow({ b, user }: { b: any; user: StoredUser }) {
  const status = BOOKING_STATUS_MAP[b.booking_status] ?? { label: b.booking_status, color: "#717171" };
  const isStudent = user.role === "student";
  // Who the "other party" is depends on the viewer's role.
  const otherParty = isStudent ? b.landlord : b.student;
  const otherPartyLabel = isStudent ? "Landlord" : "Student";

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      {/* Hero thumbnail */}
      <div className="w-full sm:w-24 h-24 rounded-xl bg-gray-100 overflow-hidden shrink-0">
        <img
          src={b.property?.hero_photo_url || pickListingPhoto(b.property?.id ?? b.id ?? "default")}
          alt=""
          className="w-full h-full object-cover"
          onError={e => { (e.target as HTMLImageElement).src = LISTING_PHOTOS[0]; }}
        />
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Badge style={{ background: status.color + "20", color: status.color, border: "none" }} className="text-xs">
            {status.label}
          </Badge>
          {b.created_at && (
            <span className="text-xs text-muted-foreground">
              {new Date(b.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
        <p className="font-semibold text-sm truncate">{b.property?.address ?? "Property"}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
          <span>{formatNGN(b.total_amount_ngn)} total</span>
          {otherParty && (otherParty.first_name || otherParty.last_name) && (
            <span>{otherPartyLabel}: {otherParty.first_name} {otherParty.last_name}</span>
          )}
          {b.escrow_account_reference && <span>Ref: {b.escrow_account_reference}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
        {isStudent && b.booking_status === "pending_payment" && (
          <Link href={`/bookings/${b.id}`} className="flex-1 sm:flex-none">
            <Button size="sm" className="w-full gap-1" style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
              <CreditCard className="h-3.5 w-3.5" /> Pay now
            </Button>
          </Link>
        )}
        {isStudent && b.booking_status === "pending_review" && (
          <Link href={`/bookings/${b.id}`} className="flex-1 sm:flex-none">
            <Button size="sm" className="w-full gap-1" style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
              <Lock className="h-3.5 w-3.5" /> Release payment
            </Button>
          </Link>
        )}
        {otherParty?.id && (
          <Link href={`/messages/${otherParty.id}`}>
            <Button size="sm" variant="ghost" className="gap-1 text-xs">
              <MessageSquare className="h-3.5 w-3.5" /> Message
            </Button>
          </Link>
        )}
        <Link href={`/bookings/${b.id}`} className="flex-1 sm:flex-none">
          <Button size="sm" variant="outline" className="w-full gap-1 text-xs">
            View <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Section({ title, icon, bookings, user }: {
  title: string;
  icon: React.ReactNode;
  bookings: any[];
  user: StoredUser;
}) {
  if (bookings.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">({bookings.length})</span>
      </div>
      <div className="space-y-3">
        {bookings.map((b) => <BookingRow key={b.id} b={b} user={user} />)}
      </div>
    </div>
  );
}

export default function MyBookings() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("naub_token");
    const raw = localStorage.getItem("naub_user");
    if (!token || !raw) { router.push("/login"); return; }
    try { setUser(JSON.parse(raw)); } catch { router.push("/login"); return; }
    setHydrated(true);
  }, [router]);

  const { data: bookingsData, isLoading } = useQuery({
    ...getGetBookingsQueryOptions(),
    enabled: !!user,
  });

  if (!hydrated || !user) {
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-3xl mx-auto px-4 py-20">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/3" />
            <div className="h-24 bg-gray-200 rounded-2xl" />
            <div className="h-24 bg-gray-200 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const bookings = (bookingsData ?? []) as any[];
  const active = bookings.filter((b) => statusGroup(b.booking_status) === "active");
  const completed = bookings.filter((b) => statusGroup(b.booking_status) === "completed");
  const cancelled = bookings.filter((b) => statusGroup(b.booking_status) === "cancelled");

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 cursor-pointer">
          <ChevronLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <div className="flex items-center gap-2 mb-6">
          <ShoppingBag className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">My Bookings</h1>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-24 bg-gray-200 rounded-2xl" />
            <div className="h-24 bg-gray-200 rounded-2xl" />
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-[#EBEBEB]">
            <Receipt className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-60" />
            <h3 className="text-lg font-semibold mb-2">No bookings yet</h3>
            <p className="text-muted-foreground mb-6">
              {user.role === "student"
                ? "Browse verified listings and your bookings will show up here."
                : "Once students book your properties, they'll appear here."}
            </p>
            <Link href="/properties">
              <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>Browse Listings</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            <Section
              title="Active"
              icon={<Clock className="h-5 w-5 text-[#FF5A5F]" />}
              bookings={active}
              user={user}
            />
            <Section
              title="Completed"
              icon={<CheckCircle className="h-5 w-5 text-green-600" />}
              bookings={completed}
              user={user}
            />
            <Section
              title="Cancelled"
              icon={<XCircle className="h-5 w-5 text-muted-foreground" />}
              bookings={cancelled}
              user={user}
            />
          </div>
        )}
      </div>
    </div>
  );
}
