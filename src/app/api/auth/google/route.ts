import { NextRequest } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import { signToken } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";
import type { AuthResponse } from "@/api/generated/api.schemas";

const GoogleAuthSchema = z.object({
  credential: z.string().min(1),
  role: z.enum(["student", "landlord", "agent"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, GoogleAuthSchema);

    if (!process.env.GOOGLE_CLIENT_ID) {
      return jsonResponse({ error: "Google OAuth is not configured on the server" }, { status: 503 });
    }

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: body.credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return jsonResponse({ error: "Invalid Google token" }, { status: 401 });
    }

    const email = payload.email;
    const googleId = payload.sub;
    const firstName = payload.given_name ?? null;
    const lastName = payload.family_name ?? null;
    const profilePhoto = payload.picture ?? null;

    // Find existing user by google_id or email
    let [user] = await db.select().from(usersTable).where(eq(usersTable.google_id, googleId)).limit(1);
    if (!user) {
      [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
      if (user) {
        // Link Google to existing account
        const [updated] = await db.update(usersTable)
          .set({ google_id: googleId, profile_photo_url: profilePhoto, updated_at: new Date() })
          .where(eq(usersTable.id, user.id))
          .returning();
        user = updated;
      }
    }
    if (!user) {
      const desiredRole = body.role ?? "student";
      const [created] = await db.insert(usersTable).values({
        email,
        google_id: googleId,
        role: desiredRole,
        first_name: firstName,
        last_name: lastName,
        profile_photo_url: profilePhoto,
        verification_status: desiredRole === "student" ? "verified" : "pending",
      }).returning();
      user = created;
    }

    if (user.account_suspended) {
      return jsonResponse({ error: "Account suspended" }, { status: 403 });
    }

    // If the caller asked for a specific tab role, the existing account must
    // match it — a landlord who signs in via Google through the Student tab is
    // rejected just like the password flow. (The client only offers Google on
    // the Student tab, so this is mostly defense in depth.)
    if (body.role && user.role !== body.role) {
      return jsonResponse({
        error: `This Google account is registered as ${user.role}, not ${body.role}.`,
      }, { status: 403 });
    }

    const token = signToken({ sub: user.id, role: user.role, email: user.email });
    const response: AuthResponse = {
      message: "Authenticated",
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