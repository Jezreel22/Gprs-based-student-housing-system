import { createHash, randomInt, randomUUID } from "crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { verificationChallengesTable, usersTable } from "@/lib/db/schema";
import { recordTrustEvent } from "@/lib/trust/service";
import { HttpError } from "@/lib/api";

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function configured(channel: "email" | "sms"): boolean { return channel === "email" ? Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) : Boolean(process.env.TERMII_API_KEY && process.env.TERMII_SENDER_ID); }

async function sendEmail(destination: string, token: string) {
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [destination], subject: "Verify your NAUB Home Finder email", text: `Your verification code is ${token}. It expires in 10 minutes.` }) });
  if (!res.ok) throw new Error("Email verification could not be sent");
}
async function sendSms(destination: string, token: string) {
  const res = await fetch("https://api.ng.termii.com/api/sms/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: process.env.TERMII_API_KEY, to: destination, from: process.env.TERMII_SENDER_ID, sms: `Your NAUB Home Finder verification code is ${token}. It expires in 10 minutes.`, type: "plain", channel: "generic" }) });
  if (!res.ok) throw new Error("SMS verification could not be sent");
}

export async function requestVerificationChallenge(args: { userId: string; channel: "email" | "sms"; destination: string }) {
  if (!configured(args.channel))
    throw new HttpError(
      `${args.channel === "email" ? "RESEND" : "TERMII"} verification is not configured`,
      503,
    );
  const code = String(randomInt(100000, 1000000));
  const now = new Date();
  const [latest] = await db.select().from(verificationChallengesTable).where(and(eq(verificationChallengesTable.user_id, args.userId), eq(verificationChallengesTable.channel, args.channel), isNull(verificationChallengesTable.consumed_at))).orderBy(desc(verificationChallengesTable.created_at)).limit(1);
  if (latest && now.getTime() - latest.created_at.getTime() < 60_000) throw new Error("Please wait one minute before requesting another code");
  await db.insert(verificationChallengesTable).values({ user_id: args.userId, channel: args.channel, destination: args.destination, token_hash: hash(code), expires_at: new Date(now.getTime() + TTL_MS) });
  if (args.channel === "email") await sendEmail(args.destination, code); else await sendSms(args.destination, code);
  return { expires_at: new Date(now.getTime() + TTL_MS).toISOString() };
}

export async function confirmVerificationChallenge(args: { userId: string; channel: "email" | "sms"; token: string }) {
  const [challenge] = await db.select().from(verificationChallengesTable).where(and(eq(verificationChallengesTable.user_id, args.userId), eq(verificationChallengesTable.channel, args.channel), isNull(verificationChallengesTable.consumed_at), gt(verificationChallengesTable.expires_at, new Date()))).orderBy(desc(verificationChallengesTable.created_at)).limit(1);
  if (!challenge) throw new Error("Verification code is invalid or expired");
  if ((challenge.attempt_count ?? 0) >= MAX_ATTEMPTS) throw new Error("Too many attempts. Request a new code.");
  if (hash(args.token) !== challenge.token_hash) { await db.update(verificationChallengesTable).set({ attempt_count: (challenge.attempt_count ?? 0) + 1 }).where(eq(verificationChallengesTable.id, challenge.id)); throw new Error("Verification code is invalid"); }
  await db.update(verificationChallengesTable).set({ consumed_at: new Date() }).where(eq(verificationChallengesTable.id, challenge.id));
  const column = args.channel === "email" ? { email_verified_at: new Date() } : { phone_verified_at: new Date(), phone_number: challenge.destination };
  await db.update(usersTable).set({ ...column, updated_at: new Date() }).where(eq(usersTable.id, args.userId));
  await recordTrustEvent({ userId: args.userId, ruleKey: args.channel === "email" ? "email_verified" : "phone_verified", sourceType: "verification_challenge", sourceId: challenge.id, dedupeKey: `${args.channel}-verified:${args.userId}`, actorId: args.userId });
  return { channel: args.channel };
}
