import { NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, trustReportsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";

const Body = z.object({
  report_type: z.enum(["fake_property_listing", "spam_activity", "policy_violation"]),
  target_user_id: z.string().uuid().optional(),
  target_property_id: z.string().uuid().optional(),
  description: z.string().min(10).max(3000),
});

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    // Officers see all reports; everyone else sees only the reports they filed.
    const rows = me.role === "escrow_officer"
      ? await db.select().from(trustReportsTable).orderBy(desc(trustReportsTable.created_at))
      : await db.select().from(trustReportsTable)
          .where(eq(trustReportsTable.reporter_id, me.id))
          .orderBy(desc(trustReportsTable.created_at));
    return jsonResponse(rows);
  } catch (err) { return handleError(err, req); }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const body = await parseBody(req, Body);
    let targetUserId = body.target_user_id ?? null;
    if (body.report_type === "fake_property_listing") {
      if (!body.target_property_id) return errorResponse("A property is required for a fake-listing report", 422);
      const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, body.target_property_id)).limit(1);
      if (!property) return errorResponse("Property not found", 404);
      targetUserId = property.landlord_id;
    } else if (!targetUserId) return errorResponse("A user is required for this report", 422);
    if (targetUserId === me.id) return errorResponse("You cannot report yourself", 409);

    // Prevent duplicate open reports from the same reporter toward the same target.
    const existing = await db.select({ id: trustReportsTable.id })
      .from(trustReportsTable)
      .where(and(
        eq(trustReportsTable.reporter_id, me.id),
        targetUserId ? eq(trustReportsTable.target_user_id, targetUserId) : eq(trustReportsTable.report_type, body.report_type),
        eq(trustReportsTable.status, "open"),
      ))
      .limit(1);
    if (existing.length > 0) return errorResponse("You already have an open report for this user", 409);

    const [report] = await db.insert(trustReportsTable).values({
      reporter_id: me.id,
      target_user_id: targetUserId,
      target_property_id: body.target_property_id ?? null,
      report_type: body.report_type,
      description: body.description,
    }).returning();
    return jsonResponse(report, { status: 201 });
  } catch (err) { return handleError(err, req); }
}
