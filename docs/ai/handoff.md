# Admin Web App Authentication & Authorization Architecture Handoff

## Objective

Design and document a secure, Apple-compliant authentication and authorization architecture for a web-based Admin App that:
- Uses Sign in with Apple (web) exclusively
- Verifies users server-side against the `users` table
- Enforces admin access via `users.is_admin = true`
- Isolates admin functionality under `/api/admin/*`
- Prevents any admin UI or logic from existing in the iOS app binary

This handoff is architecture only. No code is written yet.

---

## Confirmed Assumptions

1. The iOS app uses Sign in with Apple only. No passwords are stored.
2. Admins are defined strictly by `users.is_admin = true`.
3. There are currently 2 admins. Chad will use his real email (not private relay).
4. The `users` table includes an `apple_id` column, which stores the Apple `sub` identifier from Sign in with Apple. This is the stable, primary lookup key.
5. The Admin tab was removed from the iOS app to satisfy Apple App Review. No admin UI or functionality exists in the iOS binary.
6. 28 admin endpoints currently exist in `server.js` under `/api/admin/*`.
7. The admin web app will be the exclusive interface for admin capabilities.
8. The backend is Node.js with Express.
9. Session strategy is admin-scoped JWT (stateless, client-side storage).

---

## Current State

### Database Schema (users table)
Relevant columns:
- `id` (primary key)
- `apple_id` (Apple `sub`, stable identifier)
- `email` (fallback identifier, may be private relay)
- `is_admin` (boolean, authorization gate)
- `username`, `team_name`, `paid`, `created_at`, etc.

No `apple_sub` column exists. `apple_id` is the Apple `sub`.

### Existing Admin Endpoints (28 total)
All routes are currently under `/api/admin/*`:

1. POST `/api/admin/leagues`
2. PUT `/api/admin/leagues/:id`
3. DELETE `/api/admin/leagues/:id`
4. POST `/api/admin/leagues/:id/playoff-weeks`
5. PUT `/api/admin/leagues/:leagueId/playoff-weeks/:weekId`
6. DELETE `/api/admin/leagues/:leagueId/playoff-weeks/:weekId`
7. POST `/api/admin/leagues/:leagueId/playoff-weeks/:weekId/games`
8. PUT `/api/admin/leagues/:leagueId/playoff-weeks/:weekId/games/:gameId`
9. DELETE `/api/admin/leagues/:leagueId/playoff-weeks/:weekId/games/:gameId`
10. PUT `/api/admin/games/:gameId/score`
11. GET `/api/admin/users`
12. PUT `/api/admin/users/:id`
13. DELETE `/api/admin/users/:id`
14. POST `/api/admin/users/:id/reset-password`
15. GET `/api/admin/entries`
16. PUT `/api/admin/entries/:id`
17. DELETE `/api/admin/entries/:id`
18. GET `/api/admin/picks`
19. PUT `/api/admin/picks/:id`
20. DELETE `/api/admin/picks/:id`
21. GET `/api/admin/payments`
22. PUT `/api/admin/payments/:id/verify`
23. POST `/api/admin/debug/test-game-score`
24. POST `/api/admin/debug/verify-calculations`
25. GET `/api/admin/stats/overview`
26. GET `/api/admin/stats/user-activity`
27. GET `/api/admin/stats/payment-summary`
28. GET `/api/admin/stats/league-participation`

### Current Gaps
- No server-side Apple `id_token` verification
- No admin authentication layer for web
- No JWT issuance for admin sessions
- No jti-based replay protection
- No audit logging

---

## Intended Behavior

### Authentication Flow (Text Diagram)

```
1. Admin user visits Admin Web App
2. Web App redirects to Sign in with Apple (web flow)
3. User authenticates with Apple
4. Apple redirects back to Web App with authorization code
5. Web App sends authorization code to Backend at POST /api/admin/auth/apple
6. Backend exchanges code for id_token with Apple token endpoint
7. Backend verifies id_token:
   - JWT signature (using Apple's public keys)
   - Issuer: https://appleid.apple.com
   - Audience: matches client_id
   - Expiration: not expired
   - jti: not previously used (replay protection)
8. Backend extracts apple_id (sub claim) from id_token
9. Backend queries users table: WHERE apple_id = <sub> AND is_admin = true
10. If user exists and is_admin = true:
    - Issue admin-scoped JWT (short-lived, e.g., 1 hour)
    - Include claims: user_id, apple_id, is_admin, role: "admin", jti
    - Return JWT to Web App
11. If user does not exist or is_admin = false:
    - Deny access, return 403
    - Log denial attempt
12. Web App stores JWT in memory or sessionStorage
13. Web App includes JWT in Authorization: Bearer <token> header for all admin API calls
14. Backend middleware on /api/admin/* routes:
    - Verify JWT signature
    - Check expiration
    - Extract user_id, confirm is_admin claim
    - Optional: re-query users.is_admin for defense in depth
    - Proceed or deny
```

### Backend Token Verification Steps

**Location:** New module: `/middleware/adminAuth.js` or `/auth/appleVerify.js`

**Apple ID Token Verification (POST /api/admin/auth/apple):**
1. Exchange authorization code for `id_token` via Apple token endpoint
2. Fetch Apple's public keys from `https://appleid.apple.com/auth/keys`
3. Decode `id_token` header to identify `kid`
4. Verify JWT signature using matching public key
5. Validate claims:
   - `iss` === `https://appleid.apple.com`
   - `aud` === backend client_id
   - `exp` > current time
   - `sub` is present (apple_id)
6. Check `jti` against recent jti cache (Redis or in-memory TTL map, expire after 10 minutes)
7. If jti exists, reject (replay attempt)
8. Store jti in cache
9. Extract `sub` (apple_id) and `email` (if present)

**User Lookup:**
- Query: `SELECT id, apple_id, email, is_admin FROM users WHERE apple_id = ? LIMIT 1`
- If no row or `is_admin = false`, return 403
- If valid, proceed to JWT issuance

**Admin JWT Issuance:**
- Algorithm: HS256 or RS256 (recommend HS256 for simplicity)
- Claims:
  - `sub`: user.id
  - `apple_id`: user.apple_id
  - `is_admin`: true
  - `role`: "admin"
  - `jti`: unique identifier (UUIDv4)
  - `iat`: issued at timestamp
  - `exp`: 1 hour from iat
- Sign with backend secret (env var: `ADMIN_JWT_SECRET`)
- Return JWT to client

### Authorization Enforcement Strategy

**Middleware: `/middleware/requireAdmin.js`**

Applied to all `/api/admin/*` routes.

Steps:
1. Extract `Authorization: Bearer <token>` header
2. If missing, return 401
3. Verify JWT signature using `ADMIN_JWT_SECRET`
4. If invalid or expired, return 401
5. Decode JWT, extract `sub` (user_id), `is_admin`, `role`
6. If `is_admin !== true` or `role !== "admin"`, return 403
7. Optional defense in depth: re-query `users.is_admin` for user_id
8. If re-query shows `is_admin = false`, return 403 and log
9. Attach `req.adminUser = { id, apple_id, is_admin }` to request
10. Proceed to route handler

**Route Isolation:**
- All admin routes MUST be under `/api/admin/*`
- No admin logic or UI should exist in user-facing routes
- No admin routes should be accessible from iOS app

### Session Approach: Admin-Scoped JWT

**Choice:** Stateless JWT stored client-side (sessionStorage or memory).

**Rationale:**
- Simple, no backend session store required
- Short expiry (1 hour) limits exposure
- Replay protection via jti cache for Apple id_token only (not admin JWT)
- No cookie complexity or CSRF concerns
- Suitable for admin-only web app with low user count

**Claims:**
- `sub`: user.id
- `apple_id`: user.apple_id
- `is_admin`: true
- `role`: "admin"
- `jti`: unique ID
- `iat`, `exp`

**Expiry:** 1 hour. User must re-authenticate after expiry.

**Storage:** sessionStorage (cleared on tab close) or memory (cleared on refresh).

---

## Required Database Fields

**users table** (already exists):
- `id` (primary key)
- `apple_id` (Apple `sub`, stable identifier, indexed)
- `email` (fallback, may be private relay)
- `is_admin` (boolean, authorization gate)

**No new columns required.**

**Indexes:**
- Ensure `apple_id` is indexed for fast lookup

---

## Admin API Surface Separation and Guardrails

### Guardrails
1. **Path Isolation:** All admin routes under `/api/admin/*`
2. **Middleware Enforcement:** `requireAdmin` middleware applied to all `/api/admin/*` routes
3. **No Auto-Creation:** Do not create users during admin login. Only existing `is_admin=true` users may access.
4. **No iOS Access:** iOS app must not include admin UI or call `/api/admin/*` routes. Code review and runtime checks recommended.
5. **Audit Logging:** Log all admin authentication attempts (success and failure) and high-risk actions (e.g., delete, reset-password).
6. **Token Expiry:** Short-lived JWTs (1 hour) reduce risk of token theft.
7. **Replay Protection:** jti cache for Apple id_token prevents token replay during initial auth.

### Admin API Surface
All 28 existing `/api/admin/*` endpoints are in scope.

Any admin endpoint not used by the web app should be removed or disabled.

---

## Security Considerations

### Apple Private Relay Email Behavior
- Admin users (currently 2) will use real email addresses, not private relay.
- If private relay email is encountered and does not match `users.email`, lookup will rely on `apple_id` (Apple `sub`).
- If `apple_id` match exists and `is_admin=true`, grant access.
- If no match, deny access.
- Future: Consider storing both real and relay emails if needed.

### Missing Email Claims
- If Apple does not provide an `email` claim, rely solely on `apple_id` (Apple `sub`).
- Email is a fallback identifier only.

### Token Replay Protection
- Apple `id_token` jti is checked against a cache (Redis or in-memory TTL map, expire after 10 minutes).
- If jti exists, reject as replay attempt.
- Admin JWT does not require jti replay protection (short-lived, 1 hour expiry).

### CSRF (Not Applicable)
- Admin-scoped JWT is not stored in cookies.
- No CSRF risk for Bearer token auth.
- If future changes introduce cookies, add SameSite=Strict and CSRF tokens.

### Audit Logging
- Log all admin authentication attempts (POST /api/admin/auth/apple):
  - Timestamp
  - apple_id
  - Success or failure
  - Reason for failure (user not found, not admin, invalid token, etc.)
- Log high-risk admin actions:
  - User deletion
  - Password reset
  - Payment verification
  - Game score updates
- Logs should be readable in Railway (stdout or structured logging to Railway logs).
- Consider structured logging (e.g., JSON) for easier parsing.

### Defense in Depth
- Middleware re-queries `users.is_admin` on every request (optional but recommended).
- If JWT claims `is_admin=true` but database shows `is_admin=false`, deny and log.
- Prevents stale JWT abuse if admin status is revoked.

### Apple App Review Compliance
- No admin UI or functionality in iOS app binary.
- Admin routes are web-only.
- iOS app must not call `/api/admin/*` routes.
- Code review: Ensure no references to admin routes in iOS codebase.
- Runtime check: Backend logs iOS requests to `/api/admin/*` as suspicious.

---

## Edge Cases and Risks

### Edge Case: Admin Status Revoked During Active Session
- Admin JWT claims `is_admin=true` but database shows `is_admin=false`.
- Middleware re-query catches this and denies access.
- Log revocation event.
- User must re-authenticate to get new JWT.

### Edge Case: Apple ID Token Expired or Invalid
- Backend rejects token during verification.
- Return 401 to web app.
- Web app prompts user to re-authenticate.

### Edge Case: User Exists but is_admin=false
- Backend denies access during initial auth.
- Return 403.
- Log denial attempt.

### Edge Case: User Does Not Exist
- Backend denies access during initial auth.
- Return 403.
- Log denial attempt.
- Do not auto-create user.

### Risk: JWT Secret Compromise
- If `ADMIN_JWT_SECRET` is leaked, attacker can forge admin JWTs.
- Mitigation: Store secret securely (env var, Railway secrets).
- Rotate secret periodically.
- Short expiry (1 hour) limits exposure window.

### Risk: Apple Public Key Rotation
- Apple may rotate signing keys.
- Backend must fetch keys dynamically from `https://appleid.apple.com/auth/keys`.
- Cache keys with TTL (e.g., 1 hour) to reduce latency.
- Fallback: Re-fetch if `kid` not found in cache.

### Risk: Replay Attack on Admin JWT
- Admin JWTs do not use jti replay protection.
- Mitigation: Short expiry (1 hour) limits reuse window.
- If stricter protection needed, add jti to admin JWT and track in cache.

---

## Explicit Non-Goals

- No UI design or frontend implementation guidance.
- No code generation (architecture only).
- No password-based auth or magic links.
- No alternate auth providers (Google, email, etc.).
- No auto-creation of users during admin login.
- No admin functionality in iOS app binary.
- No redesign of existing admin endpoints (reuse as-is).
- No session store or stateful backend sessions.
- No CSRF protection (JWT is not cookie-based).

---

## Validation Steps (Ordered)

1. **Backend Setup:**
   - Add POST `/api/admin/auth/apple` endpoint
   - Implement Apple `id_token` verification (signature, claims, jti cache)
   - Implement admin JWT issuance
   - Add `requireAdmin` middleware
   - Apply middleware to all `/api/admin/*` routes

2. **Admin Web App Setup:**
   - Integrate Sign in with Apple (web) button
   - Handle Apple redirect with authorization code
   - Call POST `/api/admin/auth/apple` with code
   - Store returned JWT in sessionStorage
   - Include JWT in `Authorization: Bearer <token>` header for all API calls

3. **Positive Path Test:**
   - Admin user authenticates via Sign in with Apple
   - Backend verifies token, issues JWT
   - Web app calls GET `/api/admin/users` with JWT
   - Backend middleware validates JWT, allows access
   - Confirm response is successful

4. **Negative Path Tests:**
   - Non-admin user authenticates → Expect 403
   - User does not exist → Expect 403
   - Expired JWT → Expect 401
   - Invalid JWT signature → Expect 401
   - Missing JWT → Expect 401
   - Replay Apple `id_token` (reuse jti) → Expect 403 during auth

5. **Audit Log Verification:**
   - Check Railway logs for admin auth attempts (success and failure)
   - Check logs for high-risk actions (if implemented)

6. **iOS App Compliance Check:**
   - Review iOS codebase for any references to `/api/admin/*`
   - Confirm no admin UI or logic exists in iOS binary
   - Test: iOS app should never call `/api/admin/*` routes

7. **Defense in Depth Test:**
   - Revoke admin status (`is_admin=false`) for a user with active JWT
   - Attempt API call with that JWT
   - Expect 403 (middleware re-query catches revocation)

8. **Token Expiry Test:**
   - Wait 1 hour after JWT issuance
   - Attempt API call with expired JWT
   - Expect 401
   - Re-authenticate to get new JWT

---

## Exit Criteria

- Admin Web App can authenticate via Sign in with Apple (web)
- Backend verifies Apple `id_token` (signature, claims, jti)
- Backend issues admin-scoped JWT with correct claims
- All `/api/admin/*` routes enforce `requireAdmin` middleware
- Non-admin users and non-existent users are denied (403)
- Expired or invalid JWTs are rejected (401)
- Audit logs capture auth attempts and high-risk actions
- iOS app has no admin UI or `/api/admin/*` route calls
- Defense in depth: Middleware re-queries `is_admin` on every request

---

## Instructions for Worker

1. Do not write code yet. This is architecture only.
2. When implementation begins, create the following components:
   - `/middleware/adminAuth.js` (requireAdmin middleware)
   - `/auth/appleVerify.js` (Apple token verification logic)
   - `/routes/adminAuth.js` (POST /api/admin/auth/apple endpoint)
3. Apply `requireAdmin` middleware to all `/api/admin/*` routes in `server.js`.
4. Add structured logging for audit events (use existing logger or add JSON logging).
5. Store `ADMIN_JWT_SECRET` in Railway environment variables.
6. Test all validation steps in order.
7. Remove or disable any `/api/admin/*` endpoints not used by the Admin Web App.

---

## Final Notes

This handoff is complete and implementation-ready. No further architecture decisions are required. Proceed with backend and frontend implementation following the flow and enforcement described above.
