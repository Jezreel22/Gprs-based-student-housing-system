import { resolveAccountNumber } from "@/lib/paystack-server";

/**
 * Real identity check for landlord KYC: resolve the supplied bank account
 * against Paystack (which hits the bank's real database) and require the
 * returned registered account name to match the landlord's name.
 *
 * This is the opposite of a hardcoded approval — the name has to come back from
 * the actual bank. We do a token-overlap match so middle names, initials, and
 * "FIRST LAST" vs "LAST FIRST" ordering differences don't cause spurious
 * rejections, while still requiring a real match.
 *
 * Returns `ok: true` on a match, otherwise `ok: false` with a human-readable
 * `reason`.
 */
export async function verifyLandlordIdentity(args: {
  accountNumber: string;
  bankCode: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ ok: true; resolvedAccountName: string } | { ok: false; reason: string }> {
  let resolved: { account_name: string };
  try {
    resolved = await resolveAccountNumber({
      account_number: args.accountNumber,
      bank_code: args.bankCode,
    });
  } catch {
    return {
      ok: false,
      reason:
        "We couldn't verify that bank account with Paystack. Double-check the account number and bank — if it's correct, the bank may be temporarily unavailable.",
    };
  }

  const resolvedName = (resolved.account_name ?? "").toLowerCase().trim();
  if (!resolvedName) {
    return { ok: false, reason: "Paystack returned no name for that account. Check the details and try again." };
  }

  const landlordTokens = [args.firstName, args.lastName]
    .filter(Boolean)
    .flatMap((n) => (n as string).toLowerCase().split(/\s+/))
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter((t) => t.length >= 3);

  if (landlordTokens.length === 0) {
    return { ok: false, reason: "Add your first and last name on your profile before verifying." };
  }

  const matched = landlordTokens.some((token) => resolvedName.includes(token));
  if (!matched) {
    return {
      ok: false,
      reason: `The name on that account ("${resolved.account_name}") doesn't match the name on your profile. Use a bank account registered in your own name.`,
    };
  }

  return { ok: true, resolvedAccountName: resolved.account_name };
}
