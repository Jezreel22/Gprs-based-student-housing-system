import "@/lib/load-env";
import { db } from "@/lib/db";
import { bookingsTable, ratingsTable, usersTable } from "@/lib/db/schema";
import { recordTrustEvent, recomputeTrustScore } from "@/lib/trust/service";
import { trustRuleForRating } from "@/lib/trust/rules";

async function main() {
  const [users, bookings, ratings] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(bookingsTable),
    db.select().from(ratingsTable),
  ]);
  let emitted = 0;

  for (const user of users) {
    if (user.verification_status === "verified" && user.national_id_verified_at) {
      const result = await recordTrustEvent({
        userId: user.id,
        ruleKey: "government_id_verified",
        sourceType: "user",
        sourceId: user.id,
        dedupeKey: `government-id:${user.id}`,
        reason: "Historical KYC verification",
      });
      if (result.inserted) emitted++;
    }
  }

  for (const booking of bookings) {
    if (booking.booking_status !== "completed") continue;
    for (const [userId, party] of [[booking.student_id, "student"], [booking.landlord_id, "landlord"]] as const) {
      const result = await recordTrustEvent({
        userId,
        ruleKey: "transaction_completed",
        sourceType: "booking",
        sourceId: booking.id,
        dedupeKey: `transaction-completed:${booking.id}:${party}`,
        reason: "Historical completed booking",
      });
      if (result.inserted) emitted++;
    }
  }

  for (const rating of ratings) {
    const ruleKey = trustRuleForRating(rating.stars);
    if (!ruleKey) continue;
    const result = await recordTrustEvent({
      userId: rating.ratee_id,
      ruleKey,
      sourceType: "rating",
      sourceId: rating.id,
      dedupeKey: `rating:${rating.id}`,
      actorId: rating.rater_id,
      details: { stars: rating.stars, backfilled: true },
    });
    if (result.inserted) emitted++;
  }

  for (const user of users) await recomputeTrustScore(user.id);
  console.log(JSON.stringify({ users: users.length, events_emitted: emitted, recomputed: users.length }));
}

main().catch((err) => { console.error(err); process.exit(1); });
