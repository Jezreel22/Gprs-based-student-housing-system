import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { handleError } from "@/lib/api";
import { db } from "@/lib/db";
import { uploadsTable } from "@/lib/db/schema";

/**
 * Serves a previously uploaded file straight from Postgres (the `uploads`
 * table). /api/upload writes the bytes there and hands back a URL of the
 * form `/api/uploads/<id>`; this route streams the row's `data` with the
 * stored MIME type.
 *
 * `<name>` may be a bare UUID (the current contract) or `UUID.ext` (legacy,
 * from when uploads lived on disk). Anything that isn't a UUID after
 * stripping an optional extension 404s — there's no path resolution, so
 * traversal isn't a concern.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params;

    // Accept an optional extension (legacy URLs); the DB is keyed by UUID.
    const id = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
    if (!UUID_RE.test(id)) {
      return new Response("Not found", { status: 404 });
    }

    const [row] = await db
      .select({ data: uploadsTable.data, mime: uploadsTable.mime, size_bytes: uploadsTable.size_bytes })
      .from(uploadsTable)
      .where(eq(uploadsTable.id, id))
      .limit(1);

    if (!row) {
      return new Response("Not found", { status: 404 });
    }

    // `row.data` is a Node Buffer (bytea). Wrap with the single-arg
    // Uint8Array constructor — under this TS/@types/node combo it resolves to
    // Uint8Array<ArrayBuffer>, which satisfies Response's BodyInit; the
    // 3-arg view form would resolve to Uint8Array<ArrayBufferLike> and fail
    // to typecheck.
    const bytes = new Uint8Array(row.data);
    // Rows are immutable (write-once), so a weak ETag keyed on size within
    // this id's URL is a safe validator and lets browsers cache hard.
    const etag = `W/"${row.size_bytes.toString(36)}"`;

    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": row.mime,
        "content-length": String(row.size_bytes),
        "cache-control": "public, max-age=31536000, immutable",
        etag,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}