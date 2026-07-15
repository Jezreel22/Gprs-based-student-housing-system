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
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Lock, MapPin, CheckCircle, AlertCircle, Star, Shield, CreditCard, Loader2 } from "lucide-react";

function formatNGN(n?: number | null) {
  return n ? `₦${n.toLocaleString("en-NG")}` : "₦—";
}

const BOOKING_STATUS_CONFIG: Record<string, { label: string; color: string; desc: string }> = {
  pending_payment: { label: "Awaiting Payment", color: "#717171", desc: "This booking is reserved. Complete your Paystack payment to move it into escrow." },
  pending_occupancy: { label: "Awaiting Occupancy Verification", color: "#FF5A5F", desc: "Enter the 6-character code your landlord gave you to confirm you've moved in." },
  pending_review: { label: "Verified — Awaiting Escrow Release", color: "#F57F17", desc: "Occupancy confirmed! Funds will be released to the landlord after the review period." },
  release_pending: { label: "Payout In Progress", color: "#1565C0", desc: "Your escrow funds are being transferred to the landlord." },
  release_failed: { label: "Payout Needs Attention", color: "#E1444A", desc: "The payout to the landlord didn't go through. An officer will retry." },
  completed: { label: "Completed", color: "#34A853", desc: "This booking is complete. Escrow has been released." },
  cancelled: { label: "Cancelled", color: "#717171", desc: "This booking was cancelled." },
  disputed: { label: "Disputed", color: "#E1444A", desc: "A dispute is under investigation by our Escrow Officer." },
};

// Translate a raw Paystack error into a student/landlord-safe message.
// Never expose raw gateway text — it can include internal codes.
function friendlyReleaseError(raw: string | null | undefined): string {
  const lower = (raw ?? "").toLowerCase();
  if (!lower) return "There was a problem sending the payout. An officer is reviewing this booking.";
  if (lower.includes("insufficient")) return "The platform balance couldn't cover the payout. An officer will retry shortly.";
  if (lower.includes("recipient") || lower.includes("account") || lower.includes("invalid"))
    return "The landlord's bank account couldn't be credited. An officer will review and follow up.";
  return "There was a problem sending the payout. An officer is reviewing this booking.";
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
                  src={`https://picsum.photos/seed/${property.id?.substring(0,8)}/160/160`}
                  alt="Property"
                  className="w-full h-full object-cover"
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

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 cursor-pointer">
          <ChevronLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Booking Details</h1>
            <p className="text-xs text-muted-foreground mt-1">Ref: {b.escrow_account_reference}</p>
          </div>
          <Badge style={{ background: statusConfig.color + "20", color: statusConfig.color, border: "none" }}>
            {statusConfig.label}
          </Badge>
        </div>

        {/* Status description */}
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 mb-5">
          <div className="flex items-start gap-3">
            {b.booking_status === "completed" ? (
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
            ) : b.booking_status === "disputed" ? (
              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            ) : (
              <Lock className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-sm mb-1">{statusConfig.label}</p>
              <p className="text-sm text-muted-foreground">{statusConfig.desc}</p>
            </div>
          </div>
        </div>

        {/* Property info */}
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 mb-5">
          <h2 className="font-semibold mb-3">Property</h2>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0">
              <img src={`https://picsum.photos/seed/${b.property?.id?.substring(0,8)}/160/160`} alt="" className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="font-medium text-sm">{b.property?.address}</p>
              <p className="text-sm text-muted-foreground">{b.property?.rooms} room(s)</p>
            </div>
          </div>
        </div>

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
              onClick={() => runPaystackCheckout(b.id)}
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