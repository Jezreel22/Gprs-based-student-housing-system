import { NextRequest } from "next/server";
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bookingsTable, propertiesTable, propertyPhotosTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import { getIntParam, getQueryParams } from "@/lib/api";
import { ALLOWED_TRANSITIONS, ESCROW_STATUSES, STATUS_LABEL } from "@/lib/escrow/transitions";

/**
 * GET /api/admin/bookings
 *
 * Escrow-officer ledger. Server-side pagination/filter/sort. Single source of
 * truth for the data behind the existing /admin Escrow tab AND the new
 * /admin/escrow page.
 *
 * Query params (all optional):
 *   page          1-based page number (default 1)
 *   page_size     items per page (default 25, max 100)
 *   status        one of the human stages OR the raw `booking_status` value
 *   q             free-text search over property address + tenant/landlord names
 *   landlord      filter by landlord_id
 *   tenant        filter by student_id
 *   property      filter by property_id
 *   sort          updated_at | created_at | total_amount_ngn | status (default updated_at)
 *   order         asc | desc (default desc)
 *
 * Response: `{ items, total, page, page_size, totals }`. `totals` is the
 * count of in-flight bookings per stage (held balance / under verification /
 * verified / ready for disbursement) so the summary cards can render without
 * a second round trip.
 */

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  landlord: z.string().uuid().optional(),
  tenant: z.string().uuid().optional(),
  property: z.string().uuid().optional(),
  sort: z.enum(["updated_at", "created_at", "total_amount_ngn", "status"]).default("updated_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// Human stage filter (the ones the admin UI offers) maps onto raw predicates.
// `under_verification` is a flag on `pending_occupancy`, not a booking_status.
function stageWhere(stage: string) {
  switch (stage) {
    case "under_verification":
      return and(
        eq(bookingsTable.booking_status, "pending_occupancy"),
        isNotNull(bookingsTable.under_verification_by_officer_at),
      );
    case "disbursed":
      return eq(bookingsTable.booking_status, "completed");
    case "rejected":
      return eq(bookingsTable.booking_status, "cancelled");
    case "ready_for_disbursement":
      return eq(bookingsTable.booking_status, "release_pending");
    case "verified":
      return eq(bookingsTable.booking_status, "pending_review");
    case "payment_received":
      return and(
        eq(bookingsTable.booking_status, "pending_occupancy"),
        sql`${bookingsTable.under_verification_by_officer_at} IS NULL`,
      );
    case "payment_pending":
      return eq(bookingsTable.booking_status, "pending_payment");
    default:
      // Treat unknown stage as raw status — covers `disbursement_failed` etc.
      if ((ESCROW_STATUSES as readonly string[]).includes(stage)) {
        return eq(bookingsTable.booking_status, stage);
      }
      return undefined;
  }
}

export async function GET(req: NextRequest) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") {
      return jsonResponse({ error: "Forbidden" }, { status: 403 });
    }

    const params = getQueryParams(req);
    const parsed = QuerySchema.safeParse({
      page: getIntParam(params, "page", 1),
      page_size: getIntParam(params, "page_size", 25),
      status: params.get("status") ?? undefined,
      q: params.get("q") ?? undefined,
      landlord: params.get("landlord") ?? undefined,
      tenant: params.get("tenant") ?? undefined,
      property: params.get("property") ?? undefined,
      sort: params.get("sort") ?? undefined,
      order: params.get("order") ?? undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid query", issues: parsed.error.issues }, { status: 422 });
    }
    const q = parsed.data;

    // ─── Build the WHERE clause incrementally ───────────────────────────────
    const whereParts = [] as Array<ReturnType<typeof eq> | ReturnType<typeof and> | ReturnType<typeof or>>;

    // Default: show in-flight bookings only (matches the previous admin scope).
    // An explicit `status=` overrides this. When the user filters, we honour
    // their filter — even if it would include terminal rows.
    if (q.status) {
      const stage = stageWhere(q.status);
      if (stage) whereParts.push(stage);
    } else {
      // No filter: show what an officer needs to action. Mirror the prior
      // default scope so the new page doesn't suddenly show all historical
      // completed bookings.
      whereParts.push(
        or(
          inArray(bookingsTable.booking_status, [
            "pending_occupancy",
            "pending_review",
            "release_pending",
            "release_failed",
          ]),
          and(eq(bookingsTable.booking_status, "completed"), isNotNull(bookingsTable.payout_error)),
        ),
      );
    }

    if (q.landlord) whereParts.push(eq(bookingsTable.landlord_id, q.landlord));
    if (q.tenant) whereParts.push(eq(bookingsTable.student_id, q.tenant));
    if (q.property) whereParts.push(eq(bookingsTable.property_id, q.property));

    // `q` matches against the property address — we resolve matching property
    // ids first, then constrain. (Cheaper than text-search on a jsonb column.)
    if (q.q) {
      const needle = `%${q.q}%`;
      const matchedProps = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(ilike(propertiesTable.address, needle));
      const matchedUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          or(
            ilike(usersTable.first_name, needle),
            ilike(usersTable.last_name, needle),
            ilike(sql`${usersTable.first_name} || ' ' || ${usersTable.last_name}`, needle),
          ),
        );
      const propertyIds = matchedProps.map((p) => p.id);
      const userIds = matchedUsers.map((u) => u.id);
      whereParts.push(
        or(
          propertyIds.length ? inArray(bookingsTable.property_id, propertyIds) : sql`FALSE`,
          userIds.length ? inArray(bookingsTable.student_id, userIds) : sql`FALSE`,
          userIds.length ? inArray(bookingsTable.landlord_id, userIds) : sql`FALSE`,
        ),
      );
    }

    const whereExpr = whereParts.length === 1 ? whereParts[0] : and(...whereParts);

    // ─── Counts + paged rows ────────────────────────────────────────────────
    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingsTable)
      .where(whereExpr);
    const total = totalRow[0]?.count ?? 0;

    const sortColumn = q.sort === "status"
      ? bookingsTable.booking_status
      : q.sort === "created_at"
        ? bookingsTable.created_at
        : q.sort === "total_amount_ngn"
          ? bookingsTable.total_amount_ngn
          : bookingsTable.updated_at;
    const orderFn = q.order === "asc" ? asc : desc;

    const offset = (q.page - 1) * q.page_size;
    const rows = await db
      .select()
      .from(bookingsTable)
      .where(whereExpr)
      .orderBy(orderFn(sortColumn))
      .limit(q.page_size)
      .offset(offset);

    // ─── Hydrate property + landlord + student + first photo ────────────────
    const propertyIds = Array.from(new Set(rows.map((b) => b.property_id)));
    const userIds = Array.from(new Set([
      ...rows.map((b) => b.student_id),
      ...rows.map((b) => b.landlord_id),
    ]));

    const [properties, photos, users] = await Promise.all([
      propertyIds.length
        ? db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
        : Promise.resolve([]),
      propertyIds.length
        ? db
            .select({ property_id: propertyPhotosTable.property_id, photo_url: propertyPhotosTable.photo_url })
            .from(propertyPhotosTable)
            .where(inArray(propertyPhotosTable.property_id, propertyIds))
            .orderBy(asc(propertyPhotosTable.photo_order))
        : Promise.resolve([]),
      userIds.length
        ? db
            .select({
              id: usersTable.id,
              first_name: usersTable.first_name,
              last_name: usersTable.last_name,
              email: usersTable.email,
              phone_number: usersTable.phone_number,
              profile_photo_url: usersTable.profile_photo_url,
              verification_status: usersTable.verification_status,
              payout_bank_code: usersTable.payout_bank_code,
              payout_account_number: usersTable.payout_account_number,
              payout_account_name: usersTable.payout_account_name,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
        : Promise.resolve([]),
    ]);

    const propMap = new Map(properties.map((p) => [p.id, p]));
    const userMap = new Map(users.map((u) => [u.id, u]));
    const photoByProp = new Map<string, string>();
    for (const ph of photos) {
      if (!photoByProp.has(ph.property_id)) photoByProp.set(ph.property_id, ph.photo_url);
    }

    const items = rows.map((b) => {
      const student = userMap.get(b.student_id);
      const landlord = userMap.get(b.landlord_id);
      const prop = propMap.get(b.property_id);
      return {
        id: b.id,
        booking_status: b.booking_status,
        // Stage is the human-facing label so the UI never has to know the
        // mapping. `under_verification` is a sub-stage of `pending_occupancy`.
        stage: b.booking_status === "pending_occupancy" && b.under_verification_by_officer_at
          ? "under_verification"
          : b.booking_status,
        stage_label: b.booking_status === "pending_occupancy" && b.under_verification_by_officer_at
          ? "Under verification"
          : STATUS_LABEL[b.booking_status ?? ""] ?? b.booking_status,
        under_verification: Boolean(b.under_verification_by_officer_at),
        rejected_reason: b.booking_status === "cancelled" ? b.escrow_release_reason : null,
        total_amount_ngn: b.total_amount_ngn,
        rent_amount_ngn: b.rent_amount_ngn,
        deposit_amount_ngn: b.deposit_amount_ngn,
        // Escrow fee = 0 today (no fee is taken); field present so the
        // disbursement modal can show it without a schema change later.
        escrow_fee_ngn: 0,
        property_id: b.property_id,
        property_address: prop?.address ?? null,
        property_thumbnail_url: (b.property_id && photoByProp.get(b.property_id)) || null,
        occupancy_code: prop?.occupancy_code ?? null,
        student_id: b.student_id,
        student_name: student ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() : null,
        student_email: student?.email ?? null,
        student_phone: student?.phone_number ?? null,
        student_verification: student?.verification_status ?? null,
        landlord_id: b.landlord_id,
        landlord_name: landlord ? `${landlord.first_name ?? ""} ${landlord.last_name ?? ""}`.trim() : null,
        landlord_email: landlord?.email ?? null,
        landlord_phone: landlord?.phone_number ?? null,
        landlord_verification: landlord?.verification_status ?? null,
        landlord_bank_code: landlord?.payout_bank_code ?? null,
        landlord_account_number: landlord?.payout_account_number ?? null,
        landlord_account_name: landlord?.payout_account_name ?? null,
        payment_method: b.payment_method ?? null,
        payment_transaction_id: b.payment_transaction_id ?? null,
        escrow_account_reference: b.escrow_account_reference ?? null,
        funds_received_at: b.funds_received_at?.toISOString() ?? null,
        occupancy_confirmed_at: b.occupancy_confirmed_by_student_at?.toISOString() ?? null,
        occupancy_verification_photo_url: b.occupancy_verification_photo_url ?? null,
        lease_start_date: b.lease_start_date ?? null,
        lease_end_date: b.lease_end_date ?? null,
        lease_duration_days: b.lease_duration_days ?? null,
        payout_transfer_reference: b.payout_transfer_reference ?? null,
        payout_initiated_at: b.payout_initiated_at?.toISOString() ?? null,
        payout_attempts: b.payout_attempts ?? 0,
        payout_error: b.payout_error ?? null,
        release_held: b.release_held_by_officer_at != null,
        created_at: b.created_at?.toISOString() ?? null,
        updated_at: b.updated_at?.toISOString() ?? null,
      };
    });

    // ─── Summary totals ─────────────────────────────────────────────────────
    // Single grouped COUNT for the in-flight stages. `held_balance` is the
    // sum of `total_amount_ngn` for bookings with funds received and not yet
    // disbursed.
    const [totalsRow] = await db
      .select({
        payment_received: sql<number>`COUNT(*) FILTER (WHERE ${bookingsTable.booking_status} = 'pending_occupancy' AND ${bookingsTable.under_verification_by_officer_at} IS NULL)::int`,
        under_verification: sql<number>`COUNT(*) FILTER (WHERE ${bookingsTable.booking_status} = 'pending_occupancy' AND ${bookingsTable.under_verification_by_officer_at} IS NOT NULL)::int`,
        verified: sql<number>`COUNT(*) FILTER (WHERE ${bookingsTable.booking_status} = 'pending_review')::int`,
        ready_for_disbursement: sql<number>`COUNT(*) FILTER (WHERE ${bookingsTable.booking_status} = 'release_pending')::int`,
        disbursement_failed: sql<number>`COUNT(*) FILTER (WHERE ${bookingsTable.booking_status} = 'release_failed')::int`,
        rejected: sql<number>`COUNT(*) FILTER (WHERE ${bookingsTable.booking_status} = 'cancelled')::int`,
        disbursed: sql<number>`COUNT(*) FILTER (WHERE ${bookingsTable.booking_status} = 'completed')::int`,
        held_balance_ngn: sql<number>`COALESCE(SUM(${bookingsTable.total_amount_ngn}) FILTER (WHERE ${bookingsTable.funds_received_at} IS NOT NULL AND ${bookingsTable.booking_status} NOT IN ('completed','cancelled')), 0)::int`,
      })
      .from(bookingsTable);

    return jsonResponse({
      items,
      total,
      page: q.page,
      page_size: q.page_size,
      totals: {
        payment_received: totalsRow?.payment_received ?? 0,
        under_verification: totalsRow?.under_verification ?? 0,
        verified: totalsRow?.verified ?? 0,
        ready_for_disbursement: totalsRow?.ready_for_disbursement ?? 0,
        disbursement_failed: totalsRow?.disbursement_failed ?? 0,
        rejected: totalsRow?.rejected ?? 0,
        disbursed: totalsRow?.disbursed ?? 0,
        held_balance_ngn: totalsRow?.held_balance_ngn ?? 0,
      },
      // Static helper data the client uses to render badges and the table.
      stages: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
      transitions: ALLOWED_TRANSITIONS,
    });
  } catch (err) {
    return handleError(err, req);
  }
}
