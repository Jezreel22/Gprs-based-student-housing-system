import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, ratingsTable, trustEventsTable, trustReportsTable, trustScoresTable, usersTable } from "@/lib/db/schema";
import { clampTrustScore, TRUST_BASELINE, trustLevelForScore, type TrustLevel } from "./levels";
import { isTrustRuleKey, NINETY_DAYS_MS, POLICY_VIOLATION_THRESHOLD, SIX_MONTHS_MS, TRUST_RULES, type TrustRuleKey } from "./rules";

export class TrustError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "TrustError"; }
}

export async function recordTrustEvent(args: {
  userId: string; ruleKey: TrustRuleKey; sourceType: string; sourceId?: string | null;
  dedupeKey: string; actorId?: string | null; reason?: string; details?: Record<string, unknown>;
}): Promise<{ inserted: boolean; score: number; level: TrustLevel }> {
  if (!isTrustRuleKey(args.ruleKey)) throw new TrustError("invalid_rule", "Unknown trust rule");
  const rule = TRUST_RULES[args.ruleKey];
  const rows = await db.insert(trustEventsTable).values({
    user_id: args.userId, rule_key: rule.key, points_delta: rule.points,
    source_type: args.sourceType, source_id: args.sourceId ?? null, dedupe_key: args.dedupeKey,
    actor_id: args.actorId ?? null, reason: args.reason ?? rule.label, details: args.details ?? {},
  }).onConflictDoNothing({ target: trustEventsTable.dedupe_key }).returning({ id: trustEventsTable.id });
  const projection = await recomputeTrustScore(args.userId);
  return {
    inserted: rows.length > 0,
    score: projection.total_score ?? TRUST_BASELINE,
    level: (projection.trust_level as TrustLevel | null) ?? "average",
  };
}

export async function deactivateTrustEvent(dedupeKey: string): Promise<void> {
  const [event] = await db.update(trustEventsTable).set({ active: false }).where(eq(trustEventsTable.dedupe_key, dedupeKey)).returning();
  if (event) await recomputeTrustScore(event.user_id);
}

export async function recomputeTrustScore(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) throw new TrustError("not_found", "User not found");

  const [allEvents, receivedRatings, completedBookings, reports] = await Promise.all([
    db.select().from(trustEventsTable).where(and(eq(trustEventsTable.user_id, userId), eq(trustEventsTable.active, true))),
    db.select().from(ratingsTable).where(eq(ratingsTable.ratee_id, userId)),
    db.select({ id: bookingsTable.id }).from(bookingsTable).where(and(eq(bookingsTable.booking_status, "completed"), inArray(bookingsTable.student_id, [userId]))).then(async (s) => {
      const l = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(and(eq(bookingsTable.booking_status, "completed"), inArray(bookingsTable.landlord_id, [userId])));
      return [...s, ...l];
    }),
    db.select().from(trustReportsTable).where(and(eq(trustReportsTable.target_user_id, userId), eq(trustReportsTable.status, "substantiated"))),
  ]);

  // Filter out events that have passed their expiry date. They remain in the
  // ledger (active=true) so the history UI can show them with an `expired` flag,
  // but they must not contribute to the live score.
  const now = new Date();
  const events = allEvents.filter(
    (e) => e.expires_at == null || e.expires_at > now,
  );

  const byBucket = { identity: 0, property: 0, transaction: 0, ratings: 0, fraud: 0, tenure: 0 };
  for (const event of events) {
    const rule = TRUST_RULES[event.rule_key as keyof typeof TRUST_RULES];
    if (rule) byBucket[rule.bucket] += event.points_delta;
  }

  const nowMs = now.getTime();
  if (user.created_at && nowMs - user.created_at.getTime() >= SIX_MONTHS_MS) {
    byBucket.tenure += TRUST_RULES.account_age_six_months.points;
  }
  const latestReport = reports.sort((a, b) => (b.resolved_at?.getTime() ?? 0) - (a.resolved_at?.getTime() ?? 0))[0];
  if (!latestReport || nowMs - (latestReport.resolved_at?.getTime() ?? latestReport.created_at.getTime()) >= NINETY_DAYS_MS) {
    byBucket.tenure += TRUST_RULES.no_reports_ninety_days.points;
  }
  const policyCount = reports.filter((r) => r.report_type === "policy_violation").length;
  if (policyCount >= POLICY_VIOLATION_THRESHOLD) byBucket.fraud += TRUST_RULES.multiple_policy_violations.points;

  // Total = baseline + all bucket contributions. Derived tenure/fraud adjustments
  // are already accumulated inside byBucket, so we sum all buckets once.
  const bucketSum = Object.values(byBucket).reduce((a, b) => a + b, 0);
  const total = clampTrustScore(TRUST_BASELINE + bucketSum);
  const level = trustLevelForScore(total);
  const avg = receivedRatings.length ? receivedRatings.reduce((sum, r) => sum + r.stars, 0) / receivedRatings.length : 0;

  const projection = {
    user_id: userId, total_score: total, trust_level: level,
    identity_verification_points: byBucket.identity, property_verification_points: byBucket.property,
    transaction_completion_points: byBucket.transaction, ratings_average_points: byBucket.ratings,
    fraud_report_deduction: byBucket.fraud, tenure_bonus_points: byBucket.tenure,
    total_transactions: completedBookings.length, completed_transactions: completedBookings.length,
    average_rating: avg, fraud_reports_count: reports.length, last_recomputed_at: now,
  };
  const [saved] = await db.insert(trustScoresTable).values(projection).onConflictDoUpdate({ target: trustScoresTable.user_id, set: projection }).returning();
  return saved;
}

export async function getTrustScore(userId: string) {
  const [row] = await db.select().from(trustScoresTable).where(eq(trustScoresTable.user_id, userId)).limit(1);
  return row ?? recomputeTrustScore(userId);
}

export async function getTrustHistory(userId: string, page = 1, pageSize = 30) {
  const score = await getTrustScore(userId);
  const rawEvents = await db
    .select()
    .from(trustEventsTable)
    .where(eq(trustEventsTable.user_id, userId))
    .orderBy(desc(trustEventsTable.created_at))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const now = new Date();
  const events = rawEvents.map((e) => ({
    ...e,
    expired: e.active && e.expires_at != null && e.expires_at <= now,
  }));
  return { score, events, page, page_size: pageSize };
}

function isProfileComplete(user: { first_name?: string | null; last_name?: string | null; phone_number?: string | null; profile_photo_url?: string | null }): boolean {
  return Boolean(user.first_name && user.last_name && user.phone_number && user.profile_photo_url);
}

/**
 * Award the profile-completion bonus exactly once. Idempotent: once the
 * `profile_completed` event exists it won't be re-awarded on later edits, and
 * the first time the profile becomes complete we stamp `profile_completed_at`.
 */
export async function maybeAwardProfileCompletion(userId: string): Promise<void> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user || !isProfileComplete(user)) return;
  const [existing] = await db.select({ id: trustEventsTable.id })
    .from(trustEventsTable)
    .where(and(eq(trustEventsTable.user_id, userId), eq(trustEventsTable.rule_key, "profile_completed")))
    .limit(1);
  if (existing) return;
  if (!user.profile_completed_at) {
    await db.update(usersTable).set({ profile_completed_at: new Date() }).where(eq(usersTable.id, userId));
  }
  await recordTrustEvent({
    userId,
    ruleKey: "profile_completed",
    sourceType: "user",
    sourceId: userId,
    dedupeKey: `profile-completed:${userId}`,
    reason: "Profile completed",
  });
}
