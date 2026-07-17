import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, parseBody } from "@/lib/api";
import { requestVerificationChallenge } from "@/lib/verification/service";
const Body = z.object({});
export async function POST(req: NextRequest) { try { const me = await requireAuth(req); await parseBody(req, Body); return jsonResponse(await requestVerificationChallenge({ userId: me.id, channel: "email", destination: me.email })); } catch (err) { return handleError(err, req); } }
