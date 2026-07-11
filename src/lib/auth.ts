import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { usersTable, type User } from "./db/schema";

export interface AuthPayload {
  sub: string;
  role: string;
  email: string;
}

export function signToken(payload: AuthPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

export function verifyToken(token: string): AuthPayload | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret) as AuthPayload;
  } catch {
    return null;
  }
}

/**
 * Resolves the authenticated user from the request's Authorization header.
 * Throws `Error("Unauthorized")` if missing or invalid, or if the account is
 * suspended. Throws `Error("Forbidden")` for suspended accounts.
 */
export async function requireAuth(req: NextRequest): Promise<User> {
  const header = req.headers.get("authorization");
  if (!header) throw new Error("Unauthorized");
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw new Error("Unauthorized");

  const payload = verifyToken(token);
  if (!payload) throw new Error("Unauthorized");

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.sub)).limit(1);
  if (!user) throw new Error("Unauthorized");
  if (user.account_suspended) throw new Error("Forbidden");

  return user;
}