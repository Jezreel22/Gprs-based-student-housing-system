import { NextRequest } from "next/server";
import { errorResponse, handleError, jsonResponse } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { getTrustScore } from "@/lib/trust/service";
import { trustLevelMetadata } from "@/lib/trust/rules";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    if (me.id !== id && me.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const score = await getTrustScore(id);
    return jsonResponse({ user_id: id, total_score: score.total_score ?? 50, trust_level: score.trust_level ?? "average", levels: trustLevelMetadata() });
  } catch (err) { return handleError(err, req); }
}
