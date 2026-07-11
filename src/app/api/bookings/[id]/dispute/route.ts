import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, disputesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";

const FileDisputeBody = z.object({
  reason: z.enum(["property_mismatch", "occupancy_not_verified", "unresponsive", "safety_concern", "other"]),
  description: z.string().min(10),
  refund_request: z.enum(["full", "partial", "officer_decides"]).optional(),
  refund_amount: z.number().int().nonnegative().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.student_id !== me.id) return errorResponse("Only the student can file a dispute", 403);
    if (!["pending_occupancy", "pending_review"].includes(booking.booking_status ?? "")) {
      return errorResponse(`Cannot file a dispute from status "${booking.booking_status}"`, 409);
    }

    const body = await parseBody(req, FileDisputeBody);

    await db.insert(disputesTable).values({
      booking_id: id,
      student_id: booking.student_id,
      landlord_id: booking.landlord_id,
      reason: body.reason,
      description: body.description,
      dispute_status: "open",
    });

    await db.update(bookingsTable)
      .set({
        dispute_filed_at: new Date(),
        dispute_status: "open",
        booking_status: "disputed",
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, id));

    return jsonResponse({ message: "Dispute filed. Escrow Officer will review within 5 business days." }, { status: 201 });
  } catch (err) {
    return handleError(err, req);
  }
}