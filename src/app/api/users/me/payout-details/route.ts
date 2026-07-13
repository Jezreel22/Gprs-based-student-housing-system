import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { resolveAccountNumber, createTransferRecipient } from "@/lib/paystack-server";

const Body = z.object({
  bank_code: z.string().min(2),
  account_number: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
  // Present only on the confirm step. We always re-resolve server-side and use
  // Paystack's authoritative account_name, never the client's, so a spoofed
  // name can't slip through.
  account_name: z.string().optional(),
  confirm: z.boolean().optional(),
});

/**
 * GET /api/users/me/payout-details — the landlord's saved payout details.
 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    return jsonResponse({
      bank_code: me.payout_bank_code ?? null,
      account_number: me.payout_account_number ?? null,
      account_name: me.payout_account_name ?? null,
      recipient_code: me.paystack_recipient_code ?? null,
      set_at: me.payout_details_set_at?.toISOString() ?? null,
    });
  } catch (err) {
    return handleError(err, req);
  }
}

/**
 * POST /api/users/me/payout-details
 *
 * Two-step, server-authoritative:
 *   1. (no `confirm`) resolve the account via Paystack and return the
 *      registered account name as a PREVIEW — nothing is saved. The landlord
 *      confirms the name is theirs.
 *   2. (`confirm: true`) re-resolve, mint a transfer recipient if needed, and
 *      persist. We always store Paystack's resolved account_name.
 *
 * Landlords/agents only — students have no business setting payout details.
 */
export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    if (me.role !== "landlord" && me.role !== "agent") {
      return errorResponse("Only landlords and agents can set payout details", 403);
    }
    const body = await parseBody(req, Body);

    let resolved;
    try {
      // Always resolve — this validates the account is real and gives us the
      // authoritative name. A bad account_number/bank_code should be a clean
      // client error, not a 500.
      resolved = await resolveAccountNumber({
        account_number: body.account_number,
        bank_code: body.bank_code,
      });
    } catch (err: any) {
      return errorResponse(err?.message ?? "Could not resolve account name. Check parameters or try again.", 400);
    }

    if (!body.confirm) {
      // Preview step: return the resolved name for the landlord to confirm.
      return jsonResponse({
        preview: true,
        bank_code: body.bank_code,
        account_number: body.account_number,
        account_name: resolved.account_name,
      });
    }

    // Confirm step. If the client sent a name, it must match what Paystack
    // resolved (defense in depth against a tampered confirm payload).
    if (
      body.account_name &&
      body.account_name.trim().toLowerCase() !== resolved.account_name.toLowerCase()
    ) {
      return errorResponse(
        "The account name you confirmed doesn't match the bank's record. Please re-check.",
        400,
      );
    }

    // Reuse the existing recipient only if the account hasn't changed;
    // otherwise mint a fresh one (the old recipient_code stays orphaned on
    // Paystack's side, which is harmless).
    const accountUnchanged =
      me.paystack_recipient_code &&
      me.payout_account_number === body.account_number &&
      me.payout_bank_code === body.bank_code;

    let recipientCode = me.paystack_recipient_code;
    if (!accountUnchanged) {
      const created = await createTransferRecipient({
        account_number: body.account_number,
        bank_code: body.bank_code,
        account_name: resolved.account_name,
      });
      recipientCode = created.recipient_code;
    }

    await db
      .update(usersTable)
      .set({
        payout_bank_code: body.bank_code,
        payout_account_number: body.account_number,
        payout_account_name: resolved.account_name,
        paystack_recipient_code: recipientCode,
        payout_details_set_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(usersTable.id, me.id));

    await db.insert(auditLogTable).values({
      actor_id: me.id,
      action_type: "payout_details_set",
      resource_type: "user",
      resource_id: me.id,
      details: { bank_code: body.bank_code, account_name: resolved.account_name },
    });

    return jsonResponse({
      saved: true,
      bank_code: body.bank_code,
      account_name: resolved.account_name,
    });
  } catch (err) {
    return handleError(err, req);
  }
}
