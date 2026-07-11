---
name: Auth DB decisions
description: Key decisions about the users table schema and auth flow
---

- `password_hash` is nullable — Google OAuth users have no password.
- Login route checks for null `password_hash` and returns 401 with a clear message directing to Google login.
- Students get `verification_status: "verified"` immediately on register (no KYC needed).
- Landlords/agents start as `"pending"` on register, become `"under_review"` when KYC is submitted.
- JWT expires in 7d (changed from 1d).
- `google_id` is unique — used as the primary lookup key for returning Google users, with email as fallback.
- `property_document_url` and `kyc_submitted_at` added to users table for landlord KYC tracking.

**Why:** Students are NAUB university members (lower risk); landlords need property and identity verification before listing.
