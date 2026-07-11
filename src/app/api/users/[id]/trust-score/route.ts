import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { trustScoresTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import { formatTrustScore } from "@/lib/format";
import type { TrustScore } from "@/api/generated/api.schemas";

/**
 * Stub trust-score lookup. The original backend ran a complex scoring
 * algorithm; for now we return the stored row if any, or a zero default.
 * Real recomputation can be plugged in once the algorithm is finalized.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const [ts] = await db.select().from(trustScoresTable).where(eq(trustScoresTable.user_id, id)).limit(1);

    const response: TrustScore = formatTrustScore(ts) ?? {
      user_id: id,
      total_score: 0,
      identity_verification_points: 0,
      property_verification_points: 0,
      transaction_completion_points: 0,
      ratings_average_points: 0,
      fraud_report_deduction: 0,
      tenure_bonus_points: 0,
      total_transactions: 0,
      completed_transactions: 0,
      average_rating: 0,
      fraud_reports_count: 0,
      last_recomputed_at: null,
    };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}