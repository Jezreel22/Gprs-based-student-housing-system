import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLogTable } from "@/lib/db/schema";

/**
 * Extract the originating client IP from a request, preferring the standard
 * proxy headers in priority order. Returns `null` if no header is present —
 * callers should accept null (audit rows are still valid; the IP column is
 * nullable). We deliberately only take the first hop from `x-forwarded-for`
 * to avoid spoofing via that header alone (in production this is gated to
 * trusted proxies on the host).
 */
export function extractIp(req: Request | NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

interface WriteAuditArgs {
  /**
   * The originating request. Optional — service-level writes (auto-release
   * sweep, payment webhook handler) have no `req` and skip IP/UA capture.
   * Route handlers should always pass this.
   */
  req?: Request | NextRequest | null;
  actorId: string;
  actionType: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
  /**
   * Optional explicit status pair. When present, recorded inside the jsonb
   * `details` so the immutable audit trail can answer "what was this row's
   * lifecycle transition" without needing a separate column.
   */
  previousStatus?: string | null;
  newStatus?: string | null;
}

/**
 * Insert one row into `audit_log`, capturing actor, action, the resource it
 * acted on, optional details (including `previous_status`/`new_status`), the
 * client IP, and the user-agent. There is no UPDATE/DELETE path for this
 * table anywhere in code — the trail is append-only by convention. (A DB role
 * can revoke UPDATE/DELETE as a follow-up hardening step; not required for
 * correctness because the application never writes those statements.)
 *
 * All officer actions — old and new — go through this helper so the trail is
 * uniform. Errors are swallowed: audit logging must never fail a real write
 * that already succeeded. We log to stderr instead so ops can spot it.
 */
export async function writeAudit(args: WriteAuditArgs): Promise<void> {
  try {
    const details: Record<string, unknown> = { ...(args.details ?? {}) };
    if (args.previousStatus !== undefined) details.previous_status = args.previousStatus;
    if (args.newStatus !== undefined) details.new_status = args.newStatus;

    await db.insert(auditLogTable).values({
      actor_id: args.actorId,
      action_type: args.actionType,
      resource_type: args.resourceType,
      resource_id: args.resourceId,
      details,
      ip_address: args.req ? extractIp(args.req) : null,
      user_agent: args.req?.headers.get("user-agent") ?? null,
    });
  } catch (err) {
    // Audit must never break a successful business write.
    console.error("audit_log insert failed", {
      actionType: args.actionType,
      resourceId: args.resourceId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
