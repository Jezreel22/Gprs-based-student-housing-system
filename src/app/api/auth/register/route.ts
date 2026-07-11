import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import { signToken } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";
import type { AuthResponse } from "@/api/generated/api.schemas";

const RegisterBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["student", "landlord", "agent"]),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  matriculation_number: z.string().optional(),
  phone_number: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, RegisterBodySchema);
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, body.email)).limit(1);
    if (existing.length > 0) {
      return jsonResponse({ error: "Email already registered" }, { status: 409 });
    }

    const password_hash = await bcrypt.hash(body.password, 10);
    const [user] = await db.insert(usersTable).values({
      email: body.email,
      password_hash,
      role: body.role,
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      matriculation_number: body.matriculation_number ?? null,
      phone_number: body.phone_number ?? null,
      verification_status: body.role === "student" ? "verified" : "pending",
    }).returning();

    if (!user) {
      return jsonResponse({ error: "Failed to create account" }, { status: 500 });
    }

    const token = signToken({ sub: user.id, role: user.role, email: user.email });
    const response: AuthResponse = {
      message: "Account created",
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
    return jsonResponse(response, { status: 201 });
  } catch (err) {
    return handleError(err, req);
  }
}