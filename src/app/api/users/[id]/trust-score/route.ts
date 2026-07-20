import { NextRequest } from "next/server";
import { handleError, jsonResponse } from "@/lib/api";
import { getTrustScore } from "@/lib/trust/service";
import { formatTrustScore } from "@/lib/format";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Public: a user's trust score is a reputation signal (points, transaction
    // count, average rating) — no PII — so logged-out visitors can view a
    // landlord's breakdown before deciding to book. The event *history*
    // (/trust-history) stays auth-gated since it carries actor + reason detail.
    const { id } = await params;
    return jsonResponse(formatTrustScore(await getTrustScore(id)));
  } catch (err) { return handleError(err, req); }
}
