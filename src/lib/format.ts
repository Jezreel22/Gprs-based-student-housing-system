/**
 * Small mappers between Drizzle DB rows and the API schema shapes.
 * The two diverge in optionality: Drizzle uses `T | null` for nullable
 * columns, while the generated API types use `T | undefined`.
 */
import type { TrustScore } from "@/api/generated/api.schemas";

export function formatTrustScore(row: {
  user_id?: string | null;
  total_score?: number | null;
  identity_verification_points?: number | null;
  property_verification_points?: number | null;
  transaction_completion_points?: number | null;
  ratings_average_points?: number | null;
  fraud_report_deduction?: number | null;
  tenure_bonus_points?: number | null;
  total_transactions?: number | null;
  completed_transactions?: number | null;
  average_rating?: number | null;
  fraud_reports_count?: number | null;
  trust_level?: string | null;
  last_recomputed_at?: Date | null;
} | null | undefined): TrustScore | undefined {
  if (!row) return undefined;
  return {
    user_id: row.user_id ?? undefined,
    total_score: row.total_score ?? 50,
    identity_verification_points: row.identity_verification_points ?? 0,
    property_verification_points: row.property_verification_points ?? 0,
    transaction_completion_points: row.transaction_completion_points ?? 0,
    ratings_average_points: row.ratings_average_points ?? 0,
    fraud_report_deduction: row.fraud_report_deduction ?? 0,
    tenure_bonus_points: row.tenure_bonus_points ?? 0,
    total_transactions: row.total_transactions ?? 0,
    completed_transactions: row.completed_transactions ?? 0,
    average_rating: row.average_rating ?? 0,
    fraud_reports_count: row.fraud_reports_count ?? 0,
    trust_level: row.trust_level === "highly_trusted" || row.trust_level === "trusted" || row.trust_level === "average" || row.trust_level === "low_trust" || row.trust_level === "high_risk" ? row.trust_level : "average",
    last_recomputed_at: row.last_recomputed_at?.toISOString() ?? null,
  };
}