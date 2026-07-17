import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { recomputeTrustScore } from "@/lib/trust/service";

const Body = z.object({ user_id: z.string().uuid().optional(), all: z.boolean().optional() });

export async function POST(req: NextRequest) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Forbidden", 403);
    const body = await parseBody(req, Body);
    if (body.all) {
      const users = await db.select({ id: usersTable.id }).from(usersTable);
      for (const user of users) await recomputeTrustScore(user.id);
      return jsonResponse({ recomputed: users.length });
    }
    if (!body.user_id) return errorResponse("Provide user_id or all=true", 422);
    return jsonResponse({ score: await recomputeTrustScore(body.user_id) });
  } catch (err) { return handleError(err, req); }
}
