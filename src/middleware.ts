import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";

/**
 * Runs on every `/api/*` request. Two jobs:
 *
 *  1. Stamp an `x-request-id` so a single request can be traced from the
 *     response header down into route-handler logs (`logFromRequest(req)`
 *     reads the same header).
 *  2. Enforce per-IP rate limits on the routes that get hit the hardest
 *     (auth, upload, messages). Limits are deliberately simple — a
 *     fixed-window counter in a module-scoped Map. For multi-instance or
 *     serverless production deployments, swap this for a Redis/Upstash
 *     backed limiter; the call sites here don't change.
 */

type Bucket = {
  // Count of requests in the current window.
  count: number;
  // When the window resets (epoch ms).
  resetAt: number;
};

// Limits keyed by route prefix. Order matters: longest match wins.
const LIMITS: Array<{ prefix: string; max: number; windowMs: number }> = [
  { prefix: "/api/auth/", max: 5, windowMs: 60_000 },
  { prefix: "/api/upload", max: 20, windowMs: 60_000 },
  { prefix: "/api/messages", max: 30, windowMs: 60_000 },
];

const buckets = new Map<string, Bucket>();

function clientIp(req: NextRequest): string {
  // `x-forwarded-for` is a comma-separated list; the first entry is the
  // originating client (when behind a proxy/CDN that strips/prepends it).
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function findLimit(pathname: string) {
  return LIMITS.find((l) => pathname.startsWith(l.prefix));
}

function check(ip: string, pathname: string) {
  const limit = findLimit(pathname);
  if (!limit) return { allowed: true as const };
  const key = `${ip}:${limit.prefix}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { allowed: true as const, remaining: limit.max - 1, retryAfter: 0 };
  }

  if (existing.count >= limit.max) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { allowed: false as const, retryAfter, limit };
  }

  existing.count += 1;
  return { allowed: true as const, remaining: limit.max - existing.count, retryAfter: 0 };
}

export function middleware(req: NextRequest) {
  // Edge runtime: Web Crypto is available as `crypto.randomUUID()`.
  const requestId = crypto.randomUUID();
  const ip = clientIp(req);
  const pathname = new URL(req.url).pathname;

  const verdict = check(ip, pathname);

  if (!verdict.allowed) {
    log.warn("rate_limited", {
      requestId,
      ip,
      route: pathname,
      method: req.method,
      limit_max: verdict.limit.max,
      window_ms: verdict.limit.windowMs,
    });
    return new NextResponse(
      JSON.stringify({ error: "Too many requests", retry_after: verdict.retryAfter }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(verdict.retryAfter),
          "x-request-id": requestId,
        },
      },
    );
  }

  // Pass requestId through to the route handler via a request header, and
  // echo it on the response so callers can grab it for support tickets.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  if ("remaining" in verdict && typeof verdict.remaining === "number") {
    response.headers.set("x-ratelimit-remaining", String(verdict.remaining));
  }
  return response;
}

export const config = {
  // Apply to all API routes. Pages and static assets (including /uploads/*)
  // are unaffected.
  matcher: ["/api/:path*"],
};