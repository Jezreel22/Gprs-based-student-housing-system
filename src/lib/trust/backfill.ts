import "@/lib/load-env";
import { db } from "@/lib/db";
import { bookingsTable, ratingsTable, usersTable } from "@/lib/db/schema";
import { maybeAwardProfileCompletion, recordTrustEvent, recomputeTrustScore } from "@/lib/trust/service";
import { trustRuleForRating } from "@/lib/trust/rules";

// Per-rule counters so the run summary shows exactly what was emitted —
// useful for confirming historical users finally got credited.
const emitted: Record<string, number> = {};
const count = (rule: string, inserted: boolean) => { if (inserted) emitted[rule] = (emitted[rule] ?? 0) + 1; };

async function main() {
  const [users, bookings, ratings] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(bookingsTable),
    db.select().from(ratingsTable),
  ]);

  // Identity + profile rules. Dedupe keys mirror the live emission paths
  // (verification service, KYC submit, profile completion), so a later live
  // event for the same user is a no-op rather than a double-count.
  for (const user of users) {
    if (user.email_verified_at) {
      const r = await recordTrustEvent({
        userId: user.id,
        ruleKey: "email_verified",
        sourceType: "verification_challenge",
        sourceId: user.id,
        dedupeKey: `email-verified:${user.id}`,
        reason: "Historical email verification",
      });
      count("email_verified", r.inserted);
    }
    if (user.phone_verified_at) {
      const r = await recordTrustEvent({
        userId: user.id,
        ruleKey: "phone_verified",
        sourceType: "verification_challenge",
        sourceId: user.id,
        dedupeKey: `phone-verified:${user.id}`,
        reason: "Historical phone verification",
      });
      count("phone_verified", r.inserted);
    }
    // Government ID: a verified landlord/agent has been through KYC. We key off
    // `verification_status` rather than `national_id_verified_at` because seed
    // data and earlier admin verifications mark users verified without stamping
    // the timestamp — without this, verified landlords sat at 55 forever.
    // Students are excluded: they don't go through KYC, so the rule doesn't
    // apply to them.
    if (user.verification_status === "verified" && ["landlord", "agent"].includes(user.role)) {
      const r = await recordTrustEvent({
        userId: user.id,
        ruleKey: "government_id_verified",
        sourceType: "user",
        sourceId: user.id,
        dedupeKey: `government-id:${user.id}`,
        reason: "Historical KYC verification",
      });
      count("government_id_verified", r.inserted);
    }
    // profile_completed is a one-shot that also stamps profile_completed_at.
    // Re-use the service helper so the completeness rule lives in one place.
    await maybeAwardProfileCompletion(user.id);
  }

  for (const booking of bookings) {
    if (booking.booking_status !== "completed") continue;
    for (const [userId, party] of [[booking.student_id, "student"], [booking.landlord_id, "landlord"]] as const) {
      const r = await recordTrustEvent({
        userId,
        ruleKey: "transaction_completed",
        sourceType: "booking",
        sourceId: booking.id,
        dedupeKey: `transaction-completed:${booking.id}:${party}`,
        reason: "Historical completed booking",
      });
      count("transaction_completed", r.inserted);
    }
  }

  for (const rating of ratings) {
    const ruleKey = trustRuleForRating(rating.stars);
    if (!ruleKey) continue;
    const r = await recordTrustEvent({
      userId: rating.ratee_id,
      ruleKey,
      sourceType: "rating",
      sourceId: rating.id,
      dedupeKey: `rating:${rating.id}`,
      actorId: rating.rater_id,
      details: { stars: rating.stars, backfilled: true },
    });
    count(ruleKey, r.inserted);
  }

  // Refresh the projection for everyone so trust_scores reflects the new events.
  for (const user of users) await recomputeTrustScore(user.id);

  console.log(JSON.stringify({
    users: users.length,
    events_emitted_by_rule: emitted,
    events_emitted_total: Object.values(emitted).reduce((a, b) => a + b, 0),
    recomputed: users.length,
  }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
