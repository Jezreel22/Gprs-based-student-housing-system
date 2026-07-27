import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse, getQueryParams, getIntParam } from "@/lib/api";
import { findBookingIdsForActor } from "@/lib/escrow-transactions/access";
import { listTransactions } from "@/lib/escrow-transactions/repository";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  kind: z.enum(["deposit", "release", "refund"]).optional(),
  status: z.enum(["pending", "succeeded", "failed", "reversed", "manual_review"]).optional(),
  q: z.string().trim().max(100).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  sort: z.enum(["created_at", "amount_ngn"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * GET /api/transactions
 *
 * Server-paginated, role-scoped transaction ledger.
 *
 * - `escrow_officer` sees everything.
 * - `student` and `landlord` see only transactions for bookings they are a
 *   party to.
 * - `agent` is forbidden — agents have no transaction surface in this model.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    if (user.role === "agent") return errorResponse("Forbidden", 403);

    const params = getQueryParams(req);
    const parsed = QuerySchema.safeParse({
      page: getIntParam(params, "page", 1),
      page_size: getIntParam(params, "page_size", 25),
      kind: params.get("kind") ?? undefined,
      status: params.get("status") ?? undefined,
      q: params.get("q") ?? undefined,
      date_from: params.get("date_from") ?? undefined,
      date_to: params.get("date_to") ?? undefined,
      sort: params.get("sort") ?? undefined,
      order: params.get("order") ?? undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid query", issues: parsed.error.issues }, { status: 422 });
    }
    const q = parsed.data;

    // Participants must be scoped to their bookings; officers get the global
    // ledger. findBookingIdsForActor is the single source of truth for the
    // user's reachable booking set.
    const bookingIds = user.role === "escrow_officer"
      ? undefined
      : await findBookingIdsForActor(user);

    if (bookingIds && bookingIds.length === 0) {
      return jsonResponse({
        items: [],
        total: 0,
        page: q.page,
        page_size: q.page_size,
      });
    }

    const result = await listTransactions({
      bookingIds,
      receiptKind: q.kind,
      status: q.status,
      dateFrom: q.date_from,
      dateTo: q.date_to,
      search: q.q,
      page: q.page,
      pageSize: q.page_size,
      sort: q.sort,
      order: q.order,
    });

    await writeAudit({
      req,
      actorId: user.id,
      actionType: "transactions_listed",
      resourceType: "transaction_ledger",
      resourceId: user.id,
      details: {
        page: q.page,
        page_size: q.page_size,
        kind: q.kind ?? null,
        status: q.status ?? null,
        q: q.q ?? null,
        result_count: result.items.length,
      },
    });

    return jsonResponse(result);
  } catch (err) {
    return handleError(err, req);
  }
}