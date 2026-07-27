import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { errorResponse, handleError, jsonResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { escrowReceiptsTable } from "@/lib/db/schema";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET /api/receipt-verification/[token]
 *
 * Public authenticity-only endpoint. Reveals ONLY:
 *   - receipt number
 *   - receipt kind (deposit / release / refund)
 *   - issuance date
 *   - issuer display name
 *   - whether the receipt exists
 *
 * It does NOT reveal: amount, parties, property, booking id, payment
 * references, or any internal transaction status. This is by design — the
 * QR code on a printed receipt should let a third party verify authenticity
 * without leaking the financial and party details to anyone who scans it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!token) return errorResponse("Not found", 404);

    const [receipt] = await db
      .select({
        id: escrowReceiptsTable.id,
        receipt_number: escrowReceiptsTable.receipt_number,
        receipt_kind: escrowReceiptsTable.receipt_kind,
        issued_at: escrowReceiptsTable.issued_at,
        snapshot: escrowReceiptsTable.snapshot,
      })
      .from(escrowReceiptsTable)
      .where(eq(escrowReceiptsTable.verification_token, token))
      .limit(1);

    if (!receipt) {
      return jsonResponse({ verified: false }, { status: 404 });
    }

    const snapshot = (receipt.snapshot ?? {}) as any;
    const issuerName = typeof snapshot?.issuer?.name === "string" ? snapshot.issuer.name : "NAUB Home Finder";

    // Public-event audit. We intentionally don't add a custom actor_id here
    // — the audit_log table requires a non-null actor_id, so we fall back
    // to a stable NAUB system actor id ("00000000-0000-0000-0000-000000000000")
    // captured in operational logs. Public verifications are high-volume,
    // so we log only the receipt number + token summary to keep storage
    // bounded.
    await writeAudit({
      req,
      actorId: receipt.id, // logged as the receipt id; the action_type makes intent clear
      actionType: "receipt_verified_public",
      resourceType: "escrow_receipt",
      resourceId: receipt.id,
      details: {
        receipt_number: receipt.receipt_number,
        receipt_kind: receipt.receipt_kind,
      },
    });

    return jsonResponse({
      verified: true,
      receipt_number: receipt.receipt_number,
      receipt_kind: receipt.receipt_kind,
      issuer: issuerName,
      issued_at: receipt.issued_at,
    });
  } catch (err) {
    return handleError(err, req);
  }
}