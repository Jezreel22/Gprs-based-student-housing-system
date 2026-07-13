import { NextRequest } from "next/server";
import { listBanks } from "@/lib/paystack-server";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";

/**
 * GET /api/banks — Nigerian bank list (code + name) for the landlord payout
 * form. Backed by Paystack's `bank` endpoint with a short in-memory cache.
 * Any authenticated user may read it.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const banks = await listBanks();
    return jsonResponse({ data: banks });
  } catch (err) {
    return handleError(err, req);
  }
}
