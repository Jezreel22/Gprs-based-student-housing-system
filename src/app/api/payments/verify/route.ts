import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { verifyTransaction } from "@/lib/paystack-server";
import { markBookingPaid } from "@/lib/payment-marks";

const VerifyBody = z.object({ reference: z.string().min(1).max(100) });

/**
 * POST /api/payments/verify
 *
 * Client-driven confirmation after the Paystack inline popup reports a
 * successful charge. We re-fetch the live status from Paystack, enforce that
 * the amount matches our booking total, then idempotently flip the booking
 * to `pending_occupancy`. The HMAC-signed webhook remains the source of
 * truth; this route just lets the UI update without waiting for it.
 */
export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const body = VerifyBody.parse(await req.json());

    const result = await verifyTransaction(body.reference);

    if (result.status !== "success" || result.amountKobo == null) {
      return jsonResponse({ status: result.status });
    }

    // Resolve the booking via the reference our initialize-payment stored,
    // ignoring any metadata Paystack may (or may not) echo back.
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.payment_transaction_id, body.reference))
      .limit(1);

    if (!booking) return errorResponse("No booking matches that reference", 404);
    if (booking.student_id !== me.id) return errorResponse("Forbidden", 403);

    if (result.amountKobo !== booking.total_amount_ngn * 100) {
      // Tampering / misconfigured gateway / stale reference — never mark paid.
      return errorResponse("Paid amount does not match booking total", 409);
    }

    await markBookingPaid({ bookingId: booking.id, reference: body.reference });
    return jsonResponse({ status: "success" });
  } catch (err) {
    return handleError(err, req);
  }
}
