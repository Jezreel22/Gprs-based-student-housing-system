import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { uploadsTable } from "@/lib/db/schema";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

// Stores the uploaded image as a bytea blob in Postgres and returns
// `/api/uploads/<id>`, which the GET route serves from the DB. This replaces
// the disk-based write (`public/uploads/`) — Vercel's serverless filesystem
// is read-only at runtime, so persisting to the DB is what makes uploads
// actually work in production.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return errorResponse("No file provided in field 'file'", 400);
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return errorResponse(`Unsupported file type: ${file.type}. Allowed: JPG, PNG, WebP, GIF.`, 415);
    }
    if (file.size === 0) {
      return errorResponse("File is empty", 400);
    }
    if (file.size > MAX_BYTES) {
      return errorResponse(`File too large. Max ${MAX_BYTES / 1024 / 1024} MB.`, 413);
    }

    const data = Buffer.from(await file.arrayBuffer());
    const [row] = await db
      .insert(uploadsTable)
      .values({
        user_id: user.id,
        mime: file.type,
        size_bytes: file.size,
        data,
      })
      .returning({ id: uploadsTable.id });

    return jsonResponse({ url: `/api/uploads/${row.id}` }, { status: 201 });
  } catch (err) {
    return handleError(err, req);
  }
}
