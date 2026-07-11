import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { log, logFromRequest } from "./log";

export function jsonResponse<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorResponse(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

/**
 * Convert any thrown value into a JSON Response.
 * - ZodError → 422 with field details
 * - `Error("Unauthorized")` → 401 (thrown by requireAuth)
 * - `Error("Forbidden")` → 403 (thrown by route-level role checks)
 * - HttpError → its declared status
 * - everything else → 500 with a generic message (don't leak details)
 *
 * Pass the request to attach `requestId` + `route` to the structured log.
 * Older call sites that omit it still log — the request-level fields just
 * aren't included.
 */
export function handleError(err: unknown, req?: Request): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 422 },
    );
  }
  if (err instanceof Error) {
    if (err.message === "Unauthorized") return errorResponse("Unauthorized", 401);
    if (err.message === "Forbidden") return errorResponse("Forbidden", 403);
  }
  if (err instanceof HttpError) {
    return errorResponse(err.message, err.status);
  }
  const logger = req ? logFromRequest(req) : log;
  logger.error("api unexpected error", { err });
  return errorResponse("Internal server error", 500);
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError("Invalid JSON body", 400);
  }
  return schema.parse(json);
}

export function getQueryParams(req: Request): URLSearchParams {
  const url = new URL(req.url);
  return url.searchParams;
}

/** Coerce a query string value to int with a fallback. */
export function getIntParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce a query string value to boolean ("true" / "false"). */
export function getBoolParam(params: URLSearchParams, key: string, fallback = false): boolean {
  const raw = params.get(key);
  if (raw == null) return fallback;
  return raw === "true" || raw === "1";
}