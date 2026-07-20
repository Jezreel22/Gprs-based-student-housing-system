import type { TrustLevel } from "./levels";

export type TrustRuleKey =
  | "email_verified"
  | "phone_verified"
  | "government_id_verified"
  | "profile_completed"
  | "transaction_completed"
  | "positive_review_received"
  | "negative_review_received"
  | "failed_identity_verification"
  | "transaction_dispute"
  | "fake_property_listing"
  | "spam_activity"
  | "booking_cancellation";

export type DerivedTrustRuleKey =
  | "account_age_six_months"
  | "no_reports_ninety_days"
  | "multiple_policy_violations";

export type AnyTrustRuleKey = TrustRuleKey | DerivedTrustRuleKey;

export interface TrustRule {
  key: AnyTrustRuleKey;
  points: number;
  bucket: "identity" | "property" | "transaction" | "ratings" | "fraud" | "tenure";
  label: string;
  derived?: boolean;
}

/**
 * Scoring policy in one place. Event rules are immutable ledger deltas; derived
 * rules are evaluated at recompute time from current platform facts.
 */
export const TRUST_RULES: Record<AnyTrustRuleKey, TrustRule> = {
  email_verified: { key: "email_verified", points: 5, bucket: "identity", label: "Email verified" },
  phone_verified: { key: "phone_verified", points: 10, bucket: "identity", label: "Phone number verified" },
  government_id_verified: { key: "government_id_verified", points: 20, bucket: "identity", label: "Government ID verified" },
  profile_completed: { key: "profile_completed", points: 5, bucket: "identity", label: "Profile completed" },
  transaction_completed: { key: "transaction_completed", points: 5, bucket: "transaction", label: "Successful property transaction" },
  positive_review_received: { key: "positive_review_received", points: 2, bucket: "ratings", label: "Positive review received" },
  negative_review_received: { key: "negative_review_received", points: -2, bucket: "ratings", label: "Negative review received" },
  failed_identity_verification: { key: "failed_identity_verification", points: -20, bucket: "fraud", label: "Failed identity verification" },
  transaction_dispute: { key: "transaction_dispute", points: -15, bucket: "transaction", label: "Transaction dispute" },
  fake_property_listing: { key: "fake_property_listing", points: -20, bucket: "property", label: "Fake property listing" },
  spam_activity: { key: "spam_activity", points: -30, bucket: "fraud", label: "Spam activity" },
  booking_cancellation: { key: "booking_cancellation", points: -5, bucket: "transaction", label: "Booking cancellation" },
  account_age_six_months: { key: "account_age_six_months", points: 5, bucket: "tenure", label: "Account older than six months", derived: true },
  no_reports_ninety_days: { key: "no_reports_ninety_days", points: 5, bucket: "tenure", label: "No substantiated reports for 90 days", derived: true },
  multiple_policy_violations: { key: "multiple_policy_violations", points: -25, bucket: "fraud", label: "Multiple policy violations", derived: true },
};

export const POLICY_VIOLATION_THRESHOLD = 2;
export const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Default decay window per negative event rule. NULL means the event never
 * expires (positive rules, and a few negatives that should stick). Callers
 * resolve expiry via `defaultExpiryForRule(ruleKey, pointsDelta)`. Keep these
 * values in sync with the SQL backfill in
 * drizzle/0001_trust_event_expiry.sql.
 */
const DEFAULT_EXPIRY_MS: Partial<Record<TrustRuleKey, number>> = {
  failed_identity_verification: 365 * 24 * 60 * 60 * 1000, // 12 months
  transaction_dispute: 547 * 24 * 60 * 60 * 1000,         // 18 months
  fake_property_listing: 730 * 24 * 60 * 60 * 1000,       // 24 months
  spam_activity: 730 * 24 * 60 * 60 * 1000,               // 24 months
};

/**
 * Returns the default expiry timestamp for a freshly recorded event. Positive
 * rules never expire; rules not in DEFAULT_EXPIRY_MS (e.g. cancellations,
 * negative reviews) keep their weight indefinitely.
 */
export function defaultExpiryForRule(ruleKey: TrustRuleKey, pointsDelta: number, now: Date = new Date()): Date | null {
  if (pointsDelta >= 0) return null;
  const ms = DEFAULT_EXPIRY_MS[ruleKey];
  if (ms == null) return null;
  return new Date(now.getTime() + ms);
}

/**
 * True if an event is past its expiry at `now`. Events with `expires_at == null`
 * never expire. Inactive events are not "expired" — they're explicitly
 * deactivated, a different state — so this returns false for them and lets the
 * recompute's `active=true` filter handle them.
 */
export function isEventExpired(event: { active: boolean; expires_at: Date | null }, now: Date = new Date()): boolean {
  if (!event.active) return false;
  if (event.expires_at == null) return false;
  return event.expires_at.getTime() <= now.getTime();
}

export function isTrustRuleKey(key: string): key is TrustRuleKey {
  return key in TRUST_RULES && !TRUST_RULES[key as AnyTrustRuleKey].derived;
}

export function trustRuleForRating(stars: number): TrustRuleKey | null {
  if (stars >= 4) return "positive_review_received";
  if (stars <= 2) return "negative_review_received";
  return null;
}

export function trustLevelMetadata(): Array<{ level: TrustLevel; min: number; max: number; label: string }> {
  return [
    { level: "highly_trusted", min: 90, max: 100, label: "Highly Trusted" },
    { level: "trusted", min: 70, max: 89, label: "Trusted" },
    { level: "average", min: 50, max: 69, label: "Average" },
    { level: "low_trust", min: 30, max: 49, label: "Low Trust" },
    { level: "high_risk", min: 0, max: 29, label: "High Risk" },
  ];
}
