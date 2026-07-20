import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogTable, trustReportsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { recordTrustEvent } from "@/lib/trust/service";

const Body = z.object({ status: z.enum(["substantiated", "dismissed"]), officer_notes: z.string().min(10).max(3000) });

// Maps each actionable report_type to the trust-rule penalty that fires when
// the report is substantiated. policy_violation maps to spam_activity since
// it's the closest analogue to platform-policy breach.
const RULE_BY_REPORT = {
  fake_property_listing: "fake_property_listing",
  spam_activity: "spam_activity",
  policy_violation: "spam_activity",
} as const satisfies Record<string, import("@/lib/trust/rules").TrustRuleKey>;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const { id } = await params;
    const body = await parseBody(req, Body);
    const [report] = await db.select().from(trustReportsTable).where(eq(trustReportsTable.id, id)).limit(1);
    if (!report) return errorResponse("Report not found", 404);
    if (report.status !== "open") return errorResponse("Report has already been resolved", 409);
    await db.update(trustReportsTable).set({ status: body.status, officer_id: officer.id, officer_notes: body.officer_notes, resolved_at: new Date() }).where(eq(trustReportsTable.id, id));
    if (body.status === "substantiated" && report.target_user_id && report.report_type in RULE_BY_REPORT) {
      await recordTrustEvent({
        userId: report.target_user_id,
        ruleKey: RULE_BY_REPORT[report.report_type as keyof typeof RULE_BY_REPORT],
        sourceType: "report",
        sourceId: report.id,
        dedupeKey: `report:${report.id}`,
        actorId: officer.id,
        details: { report_type: report.report_type },
      });
    }
    await db.insert(auditLogTable).values({ actor_id: officer.id, action_type: "trust_report_adjudicated", resource_type: "trust_report", resource_id: report.id, details: { status: body.status, report_type: report.report_type } });
    return jsonResponse({ message: `Report ${body.status}` });
  } catch (err) { return handleError(err, req); }
}

