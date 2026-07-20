"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetPropertyQueryOptions, getGetBookingQueryOptions,
  useCreateBooking, useConfirmOccupancy, useFileDispute, useCreateRating
} from "@/api";
import { initializePayment, verifyPayment } from "@/lib/payment-client";
import { payWithPaystack, PAYSTACK_CLOSED } from "@/lib/paystack-inline";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Lock, MapPin, CheckCircle, AlertCircle, Star, Shield, CreditCard, Loader2, MessageSquare } from "lucide-react";

function formatNGN(n?: number | null) {
  return n ? `₦${n.toLocaleString("en-NG")}` : "₦—";
}

const BOOKING_STATUS_CONFIG: Record<string, { label: string; color: string; desc: string }> = {
  pending_payment: { label: "Awaiting Payment", color: "#717171", desc: "This booking is reserved. Complete your Paystack payment to move it into escrow." },
  pending_occupancy: { label: "Awaiting Occupancy Verification", color: "#FF5A5F", desc: "Enter the 6-character code your landlord gave you to confirm you've moved in." },
  pending_review: { label: "Ready to Release", color: "#F57F17", desc: "Move-in confirmed. When you're satisfied, approve the payment to release it to the landlord." },
  release_pending: { label: "Payout In Progress", color: "#1565C0", desc: "You approved the release. The payout to your landlord's bank account is being processed." },
  release_failed: { label: "Payout Needs Attention", color: "#E1444A", desc: "The payout to the landlord didn't go through. An officer will retry." },
  completed: { label: "Completed", color: "#34A853", desc: "This booking is complete. Escrow has been released." },
  cancelled: { label: "Cancelled", color: "#717171", desc: "This booking was cancelled." },
  disputed: { label: "Disputed", color: "#E1444A", desc: "A dispute is under investigation by our Escrow Officer." },
};

// Translate a raw Paystack error into a student/landlord-safe message.
// Never expose raw gateway text — it can include internal codes.
function friendlyReleaseError(raw: string | null | undefined): string {  const lower = (raw ?? "").toLowerCase();
  if (!lower) return "There was a problem sending the payout. An officer is reviewing this booking.";
  // Paystack account-tier gate: Starter Business accounts can't make third-party
  // payouts at all. Retrying does nothing until the business is upgraded to
  // Registered. Be honest about that rather than promising an officer will fix it.
  if (lower.includes("starter business") || lower.includes("third party payout") || lower.includes("transfer_unavailable"))
    return "Payouts are paused until the platform's Paystack account is upgraded to a Registered Business. This is being handled — no action needed from you, and your funds are safe.";
  if (lower.includes("reversed") || lower.includes("reversal"))
    return "The bank reversed a payout after it was sent. Our team is reviewing the transfer and will follow up — no action needed from you right now.";
  if (lower.includes("insufficient")) return "The platform balance couldn't cover the payout. An officer will retry shortly.";
  if (lower.includes("recipient") || lower.includes("account") || lower.includes("invalid"))
    return "The landlord's bank account couldn't be credited. An officer will review and follow up.";
  return "There was a problem sending the payout. An officer is reviewing this booking.";
}

// Escrow journey shown as a horizontal stepper on the booking page. The active
// step is derived from booking_status; statuses outside this list (cancelled,
// disputed, release_failed) skip the stepper and render only a status banner.
const ESCROW_STEPS: { key: string; label: string }[] = [
  { key: "pending_payment", label: "Reserved" },
  { key: "pending_occupancy", label: "Move-in" },
  { key: "pending_review", label: "Approve" },
  { key: "release_pending", label: "Payout" },
  { key: "completed", label: "Completed" },
];

function propertyHero(property: any): string {
  return property?.hero_photo_url || "/placeholder-house.svg";
}

// NEW BOOKING: /bookings/new?property_id=xxx
// EXISTING BOOKING: /bookings/:id
function BookingPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const propertyIdParam = searchParams.get("property_id");
  const { toast } = useToast();

  const isNewBooking = params.id === "new" || !params.id;
  const bookingId = isNewBooking ? null : params.id;
  const propertyId = isNewBooking ? (propertyIdParam ?? "") : "";

  const [user, setUser] = useState<{ id: string; role: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try { setUser(JSON.parse(localStorage.getItem("naub_user") ?? "null")); } catch { setUser(null); }
    setHydrated(true);
  }, []);

  // For new bookings: fetch property
  const { data: property } = useQuery({
    ...getGetPropertyQueryOptions(propertyId),
    enabled: isNewBooking && !!propertyId,
  });

  // For existing bookings: fetch booking
  const { data: booking, refetch: refetchBooking } = useQuery({
    ...getGetBookingQueryOptions(bookingId ?? ""),
    enabled: !!bookingId,
  });

  const createBookingMutation = useCreateBooking();
  const confirmOccupancyMutation = useConfirmOccupancy();
  const fileDisputeMutation = useFileDispute();
  const createRatingMutation = useCreateRating();
  const queryClient = useQueryClient();
  const [paymentInProgress, setPaymentInProgress] = useState(false);

  // Form state
  const [leaseStartDate, setLeaseStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [leaseDuration, setLeaseDuration] = useState("365");
  const [paymentMethod, setPaymentMethod] = useState("paystack");
  const [occupancyCode, setOccupancyCode] = useState("");
  const [useGPS, setUseGPS] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<{lat: number; lng: number} | null>(null);
  const [disputeReason, setDisputeReason] = useState("property_mismatch");
  const [disputeDesc, setDisputeDesc] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [showRating, setShowRating] = useState(false);
  const [approvingRelease, setApprovingRelease] = useState(false);

  useEffect(() => {
    // Wait for the localStorage read to complete before deciding to redirect.
    // Without this guard, `user` is null on the first render and this effect
    // fires `router.push("/login")` on every mount — booting the student to
    // the login screen the moment they tap "Reserve".
    if (!hydrated) return;
    if (!user) { router.push("/login"); return; }
    if (isNewBooking && !propertyId) { router.push("/properties"); }
  }, [hydrated, user, isNewBooking, propertyId, router]);

  const handleGetGPS = () => {
    if (!navigator.geolocation) {
      toast({ variant: "destructive", title: "GPS not available on this device" }); return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => { setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setUseGPS(true); },
      () => toast({ variant: "destructive", title: "Location access denied" })
    );
  };

  /**
   * Drive the Paystack inline flow for a pending booking: ask the server to
   * prepare the checkout (amount/email/reference are server-derived), open
   * the popup, then verify the charge server-side. `onDone` runs exactly once
   * after the popup resolves — paid, dismissed, or failed — so callers can
   * navigate regardless of outcome (the detail page shows the right next step).
   */
  const runPaystackCheckout = async (bookingId: string, onDone?: () => void) => {
    setPaymentInProgress(true);
    let popupResolved = false;
    try {
      const session = await initializePayment(bookingId);
      const result = await payWithPaystack({
        publicKey: session.public_key,
        email: session.email,
        amountKobo: session.amount_kobo,
        reference: session.reference,
        currency: session.currency,
        metadata: { booking_id: session.booking_id },
      });
      popupResolved = true;
      const verification = await verifyPayment(result.reference);
      if (verification.status === "success") {
        toast({ title: "Payment successful 🎉", description: "Funds are now held in escrow." });
        await queryClient.invalidateQueries({ queryKey: ["booking", bookingId] });
      } else {
        toast({ variant: "destructive", title: "Payment not confirmed", description: "If you were charged, your bank will reflect it shortly." });
      }
    } catch (e: any) {
      popupResolved = true;
      if (e?.message === PAYSTACK_CLOSED) {
        toast({ description: "Payment cancelled. You can pay later from this booking." });
      } else {
        toast({ variant: "destructive", title: "Payment failed", description: e?.message ?? "Something went wrong" });
      }
    } finally {
      setPaymentInProgress(false);
      // Hand off only once the popup has actually resolved; if preparing the
      // checkout failed before any popup, the caller's page is still valid.
      if (popupResolved) onDone?.();
    }
  };

  const handleCreateBooking = () => {
    if (!property) return;
    createBookingMutation.mutate({
      data: {
        property_id: property.id!,
        payment_method: paymentMethod as any,
        lease_start_date: leaseStartDate,
        lease_duration_days: parseInt(leaseDuration),
      },
    }, {
      onSuccess: (b) => {
        toast({ title: "Booking created", description: `Escrow ref: ${b.escrow_account_reference}` });
        if (!b.id) return;
        // Open Paystack now; navigate to the detail page once the popup
        // resolves so the next step (occupancy, or retry payment) is correct.
        void runPaystackCheckout(b.id, () => router.push(`/bookings/${b.id}`));
      },
      onError: (e: any) => toast({ variant: "destructive", title: "Failed to create booking", description: e.message }),
    });
  };

  const handleConfirmOccupancy = () => {
    if (!bookingId) return;
    confirmOccupancyMutation.mutate({
      id: bookingId,
      data: {
        occupancy_code: occupancyCode.toUpperCase(),
        ...(gpsCoords && { latitude: gpsCoords.lat, longitude: gpsCoords.lng }),
      },
    }, {
      onSuccess: () => {
        toast({ title: "Occupancy confirmed! 🏠", description: "Escrow will be released after the review period." });
        refetchBooking();
        setOccupancyCode("");
      },
      onError: (e: any) => toast({ variant: "destructive", title: "Verification failed", description: e.message }),
    });
  };

  const handleFileDispute = () => {
    if (!bookingId || !disputeDesc) return;
    fileDisputeMutation.mutate({
      id: bookingId,
      data: { reason: disputeReason as any, description: disputeDesc },
    }, {
      onSuccess: () => {
        toast({ title: "Dispute filed", description: "Our Escrow Officer will review within 5 business days." });
        setShowDispute(false);
        refetchBooking();
      },
      onError: (e: any) => toast({ variant: "destructive", title: "Failed to file dispute", description: e.message }),
    });
  };

  const handleRating = () => {
    if (!booking || !rating) return;
    createRatingMutation.mutate({
      data: {
        booking_id: (booking as any).id,
        ratee_id: (booking as any).landlord_id,
        rating_type: "student_rates_landlord",
        stars: rating,
        review_text: reviewText || undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Review submitted! ⭐" });
        setShowRating(false);
      },
      onError: () => toast({ variant: "destructive", title: "Failed to submit review" }),
    });
  };

  /**
   * Student authorizes the escrow release. The app records the approval, then
   * calls Paystack to move the actual money. Single click — no time gate.
   */
  const handleApproveRelease = async () => {
    if (!bookingId) return;
    setApprovingRelease(true);
    try {
      const token = localStorage.getItem("naub_token");
      const res = await fetch(`/api/bookings/${bookingId}/approve-release`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast({ title: "Payment released 🎉", description: "Funds are on their way to the landlord." });
      refetchBooking();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Couldn't release",
        description: e?.message ?? "Please try again",
      });
    } finally {
      setApprovingRelease(false);
    }
  };

  // ── NEW BOOKING FORM ────────────────────────────────────────────────────
  if (isNewBooking && property) {
    const leaseDays = parseInt(leaseDuration) || 365;
    const monthlyRent = property.rent_amount_ngn ?? 0;
    const deposit = property.deposit_amount_ngn ?? 0;
    const totalMonths = Math.ceil(leaseDays / 30);
    const totalAmount = monthlyRent * totalMonths + deposit;

    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <Link href={`/properties/${property.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 cursor-pointer">
            <ChevronLeft className="h-4 w-4" /> Back to property
          </Link>

          <h1 className="text-2xl font-bold mb-2">Confirm Your Booking</h1>
          <p className="text-muted-foreground mb-8">Your payment will be held in escrow until you confirm move-in.</p>

          {/* Property summary */}
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 mb-6">
            <h2 className="font-semibold mb-3">Property Summary</h2>
            <div className="flex gap-4">
              <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                <img
                  src={(property.photos?.[0]?.photo_url) || "/placeholder-house.svg"}
                  alt="Property"
                  className="w-full h-full object-cover"
                  onError={e => { (e.target as HTMLImageElement).src = "/placeholder-house.svg"; }}
                />
              </div>
              <div>
                <p className="font-medium text-sm">{property.address}</p>
                <p className="text-sm text-muted-foreground">{property.rooms} room(s)</p>
                <p className="text-lg font-bold mt-1">{formatNGN(monthlyRent)}<span className="text-sm font-normal text-muted-foreground">/month</span></p>
              </div>
            </div>
          </div>

          {/* Booking form */}
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-6 mb-6 space-y-5">
            <h2 className="font-semibold">Lease Details</h2>

            <div>
              <Label className="text-sm font-medium mb-1.5 block">Move-in Date</Label>
              <Input
                type="date"
                value={leaseStartDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={e => setLeaseStartDate(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-sm font-medium mb-1.5 block">Lease Duration</Label>
              <Select value={leaseDuration} onValueChange={setLeaseDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="90">3 Months</SelectItem>
                  <SelectItem value="180">6 Months</SelectItem>
                  <SelectItem value="365">1 Year</SelectItem>
                  <SelectItem value="730">2 Years</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium mb-1.5 block">Payment Method</Label>
              <div className="flex items-start gap-3 rounded-xl border border-[#EBEBEB] bg-[#FAFAFA] p-4">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#011B33" }}>
                  <CreditCard className="h-4 w-4 text-white" />
                </div>
                <div className="text-sm">
                  <p className="font-semibold text-foreground">Pay securely with Paystack</p>
                  <p className="text-muted-foreground mt-0.5">Card, bank transfer, or USSD — held in escrow until you confirm move-in.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Payment breakdown */}
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-6 mb-6">
            <h2 className="font-semibold mb-4">Payment Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Monthly rent × {totalMonths} months</span>
                <span className="font-medium">{formatNGN(monthlyRent * totalMonths)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Security deposit</span>
                <span className="font-medium">{formatNGN(deposit)}</span>
              </div>
              <div className="border-t border-[#EBEBEB] pt-2 mt-2 flex justify-between text-base">
                <span className="font-semibold">Total (held in escrow)</span>
                <span className="font-bold text-primary">{formatNGN(totalAmount)}</span>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <Shield className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <span>Payment is held securely in escrow. Released to landlord only after you confirm occupancy.</span>
            </div>
          </div>

          <Button
            className="w-full rounded-xl py-4 text-base font-semibold"
            style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
            onClick={handleCreateBooking}
            disabled={createBookingMutation.isPending || paymentInProgress}
          >
            {paymentInProgress
              ? "Redirecting to payment…"
              : createBookingMutation.isPending
                ? "Processing…"
                : "Confirm & Pay into Escrow"}
          </Button>
          <p className="text-xs text-center text-muted-foreground mt-3">
            By confirming, you agree to NAUB Homes' escrow terms and conditions.
          </p>
        </div>
      </div>
    );
  }

  // ── EXISTING BOOKING VIEW ─────────────────────────────────────────────────
  if (!booking) {
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-2/3 mx-auto" />
            <div className="h-32 bg-gray-200 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const b = booking as any;
  const statusConfig = BOOKING_STATUS_CONFIG[b.booking_status] ?? { label: b.booking_status, color: "#717171", desc: "" };
  const isStudent = user?.role === "student";
  const isLandlord = ["landlord", "agent"].includes(user?.role ?? "");

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-5 cursor-pointer">
          <ChevronLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        {/* Hero: property photo with status + address overlay */}
        <div className="relative rounded-2xl overflow-hidden border border-[#EBEBEB] shadow-sm mb-5">
          <div className="relative h-44 sm:h-56 bg-gray-100">
            <img
              src={propertyHero(b.property)}
              alt=""
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).src = "/placeholder-house.svg"; }}
            />
            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.12) 48%, rgba(0,0,0,0) 100%)" }} />
            <div className="absolute top-3 right-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white shadow-md"
                    style={{ background: statusConfig.color }}>
                <span className="w-1.5 h-1.5 rounded-full bg-white/90" />
                {statusConfig.label}
              </span>
            </div>
            <div className="absolute bottom-3 left-4 right-4 text-white">
              <h1 className="text-lg sm:text-xl font-bold leading-tight drop-shadow-sm">{b.property?.address ?? "Property"}</h1>
              <p className="text-[11px] text-white/80 mt-0.5">Booking ref · {b.escrow_account_reference}</p>
            </div>
          </div>
        </div>

        {/* Escrow progress stepper (hidden for non-linear statuses like disputed/cancelled) */}
        {(() => {
          const idx = ESCROW_STEPS.findIndex(s => s.key === b.booking_status);
          if (idx === -1) return null;
          return (
            <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 mb-5">
              <div className="flex items-center">
                {ESCROW_STEPS.map((s, i) => {
                  const done = i < idx;
                  const active = i === idx;
                  const isLast = i === ESCROW_STEPS.length - 1;
                  return (
                    <div key={s.key} className="flex items-center" style={{ flex: isLast ? "0 0 auto" : "1 1 auto" }}>
                      <div className="flex flex-col items-center" style={{ width: 56 }}>
                        <div className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                             style={{
                               background: done ? "#16A34A" : active ? "#FF5A5F" : "#EBEBEB",
                               color: done || active ? "#fff" : "#9A9A9A",
                               boxShadow: active ? "0 0 0 4px rgba(255,90,95,0.18)" : "none",
                             }}>
                          {done ? <CheckCircle className="h-4 w-4" /> : i + 1}
                        </div>
                        <span className="text-[10px] mt-1 text-center leading-tight"
                              style={{ color: active ? "#FF5A5F" : done ? "#16A34A" : "#9A9A9A", fontWeight: active || done ? 600 : 400 }}>
                          {s.label}
                        </span>
                      </div>
                      {!isLast && (
                        <div className="h-0.5 flex-1 mx-1 -mt-4 rounded-full"
                             style={{ background: i < idx ? "#16A34A" : "#EBEBEB" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Status description banner (color-coded) */}
        <div className="rounded-2xl border p-4 mb-5 flex items-start gap-3"
             style={{ background: statusConfig.color + "14", borderColor: statusConfig.color + "40" }}>
          {b.booking_status === "completed" ? (
            <CheckCircle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: statusConfig.color }} />
          ) : b.booking_status === "disputed" || b.booking_status === "release_failed" ? (
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: statusConfig.color }} />
          ) : b.booking_status === "release_pending" ? (
            <Loader2 className="h-5 w-5 mt-0.5 shrink-0 animate-spin" style={{ color: statusConfig.color }} />
          ) : (
            <Lock className="h-5 w-5 mt-0.5 shrink-0" style={{ color: statusConfig.color }} />
          )}
          <div>
            <p className="font-semibold text-sm" style={{ color: statusConfig.color }}>{statusConfig.label}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{statusConfig.desc}</p>
          </div>
        </div>

        {/* LANDLORD: share the occupancy code with the student. Only shown to
            the landlord (server gates the code per caller role) and only while
            there's still something for the student to confirm. */}
        {isLandlord && b.property?.occupancy_code && ["pending_occupancy", "pending_review"].includes(b.booking_status) && (
          <div className="bg-white rounded-2xl border-2 border-amber-300 p-5 mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="h-4 w-4 text-amber-600" />
              <h2 className="font-semibold text-sm">Share your occupancy code</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Send this 6-character code to {b.student?.first_name ?? "your student"} — by message, in person, or any
              channel they trust. They'll enter it on their booking page to confirm move-in and unlock the escrow release.
            </p>
            <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <div className="font-mono text-3xl font-bold tracking-[0.4em] text-amber-900 select-all">
                {b.property.occupancy_code}
              </div>
              {b.student?.id && (
                <Link href={`/messages/${b.student.id}`}>
                  <Button size="sm" className="gap-1 shrink-0" style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                    <MessageSquare className="h-3.5 w-3.5" /> Message {b.student?.first_name ?? "student"}
                  </Button>
                </Link>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Keep this code private — anyone with it can confirm the move-in.
            </p>
          </div>
        )}

        {/* Payment details */}
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 mb-5">
          <h2 className="font-semibold mb-3">Escrow Details</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly rent</span>
              <span className="font-medium">{formatNGN(b.rent_amount_ngn)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Deposit</span>
              <span className="font-medium">{formatNGN(b.deposit_amount_ngn)}</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-[#EBEBEB] pt-2">
              <span>Total in Escrow</span>
              <span className="text-primary">{formatNGN(b.total_amount_ngn)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Payment method</span>
              <span className="capitalize">{b.payment_method?.replace("_", " ")}</span>
            </div>
            {b.escrow_released_at && (
              <div className="flex justify-between text-xs text-green-600 font-medium">
                <span>Escrow released</span>
                <span>{new Date(b.escrow_released_at).toLocaleDateString()}</span>
              </div>
            )}
            {b.booking_status === "release_pending" && (
              <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 mt-0.5 animate-spin shrink-0" />
                <span>Transfer initiated — funds will appear in the landlord's account shortly.</span>
              </div>
            )}
            {b.booking_status === "release_failed" && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{friendlyReleaseError(b.payout_error)}</span>
              </div>
            )}
          </div>
        </div>

        {/* PAY INTO ESCROW (student, pending_payment) */}
        {isStudent && b.booking_status === "pending_payment" && (
          <div className="bg-white rounded-2xl border-2 border-primary p-6 mb-5">
            <h2 className="font-bold text-lg mb-1">💳 Complete your payment</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Your booking is reserved but not yet paid. Pay {formatNGN(b.total_amount_ngn)} into escrow to confirm it.
            </p>
            <Button
              className="w-full gap-2"
              style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
              disabled={paymentInProgress}
              onClick={() => runPaystackCheckout(b.id, () => router.push(`/bookings/${b.id}`))}
            >
              <CreditCard className="h-4 w-4" />
              {paymentInProgress ? "Opening Paystack…" : `Pay ${formatNGN(b.total_amount_ngn)} now`}
            </Button>
          </div>
        )}

        {/* OCCUPANCY VERIFICATION (student, pending_occupancy) */}
        {isStudent && b.booking_status === "pending_occupancy" && (
          <div className="bg-white rounded-2xl border-2 border-primary p-6 mb-5">
            <h2 className="font-bold text-lg mb-1">🏠 Confirm Your Move-in</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Enter the 6-character code your landlord gave you. Optionally share your GPS location for faster verification.
            </p>

            <div className="mb-4">
              <Label className="text-sm font-medium mb-1.5 block">Occupancy Code *</Label>
              <Input
                value={occupancyCode}
                onChange={e => setOccupancyCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB3XY7"
                maxLength={6}
                className="text-center text-2xl tracking-widest font-bold uppercase"
              />
            </div>

            {!useGPS ? (
              <Button type="button" variant="outline" size="sm" className="gap-2 mb-4" onClick={handleGetGPS}>
                <MapPin className="h-4 w-4" /> Share GPS Location (optional)
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-600 mb-4">
                <CheckCircle className="h-4 w-4" />
                <span>GPS location captured: {gpsCoords?.lat.toFixed(4)}, {gpsCoords?.lng.toFixed(4)}</span>
              </div>
            )}

            <Button
              className="w-full gap-2"
              style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
              onClick={handleConfirmOccupancy}
              disabled={occupancyCode.length !== 6 || confirmOccupancyMutation.isPending}
            >
              <Lock className="h-4 w-4" />
              {confirmOccupancyMutation.isPending ? "Verifying..." : "Confirm Occupancy"}
            </Button>
          </div>
        )}

        {/* APPROVE ESCROW RELEASE (student, pending_review) — the student
            authorizes the payment. The app records the approval; Paystack
            moves the actual money. Until they click, the landlord isn't paid. */}
        {isStudent && b.booking_status === "pending_review" && (
          <div className="bg-white rounded-2xl border-2 border-primary p-6 mb-5">
            <h2 className="font-bold text-lg mb-1">💸 Release Payment to Landlord</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Your move-in is confirmed and {formatNGN(b.total_amount_ngn)} is held in escrow.
              When you're satisfied, click to release it to {b.landlord?.first_name ?? "the landlord"}. Paystack handles the transfer.
            </p>
            <Button
              className="w-full gap-2"
              style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
              disabled={approvingRelease}
              onClick={handleApproveRelease}
            >
              <Lock className="h-4 w-4" />
              {approvingRelease ? "Releasing…" : `Release ${formatNGN(b.total_amount_ngn)} to landlord`}
            </Button>
          </div>
        )}

        {/* DISPUTE */}
        {isStudent && ["pending_occupancy", "pending_review"].includes(b.booking_status) && !showDispute && (
          <div className="mb-5">
            <button
              className="text-sm text-muted-foreground hover:text-destructive transition-colors underline-offset-2 hover:underline"
              onClick={() => setShowDispute(true)}
            >
              Problem with the property? File a dispute →
            </button>
          </div>
        )}

        {showDispute && (
          <div className="bg-white rounded-2xl border border-destructive/50 p-5 mb-5">
            <h2 className="font-semibold text-destructive mb-3">File a Dispute</h2>
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium mb-1.5 block">Reason</Label>
                <Select value={disputeReason} onValueChange={setDisputeReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="property_mismatch">Property doesn't match listing</SelectItem>
                    <SelectItem value="occupancy_not_verified">Cannot verify occupancy</SelectItem>
                    <SelectItem value="unresponsive">Landlord is unresponsive</SelectItem>
                    <SelectItem value="safety_concern">Safety concerns</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium mb-1.5 block">Description *</Label>
                <Textarea
                  value={disputeDesc}
                  onChange={e => setDisputeDesc(e.target.value)}
                  placeholder="Describe the issue in detail..."
                  rows={4}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowDispute(false)}>Cancel</Button>
                <Button
                  size="sm"
                  className="flex-1"
                  style={{ background: "#E1444A", color: "#fff", border: "none" }}
                  onClick={handleFileDispute}
                  disabled={!disputeDesc || fileDisputeMutation.isPending}
                >
                  {fileDisputeMutation.isPending ? "Filing..." : "File Dispute"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* RATING (student, completed) */}
        {isStudent && b.booking_status === "completed" && (
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Rate Your Experience</h2>
              {!showRating && (
                <Button size="sm" variant="outline" onClick={() => setShowRating(true)}>Leave a Review</Button>
              )}
            </div>
            {showRating && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Stars</Label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map(s => (
                      <button key={s} onClick={() => setRating(s)}>
                        <Star className={`h-7 w-7 transition-colors ${s <= rating ? "fill-primary text-primary" : "text-gray-300"}`} />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium mb-1.5 block">Review (optional)</Label>
                  <Textarea
                    value={reviewText}
                    onChange={e => setReviewText(e.target.value)}
                    placeholder="How was your experience with this landlord?"
                    rows={3}
                  />
                </div>
                <Button
                  className="w-full"
                  style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                  disabled={!rating || createRatingMutation.isPending}
                  onClick={handleRating}
                >
                  {createRatingMutation.isPending ? "Submitting..." : "Submit Review"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// useSearchParams() forces the surrounding page into a Suspense boundary
// for static prerender; this wrapper keeps the build happy.
export default function Booking() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F7F7F7]" />}>
      <BookingPage />
    </Suspense>
  );
}