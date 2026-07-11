import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { disputesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import type { DisputeDetail } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    const [d] = await db.select().from(disputesTable).where(eq(disputesTable.id, id)).limit(1);
    if (!d) return errorResponse("Dispute not found", 404);
    if (d.student_id !== me.id && d.landlord_id !== me.id && me.role !== "escrow_officer") {
      return errorResponse("Not authorized", 403);
    }
    const response: DisputeDetail = {
      id: d.id,
      booking_id: d.booking_id,
      student_id: d.student_id,
      landlord_id: d.landlord_id,
      reason: d.reason,
      description: d.description,
      dispute_status: d.dispute_status ?? "open",
      adjudication_decision: d.adjudication_decision ?? null,
      adjudication_notes: d.adjudication_notes ?? null,
      created_at: d.created_at?.toISOString() ?? null,
      resolved_at: d.resolved_at?.toISOString() ?? null,
    };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}