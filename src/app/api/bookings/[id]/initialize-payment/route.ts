import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import {
  amountToKobo,
  assertConfigured,
  newPaymentReference,
} from "@/lib/paystack-server";

/**
 * POST /api/bookings/:id/initialize-payment
 *
 * Prepares a Paystack inline-checkout session for an existing pending
 * booking. The amount, email and reference are all server-derived; the
 * client uses them to open the popup and then calls /api/payments/verify
 * with the resulting reference. Verification (and the HMAC-signed webhook)
 * is what actually flips the booking to `pending_occupancy`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id: bookingId } = await ctx.params;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.student_id !== me.id) return errorResponse("Forbidden", 403);

    if (booking.payment_method !== "paystack" && booking.payment_method !== null) {
      // Allow re-initializing a booking that was created before its method was set,
      // but reject anything that's clearly on a different gateway (e.g. bank_transfer).
      return errorResponse("Booking payment method is not supported for online checkout", 409);
    }

    if (booking.booking_status !== "pending_payment") {
      return errorResponse(`Booking cannot be paid (status: ${booking.booking_status})`, 409);
    }

    assertConfigured();

    const reference = newPaymentReference(booking.id);
    const amountKobo = amountToKobo(booking.total_amount_ngn);

    // Persist the prepared reference so verify/webhook can match it back.
    await db
      .update(bookingsTable)
      .set({
        payment_method: "paystack",
        payment_transaction_id: reference,
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, booking.id));

    return jsonResponse({
      reference,
      public_key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
      email: me.email,
      amount_kobo: amountKobo,
      currency: "NGN",
      booking_id: booking.id,
    });
  } catch (err) {
    return handleError(err, req);
  }
}
