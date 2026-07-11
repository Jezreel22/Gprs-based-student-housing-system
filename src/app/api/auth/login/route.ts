import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import { signToken } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";
import type { AuthResponse } from "@/api/generated/api.schemas";

const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, LoginBodySchema);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, body.email)).limit(1);

    if (!user || !user.password_hash) {
      return jsonResponse({ error: "Invalid credentials" }, { status: 401 });
    }

    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) {
      return jsonResponse({ error: "Invalid credentials" }, { status: 401 });
    }

    if (user.account_suspended) {
      return jsonResponse({ error: "Account suspended" }, { status: 403 });
    }

    const token = signToken({ sub: user.id, role: user.role, email: user.email });
    const response: AuthResponse = {
      message: "Logged in",
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        matriculation_number: user.matriculation_number,
        verification_status: user.verification_status,
      },
      token,
    };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}