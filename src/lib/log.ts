/**
 * Structured logger. Tiny on purpose — no deps, no config files.
 *
 * Outputs one line per call:
 *   - in production: a single JSON object, suitable for log aggregation
 *   - elsewhere: pretty `[level] message {key=value}` for human reading
 *
 * Every line carries `timestamp` and `level`. Caller-supplied fields are
 * merged in. A request id can be passed explicitly (`logFromRequest`) or
 * omitted, in which case the field is left off.
 *
 * Both this module and `next/headers` are safe to import from the Edge
 * runtime, so the middleware can call into it without a separate impl.
 */

type Level = "debug" | "info" | "warn" | "error";

type Fields = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";

function emit(level: Level, message: string, fields: Fields): void {
  // Normalize Error instances so JSON.stringify surfaces `name`/`message`
  // (Error properties are non-enumerable, so a raw Error serializes to `{}`
  // in production logs and operators can't see what blew up).
  const normalized: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error) {
      normalized[k] = { name: v.name, message: v.message, stack: v.stack };
    } else if (Array.isArray(v)) {
      normalized[k] = v.map((x) =>
        x instanceof Error ? { name: x.name, message: x.message } : x,
      );
    } else {
      normalized[k] = v;
    }
  }
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...normalized,
  };

  if (isProd) {
    // One line per record — ingest-friendly.
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](JSON.stringify(record));
    return;
  }

  // Dev: human-readable with the fields rendered as `k=v`.
  const tail = Object.keys(fields).length
    ? " " + Object.entries(fields).map(([k, v]) => `${k}=${formatValue(v)}`).join(" ")
    : "";
  const line = `[${level}] ${message}${tail}`;
  // eslint-disable-next-line no-console
  console[level === "debug" ? "log" : level](line);
}

function formatValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (message: string, fields: Fields = {}) => emit("debug", message, fields),
  info: (message: string, fields: Fields = {}) => emit("info", message, fields),
  warn: (message: string, fields: Fields = {}) => emit("warn", message, fields),
  error: (message: string, fields: Fields = {}) => emit("error", message, fields),
};

/**
 * Convenience wrapper for route handlers. Reads `x-request-id` and the path
 * off the request and threads them into every log call. If the request id
 * isn't present (e.g. the request didn't pass through the middleware), the
 * field is omitted rather than emitted as `null`.
 */
export function logFromRequest(req: Pick<Request, "headers" | "url">) {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const route = (() => {
    try { return new URL(req.url).pathname; } catch { return undefined; }
  })();
  const base: Fields = { ...(requestId && { requestId }), ...(route && { route }) };
  return {
    debug: (message: string, fields: Fields = {}) => emit("debug", message, { ...base, ...fields }),
    info: (message: string, fields: Fields = {}) => emit("info", message, { ...base, ...fields }),
    warn: (message: string, fields: Fields = {}) => emit("warn", message, { ...base, ...fields }),
    error: (message: string, fields: Fields = {}) => emit("error", message, { ...base, ...fields }),
  };
}