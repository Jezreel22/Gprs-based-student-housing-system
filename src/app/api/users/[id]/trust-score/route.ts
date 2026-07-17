import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import { getTrustScore } from "@/lib/trust/service";
import { formatTrustScore } from "@/lib/format";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    return jsonResponse(formatTrustScore(await getTrustScore(id)));
  } catch (err) { return handleError(err, req); }
}
