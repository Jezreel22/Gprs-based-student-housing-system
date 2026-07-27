import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse, handleError, jsonResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { escrowReceiptsTable } from "@/lib/db/schema";
import { canViewReceipt } from "@/lib/escrow-transactions/access";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST /api/receipts/[id]/share
 *
 * Returns the public verification URL for a receipt. The URL is *only* the
 * QR verification path — never the receipt id or a private download URL.
 * The route intentionally never returns a private PDF URL.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Issuer site URL is already snapshotted into the receipt — re-derive
    // the public URL by stripping the token into the canonical path. The
    // snapshot's stored URL is preferred when present.
    const snapshot = receipt.snapshot as any;
    const verificationUrl: string =
      (typeof snapshot?.verification_url === "string" && snapshot.verification_url) ||
      `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://www.naubhomefinder.app").replace(/\/$/, "")}/verify/receipt/${receipt.verification_token}`;

    await writeAudit({
      req,
      actorId: user.id,
      actionType: "receipt_shared",
      resourceType: "escrow_receipt",
      resourceId: receipt.id,
      details: {
        booking_id: receipt.booking_id,
        receipt_number: receipt.receipt_number,
      },
    });

    return jsonResponse({
      verification_url: verificationUrl,
      verification_token: receipt.verification_token,
    });
  } catch (err) {
    return handleError(err, req);
  }
}