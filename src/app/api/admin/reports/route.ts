import { NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { trustReportsTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { getBoolParam, getQueryParams, handleError, jsonResponse, errorResponse } from "@/lib/api";

/**
 * GET /api/admin/reports
 *
 * Lists all trust reports. Escrow officers only.
 * Query params:
 *   - status=open|substantiated|dismissed (default: no filter)
 *   - open_only=true   shortcut for status=open
 */
export async function GET(req: NextRequest) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);

    const query = getQueryParams(req);
    const openOnly = getBoolParam(query, "open_only");
    const status = query.get("status");

    let rows;
    if (openOnly || status === "open") {
      rows = await db.select().from(trustReportsTable)
        .where(eq(trustReportsTable.status, "open"))
        .orderBy(desc(trustReportsTable.created_at));
    } else if (status) {
      rows = await db.select().from(trustReportsTable)
        .where(eq(trustReportsTable.status, status))
        .orderBy(desc(trustReportsTable.created_at));
    } else {
      rows = await db.select().from(trustReportsTable)
        .orderBy(desc(trustReportsTable.created_at));
    }

    // Hydrate reporter + target user info for the admin table UI.
    const userIds = Array.from(new Set([
      ...rows.map((r) => r.reporter_id),
      ...rows.filter((r) => r.target_user_id).map((r) => r.target_user_id!),
    ]));
    const users = userIds.length > 0
      ? await db.select({ id: usersTable.id, email: usersTable.email, first_name: usersTable.first_name, last_name: usersTable.last_name, role: usersTable.role })
          .from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = rows.map((r) => ({
      ...r,
      reporter: userMap.get(r.reporter_id) ?? null,
      target_user: r.target_user_id ? (userMap.get(r.target_user_id) ?? null) : null,
    }));

    return jsonResponse(data);
  } catch (err) { return handleError(err, req); }
}
