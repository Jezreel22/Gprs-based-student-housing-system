import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse, handleError } from "@/lib/api";
import { db } from "@/lib/db";
import { escrowReceiptsTable } from "@/lib/db/schema";
import { canViewReceipt } from "@/lib/escrow-transactions/access";
import { renderReceiptPdfBuffer, type ReceiptSnapshot } from "@/lib/escrow-receipts/render";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET /api/receipts/[id]/pdf
 *
 * Streams the official PDF receipt. Always rendered from the immutable
 * stored snapshot so historical receipts cannot be modified after the fact.
 *
 * Headers:
 *   - Content-Type: application/pdf
 *   - Content-Disposition: attachment; filename="<receipt-number>.pdf"
 *   - Cache-Control: private, no-store
 *
 * Every authenticated download is audit-logged.
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

    const snapshot = receipt.snapshot as unknown as ReceiptSnapshot;
    if (!snapshot?.receipt_number) {
      return errorResponse("Receipt snapshot is malformed", 500);
    }

    const buffer = await renderReceiptPdfBuffer(snapshot);

    await writeAudit({
      req,
      actorId: user.id,
      actionType: "receipt_downloaded",
      resourceType: "escrow_receipt",
      resourceId: receipt.id,
      details: {
        booking_id: receipt.booking_id,
        receipt_number: receipt.receipt_number,
        bytes: buffer.byteLength,
      },
    });

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(buffer.byteLength),
        "content-disposition": `attachment; filename="${receipt.receipt_number}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return handleError(err, req);
  }
}