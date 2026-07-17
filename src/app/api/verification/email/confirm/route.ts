import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, parseBody } from "@/lib/api";
import { confirmVerificationChallenge } from "@/lib/verification/service";
const Body = z.object({ code: z.string().regex(/^\d{6}$/) });
export async function POST(req: NextRequest) { try { const me = await requireAuth(req); const body = await parseBody(req, Body); return jsonResponse(await confirmVerificationChallenge({ userId: me.id, channel: "email", token: body.code })); } catch (err) { return handleError(err, req); } }
