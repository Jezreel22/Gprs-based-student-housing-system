import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { disputesTable, bookingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";

const AdjudicateBody = z.object({
  decision: z.enum(["dismissed", "partial_refund", "full_refund", "fraud_substantiated"]),
  adjudication_notes: z.string().min(10),
  refund_percentage_to_student: z.number().int().min(0).max(100).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") throw new Error("Forbidden");
    const { id } = await params;
    const [d] = await db.select().from(disputesTable).where(eq(disputesTable.id, id)).limit(1);
    if (!d) return errorResponse("Dispute not found", 404);

    const body = await parseBody(req, AdjudicateBody);

    await db.update(disputesTable)
      .set({
        adjudication_decision: body.decision,
        adjudication_notes: body.adjudication_notes,
        refund_percentage_to_student: body.refund_percentage_to_student ?? null,
        escrow_officer_id: officer.id,
        dispute_status: "resolved",
        resolved_at: new Date(),
      })
      .where(eq(disputesTable.id, id));

    // Update the booking's status + dispute_outcome + (eventually) release escrow
    const newBookingStatus = body.decision === "dismissed"
      ? "completed" // landlord wins → escrow releases
      : body.decision === "fraud_substantiated"
        ? "cancelled"
        : "completed"; // partial/full refund also marks the booking flow complete

    const escrowReleased = body.decision === "dismissed" || body.decision === "partial_refund" || body.decision === "full_refund";

    await db.update(bookingsTable)
      .set({
        dispute_status: "resolved",
        dispute_adjudication_date: new Date(),
        dispute_outcome: body.decision,
        booking_status: newBookingStatus,
        escrow_released_at: escrowReleased ? new Date() : null,
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, d.booking_id));

    return jsonResponse({ message: "Dispute adjudicated" });
  } catch (err) {
    return handleError(err, req);
  }
}