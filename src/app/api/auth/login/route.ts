import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import { signToken } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";
import { createNotification } from "@/lib/notify";
import type { AuthResponse } from "@/api/generated/api.schemas";

const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // The login screen picks a tab (Student / Landlord / Escrow Officer) before
  // entering credentials. We enforce it here so a landlord email can't sign
  // in through the Student tab (or vice-versa) — the role picker must match
  // the account. Escrow officers are accepted as their own tab.
  role: z.enum(["student", "landlord", "escrow_officer"]).optional(),
});

// Human-readable role labels for error messages.
function roleLabel(role: string): string {
  switch (role) {
    case "student":        return "a student";
    case "landlord":       return "a landlord";
    case "agent":          return "an agent (landlord)";
    case "escrow_officer": return "an escrow officer";
    default:               return role;
  }
}

// Which stored roles are allowed for a given login tab. The "landlord" tab
// also accepts agents — they list properties and set payouts the same way.
function roleMatches(loginRole: "student" | "landlord" | "escrow_officer", actualRole: string): boolean {
  if (loginRole === "student")        return actualRole === "student";
  if (loginRole === "escrow_officer") return actualRole === "escrow_officer";
  return actualRole === "landlord" || actualRole === "agent";
}

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

    // Enforce the login tab matches the account's actual role. We check this
    // AFTER the password so a wrong-tab attempt never leaks whether the email
    // exists (same "Invalid credentials"-style 401 surface).
    if (body.role && !roleMatches(body.role, user.role)) {
      const wantedTab =
        body.role === "student" ? "Student" :
        body.role === "escrow_officer" ? "Escrow Officer" :
        "Landlord";
      return jsonResponse({
        error: `This email is registered as ${roleLabel(user.role)} account, not ${roleLabel(body.role)} account. Use the ${wantedTab} tab to sign in.`,
      }, { status: 403 });
    }

    const token = signToken({ sub: user.id, role: user.role, email: user.email });

    // Persist a "login" notification so the bell icon shows new-device
    // sign-ins. Best-effort — never block the response on it.
    await createNotification({
      userId: user.id,
      type: "login",
      title: "New login to your account",
      body: `Signed in as ${user.email}`,
    });

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