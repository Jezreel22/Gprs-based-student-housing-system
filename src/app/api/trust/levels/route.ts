import { NextRequest } from "next/server";
import { jsonResponse, handleError } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { trustLevelMetadata } from "@/lib/trust/rules";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); return jsonResponse({ baseline: 50, levels: trustLevelMetadata() }); }
  catch (err) { return handleError(err, req); }
}
