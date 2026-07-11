---
name: Google OAuth setup
description: How Google Sign-In is wired and what secrets are needed to activate it
---

Frontend uses `@react-oauth/google` `GoogleLogin` component inside `GoogleOAuthProvider`.
Backend verifies the credential (ID token) with `google-auth-library` `OAuth2Client`.

Required secrets (both must be set for Google OAuth to work):
- `VITE_GOOGLE_CLIENT_ID` — Vite env var, baked into frontend bundle
- `GOOGLE_CLIENT_ID` — backend process env

**Why:** The Google button in login.tsx / register.tsx is conditionally rendered — `VITE_GOOGLE_CLIENT_ID && ...` — so the UI is completely safe with no client ID set.

**How to apply:** When user asks to enable Google login, request both secrets via the environment-secrets skill. The OAuth2Client is instantiated at module load with `process.env.GOOGLE_CLIENT_ID ?? ""` and the `/auth/google` route returns 503 if it's empty.
