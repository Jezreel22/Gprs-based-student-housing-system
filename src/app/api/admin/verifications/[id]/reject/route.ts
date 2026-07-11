import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";

const RejectBody = z.object({ reason: z.string().min(5) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") throw new Error("Forbidden");
    const { id } = await params;
    const body = await parseBody(req, RejectBody);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!u) return errorResponse("User not found", 404);

    await db.update(usersTable).set({
      verification_status: "rejected",
      suspension_reason: body.reason,
      updated_at: new Date(),
    }).where(eq(usersTable.id, id));

    await db.insert(auditLogTable).values({
      actor_id: officer.id,
      action_type: "verification_rejected",
      resource_type: "user",
      resource_id: id,
      details: { reason: body.reason },
    });

    return jsonResponse({ message: "Verification rejected" });
  } catch (err) {
    return handleError(err, req);
  }
}