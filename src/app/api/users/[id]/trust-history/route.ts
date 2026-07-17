import { NextRequest } from "next/server";
import { getIntParam, getQueryParams, handleError, jsonResponse, errorResponse } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { getTrustHistory } from "@/lib/trust/service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    if (me.id !== id && me.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const query = getQueryParams(req);
    const page = getIntParam(query, "page", 1);
    const pageSize = Math.min(100, getIntParam(query, "page_size", 30));
    return jsonResponse(await getTrustHistory(id, Math.max(1, page), Math.max(1, pageSize)));
  } catch (err) { return handleError(err, req); }
}
