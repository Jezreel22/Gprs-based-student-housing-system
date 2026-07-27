import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse, handleError, jsonResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { escrowReceiptsTable, escrowTransactionsTable } from "@/lib/db/schema";
import { canViewReceipt } from "@/lib/escrow-transactions/access";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET /api/receipts/[id]
 *
 * Authorised receipt detail. Always returns the immutable stored snapshot
 * — the snapshot is the source of truth for the rendered document, so the
 * client (and the PDF route) cannot pull different fields at different
 * times.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req);
    if (user.role === "agent") return errorResponse("Forbidden", 403);

    const { id } = await params;
    const allowed = await canViewReceipt(user, id);
    if (!allowed) return errorResponse("Not found", 404);

    const [receipt] = await db
      .select()
      .from(escrowReceiptsTable)
      .where(eq(escrowReceiptsTable.id, id))
      .limit(1);
    if (!receipt) return errorResponse("Not found", 404);

    const [transaction] = await db
      .select()
      .from(escrowTransactionsTable)
      .where(eq(escrowTransactionsTable.id, receipt.transaction_id))
      .limit(1);

    await writeAudit({
      req,
      actorId: user.id,
      actionType: "receipt_viewed",
      resourceType: "escrow_receipt",
      resourceId: receipt.id,
      details: {
        booking_id: receipt.booking_id,
        receipt_number: receipt.receipt_number,
      },
    });

    return jsonResponse({
      receipt,
      transaction,
    });
  } catch (err) {
    return handleError(err, req);
  }
}