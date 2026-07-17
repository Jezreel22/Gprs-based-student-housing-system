import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, parseBody } from "@/lib/api";
import { requestVerificationChallenge } from "@/lib/verification/service";
const Body = z.object({ phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +2348012345678") });
export async function POST(req: NextRequest) { try { const me = await requireAuth(req); const body = await parseBody(req, Body); return jsonResponse(await requestVerificationChallenge({ userId: me.id, channel: "sms", destination: body.phone_number })); } catch (err) { return handleError(err, req); } }
