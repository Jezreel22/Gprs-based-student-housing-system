import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api";
import type { HealthStatus } from "@/api/generated/api.schemas";

export async function GET() {
  const response: HealthStatus = { status: "ok" };
  return jsonResponse(response);
}