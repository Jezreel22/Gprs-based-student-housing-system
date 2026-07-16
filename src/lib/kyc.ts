import { resolveAccountNumber, resolveBvn } from "@/lib/paystack-server";

function normaliseTokens(...names: Array<string | null | undefined>): string[] {
  return names
    .filter(Boolean)
    .flatMap((name) => (name as string).toLowerCase().split(/\s+/))
    .map((token) => token.replace(/[^a-z]/g, ""))
    .filter((token) => token.length >= 3);
}

function namesMatch(expected: string[], actual: string[]): boolean {
  return expected.some((token) => actual.some((candidate) => candidate.includes(token) || token.includes(candidate)));
}

/**
 * Verify two independent real-world identity anchors:
 * - Paystack resolves the BVN against its identity-verification service.
 * - Paystack resolves the bank account against the receiving bank.
 *
 * Both returned names must overlap the landlord profile name. Raw BVNs are
 * intentionally never returned or persisted.
 */
export async function verifyLandlordIdentity(args: {
  bvn: string;
  accountNumber: string;
  bankCode: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ ok: true; resolvedAccountName: string } | { ok: false; reason: string }> {
  const profileTokens = normaliseTokens(args.firstName, args.lastName);
  if (profileTokens.length === 0) {
    return { ok: false, reason: "Add your first and last name on your profile before verifying." };
  }

  let bvnIdentity: { first_name: string | null; last_name: string | null };
  try {
    bvnIdentity = await resolveBvn(args.bvn);
  } catch {
    return {
      ok: false,
      reason: "We couldn't verify that BVN with Paystack. Check the 11 digits and use the BVN registered in your own name.",
    };
  }

  if (!namesMatch(profileTokens, normaliseTokens(bvnIdentity.first_name, bvnIdentity.last_name))) {
    return { ok: false, reason: "The BVN details don't match the name on your profile." };
  }

  let account: { account_name: string };
  try {
    account = await resolveAccountNumber({
      account_number: args.accountNumber,
      bank_code: args.bankCode,
    });
  } catch {
    return {
      ok: false,
      reason: "We couldn't verify that bank account with Paystack. Double-check the account number and bank.",
    };
  }

  if (!namesMatch(profileTokens, normaliseTokens(account.account_name))) {
    return {
      ok: false,
      reason: `The name on that account ("${account.account_name}") doesn't match the name on your profile. Use an account registered in your own name.`,
    };
  }

  return { ok: true, resolvedAccountName: account.account_name };
}
