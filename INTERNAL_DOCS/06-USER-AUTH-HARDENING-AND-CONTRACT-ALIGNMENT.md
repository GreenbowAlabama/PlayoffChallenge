# Phase 08: User Auth Hardening & Contract Alignment

**Status**: Ready for Implementation
**Scope**: Authentication patterns, API contract, status codes, tests
**NOT Included**: Deletion logic, FK violation fixes, real user authentication
**Estimated Effort**: 2-3 days
**Risk Level**: Low (backward-compatible, refactoring only)

---

## Executive Summary

This phase hardens the `DELETE /api/user` endpoint and establishes clear patterns for user-context endpoints without touching underlying deletion logic or architecture.

**Outcomes**:
- ✅ User identity validation moved to centralized middleware
- ✅ Status codes aligned to REST semantics (400/404/500, not 401 for missing user)
- ✅ API contract documented in OpenAPI (endpoint no longer undocumented)
- ✅ Tests updated to match implementation and enforce deterministic behavior
- ✅ Security debt explicitly logged and visible to future engineers
- ✅ Naming clarified (middleware is `requireUserContext`, not authentication)

**What This Does NOT Do**:
- ❌ Fix identity verification (X-User-Id is still client-supplied)
- ❌ Fix FK constraint violations (deletion still fails with 500 if user has dependencies)
- ❌ Implement real authentication (JWT, session tokens, OAuth)
- ❌ Implement soft-delete or PII anonymization

These are intentionally deferred to later phases.

---

## Prerequisites

**Questions Answered**:

1. **Is X-User-Id trusted?** NO. It is client-supplied with no cryptographic verification. Interim model only.
2. **Should global security be added to OpenAPI?** NO. Requires endpoint-by-endpoint audit first. Public endpoints would be incorrectly marked as protected.
3. **What status codes should be used?** 400 (invalid header), 404 (user not found), 500 (server error). NOT 401 for missing user (that's for actual auth failure).
4. **Is middleware execution order safe?** YES, if added route-by-route (not globally).
5. **Should tests accept ambiguous outcomes?** NO. Tests must enforce deterministic behavior with dedicated fixtures.

---

## Architecture Decision: User Context vs User Authentication

**Distinction**:

| Aspect | User Context | User Authentication |
|--------|--------------|-------------------|
| **What it validates** | Header format only | Identity + permissions |
| **What it does** | Attaches user ID to request | Verifies cryptographic token |
| **Implementation** | UUID regex validation | JWT/session/OAuth verification |
| **Current Status** | ✅ This phase | ❌ Deferred (Phase 10+) |

**This phase implements ONLY user context middleware.**

Naming is critical: call it `requireUserContext()`, not `requireUserAuth()`.
Future engineers must understand this is not real authentication.

---

## Phase 1: Security Debt Documentation

### 1A. Create Security Debt Log

**File**: `/backend/docs/SECURITY_DEBT_LOG.md`

```markdown
# Security Debt Log

Registry of known security issues, planned fixes, and temporary mitigations.

---

## SECURITY-DEBT-001: User Identity is Client-Supplied

**Status**: OPEN (Phase 08)
**Severity**: HIGH
**Introduced**: Phase 08 Auth Hardening
**Component**: All non-admin endpoints (`/api/users/*`, `/api/custom-contests/*`, `/api/picks/*`, `DELETE /api/user`)
**Reviewer**: Backend Team
**Scheduled Fix**: Phase 10 (User Authentication Redesign)

### Description

User identity is conveyed via `X-User-Id` header:
- Supplied by client (iOS app)
- NOT cryptographically signed or verified
- Backend trusts header value as-is
- No session token or JWT issued

This is a **trust-on-first-write** identity model.

### Attack Vector

Any user can impersonate any other user:

```bash
DELETE /api/user
X-User-Id: <victim-uuid>
```

This endpoint would delete the victim's account if FK constraints didn't accidentally prevent it.

### Accepted Risk

This model is acceptable ONLY if:
- MVP is closed beta (bounded users)
- Users cannot practically enumerate UUIDs
- Monitoring detects abuse patterns
- Real auth is planned within 6-12 weeks

**For public production with financial transactions: UNACCEPTABLE.**

### Temporary Mitigations (Interim)

1. Rate limit account deletion (5 requests per hour)
2. Audit log all deletion attempts (successful and failed)
3. Require iOS app to show confirmation dialog before DELETE
4. Monitor for unusual deletion patterns (>2 deletions per hour)
5. Restrict to closed beta until Phase 10 complete

### Remediation Path

Implement Phase 10: User Authentication Redesign
- Replace X-User-Id with Bearer JWT
- Issue tokens at login, bind to session
- Verify token on every protected endpoint
- Estimated effort: 2-3 weeks

---

## SECURITY-DEBT-002: Foreign Key Violations Block Deletion

**Status**: OPEN (Phase 08)
**Severity**: HIGH
**Component**: `DELETE /api/user` endpoint
**Root Cause**: Hard-delete violates FK RESTRICT on ledger, payment_intents, payout_requests
**Scheduled Fix**: Phase 09 (Soft-Delete Architecture)

### Description

`DELETE /api/user` attempts hard-delete but fails with PostgreSQL error 23503 (FK violation) if user has:
- Ledger entries (any financial transaction)
- Payment intents (any Stripe record)
- Payout requests (any pending/processed payout)
- Contest participation (any joined/organized contest)

**Current behavior**:
1. Client calls DELETE /api/user
2. Endpoint returns 500 "Failed to delete account"
3. User sees generic error, thinks deletion failed
4. User remains in database (accidentally safe)

**Accidental safety**: FK constraints prevent data corruption, but:
- User has no idea why deletion failed
- Ledger/contest records are orphaned mid-operation
- Append-only ledger policy is violated
- Settlement audit trail is broken if deletion somehow succeeded

### Why This Isn't Simple

Hard-delete is impossible without:
1. Cascading deletion of all contests (breaking user history)
2. Cascading deletion of all ledger entries (breaking financial audit)
3. Breaking settlement idempotency (re-settlement can't reference deleted user)

### Remediation Path

Implement Phase 09: Soft-Delete + PII Anonymization
- Keep user record (for FK integrity)
- Nullify PII (email, name, phone, address)
- Mark as deleted_at (soft-delete timestamp)
- Update ledger/contest queries to filter out deleted users
- Preserve all financial records
- Estimated effort: 1-2 weeks

### Temporary Mitigation

Document in DELETE /api/user endpoint:
- "Deletion will fail with 500 if user has contests or financial history"
- Direct user to close contests before attempting deletion
- Add helper endpoint: GET /api/user/:userId/deletion-blockers

---
```

This file is **discoverable** and **updateable**. It's not buried in code comments.

---

## Phase 2: Centralized Middleware

### 2A. Create UUID Validation Utility

**File**: `/backend/lib/uuidValidation.js` (NEW)

```javascript
/**
 * UUID Validation Utility
 *
 * Shared validation for all endpoints that use UUIDs in headers or parameters.
 * Single source of truth for UUID format.
 */

/**
 * Validate UUID format
 *
 * Accepts any standard UUID variant (v1, v4, etc.)
 * Case-insensitive.
 *
 * @param {string} str - String to validate
 * @returns {boolean} True if valid UUID format
 */
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  // Regex accepts any UUID version, uppercase or lowercase
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Validate multiple UUIDs
 *
 * @param {string[]} uuids - Array of UUID strings
 * @returns {boolean} True if all are valid
 */
function areValidUUIDs(uuids) {
  if (!Array.isArray(uuids)) return false;
  return uuids.every(uuid => isValidUUID(uuid));
}

module.exports = {
  isValidUUID,
  areValidUUIDs
};
```

**Usage**:
- Reusable across all endpoints
- Single validation function (no duplication)
- Matches how system generates UUIDs (`gen_random_uuid()`)

---

### 2B. Create User Context Middleware

**File**: `/backend/middleware/userContextMiddleware.js` (NEW)

```javascript
/**
 * User Context Middleware
 *
 * Extract and validate X-User-Id header, attach to request context.
 *
 * ⚠️  CRITICAL: This is NOT authentication.
 *
 * It only validates that the header contains a valid UUID format.
 * There is no cryptographic verification, no session binding, no ownership check.
 *
 * The X-User-Id is a client-supplied identifier.
 * Backend trusts it without verification (see SECURITY-DEBT-001).
 *
 * Status Codes:
 * - 400: Missing or invalid UUID format (client error)
 * - Route handler is responsible for 404, 409, 500
 *
 * Usage:
 *   app.delete('/api/user', requireUserContext(), handler);
 */

const { isValidUUID } = require('../lib/uuidValidation');

/**
 * Middleware: Extract and validate X-User-Id header
 *
 * On success: Sets req.userId
 * On failure: Returns 400 with error message
 *
 * @returns {Function} Express middleware function
 */
function requireUserContext() {
  return (req, res, next) => {
    const userId = req.headers['x-user-id'];

    if (!userId) {
      return res.status(400).json({
        error: 'Missing X-User-Id header'
      });
    }

    if (!isValidUUID(userId)) {
      return res.status(400).json({
        error: 'Invalid X-User-Id format (must be valid UUID)'
      });
    }

    // Validation passed: attach to request for downstream handlers
    req.userId = userId;
    next();
  };
}

module.exports = {
  requireUserContext
};
```

**Key Points**:
- Single middleware function (no dual-path helpers)
- Clear comments about what it is NOT (authentication)
- Only validates format (400)
- Downstream handler handles existence/permission checks
- Naming is explicit: `requireUserContext`, not `requireUserAuth`

---

## Phase 3: Update DELETE /api/user Handler

**File**: `/backend/server.js:2686` (MODIFY)

```javascript
const { requireUserContext } = require('./middleware/userContextMiddleware');

// ==============================================
// ACCOUNT DELETION ENDPOINT
// ==============================================

/**
 * DELETE /api/user - Permanently delete the authenticated user's account
 *
 * Requires: X-User-Id header with valid UUID
 *
 * ⚠️  Identity Model: X-User-Id is client-supplied without cryptographic verification.
 *     See SECURITY-DEBT-001 in docs/SECURITY_DEBT_LOG.md
 *
 * ⚠️  Deletion Behavior: May fail with 500 if user has ledger/payment/contest data.
 *     See SECURITY-DEBT-002 in docs/SECURITY_DEBT_LOG.md
 *
 * Status Codes:
 * - 200: User deleted successfully
 * - 400: Missing or invalid X-User-Id header
 * - 404: User not found
 * - 500: Server error (e.g., FK constraint, transaction rollback)
 */
app.delete('/api/user', requireUserContext(), async (req, res) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const userId = req.userId;  // Set by requireUserContext middleware

    // Step 1: Verify user exists (lightweight SELECT, no transaction needed yet)
    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'User not found' });
    }

    // Step 2: User exists. Begin transaction for deletion.
    // (Transaction started AFTER existence check to minimize lock scope)
    await client.query('BEGIN');
    inTransaction = true;

    console.log(`[ACCOUNT DELETION] Deleting user: ${userId}`);

    // Step 3: Delete user and cascade (picks, player_swaps, scores)
    // Future: Will need to handle FK RESTRICT violations (see SECURITY-DEBT-002)
    await usersService.deleteUserById(client, userId);

    await client.query('COMMIT');

    console.log(`[ACCOUNT DELETION] User ${userId} permanently deleted`);

    client.release();
    res.json({ success: true });
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    client.release();
    console.error('Error deleting user account:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});
```

**Changes**:
- ✅ Add `requireUserContext()` middleware
- ✅ Extract `userId` from `req.userId` (set by middleware, not query param)
- ✅ Check existence BEFORE BEGIN (better transaction scope)
- ✅ Return 404 for "user not found" (not 401)
- ✅ Add comments linking to security debt log
- ✅ Document status codes

---

## Phase 4: Update OpenAPI Contract

**File**: `/backend/contracts/openapi.yaml` (MODIFY)

### 4A. Add Security Schemes Reference (at components level)

```yaml
components:
  securitySchemes:
    UserIdHeader:
      type: apiKey
      in: header
      name: X-User-Id
      description: |
        User UUID for request context.

        ⚠️  INTERIM AUTH MODEL: This is a client-supplied header, not a cryptographic token.
        Backend trusts the value without verification (see SECURITY-DEBT-001).

        Planned replacement in Phase 10: JWT-based authentication with token verification.
```

### 4B. Add DELETE /api/user Endpoint

Add to `paths:` section:

```yaml
  /api/user:
    delete:
      tags:
        - Users
      summary: Delete user account
      description: |
        Permanently delete the authenticated user's account.
        Requires X-User-Id header with valid UUID.
      operationId: deleteUser
      parameters:
        - name: X-User-Id
          in: header
          required: true
          schema:
            type: string
            format: uuid
          description: User UUID to delete
      responses:
        '200':
          description: User deleted successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                    example: true
        '400':
          description: Missing or invalid X-User-Id header
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              examples:
                missingHeader:
                  value:
                    error: Missing X-User-Id header
                invalidUUID:
                  value:
                    error: Invalid X-User-Id format (must be valid UUID)
        '404':
          description: User not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error: User not found
        '500':
          description: Server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error: Failed to delete account
```

**Design Decisions**:
- ✅ Does NOT apply global `security:` block (requires endpoint-by-endpoint audit first)
- ✅ Documents only current behavior (no "future 409" promises)
- ✅ Keeps description clean (internal debt not exposed in contract)
- ✅ Explicitly lists X-User-Id in parameters (not hidden in security scheme)

---

## Phase 5: Update Tests

**File**: `/backend/tests/routes/users.routes.test.js` (MODIFY)

```javascript
/**
 * Users Routes Contract Tests
 *
 * Purpose: Lock in API contract for user-related endpoints
 * - POST /api/auth/register
 * - POST /api/auth/login
 * - GET /api/users/:userId
 * - PUT /api/users/:userId
 * - PUT /api/users/:userId/accept-tos
 * - DELETE /api/user
 * - GET /api/me/flags
 *
 * These tests verify response shapes and validation behavior.
 * Auth tests use invalid credentials to avoid side effects.
 */

const request = require('supertest');
const { getIntegrationApp } = require('../mocks/testAppFactory');
const { TEST_IDS } = require('../fixtures');

describe('Users Routes Contract Tests', () => {
  let app;

  beforeAll(() => {
    const { app: integrationApp } = getIntegrationApp();
    app = integrationApp;
  });

  // ... existing tests for register, login, GET/PUT /api/users/:userId, etc. ...

  describe('DELETE /api/user - Header-Based Auth', () => {
    it('should return 400 when X-User-Id header is missing', async () => {
      const response = await request(app)
        .delete('/api/user');
      // No header set

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Missing X-User-Id/i);
    });

    it('should return 400 when X-User-Id is not a valid UUID format', async () => {
      const response = await request(app)
        .delete('/api/user')
        .set('X-User-Id', 'not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Invalid X-User-Id/i);
    });

    it('should accept uppercase UUIDs (case-insensitive validation)', async () => {
      const response = await request(app)
        .delete('/api/user')
        .set('X-User-Id', 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX');

      // UUID validation is case-insensitive, so this should NOT return 400
      expect(response.status).not.toBe(400);
    });

    it('should return 404 when user does not exist', async () => {
      const nonExistentUserId = '00000000-0000-0000-0000-000000000001';
      const response = await request(app)
        .delete('/api/user')
        .set('X-User-Id', nonExistentUserId);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('User not found');
    });

    it('should return 200 when user is successfully deleted', async () => {
      // Use a dedicated test fixture user that has no dependencies
      // This user is created specifically for deletion testing
      const deletableUserId = TEST_IDS.users.deletableTestUser;

      if (!deletableUserId) {
        this.skip(); // Skip if fixture not available
        return;
      }

      // Precondition: Verify user exists in DB
      const pool = require('../db/pool'); // or get from app.locals
      const preCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [deletableUserId]
      );
      if (preCheck.rows.length === 0) {
        this.skip(); // Fixture unavailable
        return;
      }

      // Execute deletion
      const response = await request(app)
        .delete('/api/user')
        .set('X-User-Id', deletableUserId);

      // Contract: Successful deletion returns 200
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(true);

      // Postcondition: Verify user was actually deleted
      const postCheck = await pool.query(
        'SELECT id FROM users WHERE id = $1',
        [deletableUserId]
      );
      expect(postCheck.rows.length).toBe(0);
    });
  });

  // ... existing tests for GET /api/me/flags, etc. ...
});
```

**Test Design**:
- ✅ Separate test for each error condition
- ✅ No ambiguous [200, 404] acceptance (deterministic)
- ✅ Dedicated fixture for safe-to-delete user
- ✅ Precondition checks (skip if fixture unavailable)
- ✅ Postcondition verification (actually deleted)
- ✅ Tests enforce contract, not just shape

---

## Phase 6: Test Fixture Setup

**File**: `/backend/tests/fixtures.js` (MODIFY)

Add to TEST_IDS:

```javascript
const TEST_IDS = {
  users: {
    validUser: 'xxxxx-valid-user-id-xxxxx',
    nonExistent: 'xxxxx-nonexistent-user-id-xxxxx',
    deletableTestUser: 'xxxxx-deletable-test-user-xxxxx', // ← NEW
    // ... other users
  },
  // ... other fixtures
};

module.exports = { TEST_IDS };
```

**Setup**:
- Create a test user in migrations/test-fixtures
- This user has NO ledger entries, NO contests, NO payments
- Only used for deletion tests
- Recreated before each test run (or marked for cleanup)

---

## Implementation Checklist

### Pre-Implementation
- [ ] Review `SECURITY_DEBT_LOG.md` and confirm risk acceptance
- [ ] Confirm with team: is X-User-Id interim model acceptable until Phase 10?
- [ ] Confirm deletion logic will NOT change in this phase

### Implementation
- [ ] Create `/backend/docs/SECURITY_DEBT_LOG.md`
- [ ] Create `/backend/lib/uuidValidation.js`
- [ ] Create `/backend/middleware/userContextMiddleware.js`
- [ ] Modify `/backend/server.js:2686` (DELETE /api/user handler)
- [ ] Update `/backend/contracts/openapi.yaml` (add endpoint + securitySchemes)
- [ ] Update `/backend/tests/routes/users.routes.test.js`
- [ ] Update `/backend/tests/fixtures.js` (add deletableTestUser)

### Testing
- [ ] Run unit tests: `npm test -- tests/routes/users.routes.test.js`
- [ ] Verify middleware execution order (middleware should run BEFORE handler)
- [ ] Verify req.userId is not shadowed elsewhere
- [ ] Manual test: Call DELETE /api/user without header → 400
- [ ] Manual test: Call DELETE /api/user with invalid UUID → 400
- [ ] Manual test: Call DELETE /api/user with nonexistent user → 404
- [ ] Manual test: Call DELETE /api/user with valid deletable user → 200

### Code Review
- [ ] Verify no other endpoints use query-param user auth
- [ ] Verify middleware is applied consistently across user endpoints
- [ ] Verify SECURITY_DEBT_LOG is accessible and clear
- [ ] Verify OpenAPI contract matches implementation
- [ ] Verify test fixture is setup and cleaned up correctly

### Deployment
- [ ] Update CHANGELOG (note breaking change in auth header)
- [ ] Coordinate with iOS team: X-User-Id header now REQUIRED in body
- [ ] Coordinate with API consumers: status codes now 400/404, not 401/500

---

## Rollback Plan

If issues arise:

1. **Tests fail**: Revert middleware, return to query-param auth
2. **Middleware conflicts**: Remove middleware, add inline validation back
3. **OpenAPI issues**: Revert OpenAPI, endpoint remains undocumented
4. **Fixture problems**: Skip deletion tests until fixture setup resolved

All changes are isolated (no cascading effects). Rollback to previous version is safe.

---

## Success Criteria

**Phase 08 is complete when**:

- ✅ All DELETE /api/user tests pass
- ✅ OpenAPI accurately documents endpoint
- ✅ Status codes match REST semantics (400/404/500)
- ✅ SECURITY_DEBT_LOG is discoverable and clear
- ✅ Middleware is applied consistently
- ✅ No contract drift remains
- ✅ Code review approved

---

## What Comes Next

**Phase 09: Soft-Delete + PII Anonymization** (blocks on Phase 08 complete)
- Replace hard-delete with soft-delete
- Nullify PII on deletion
- Update queries to filter deleted users
- Handle FK RESTRICT gracefully

**Phase 10: User Authentication Redesign** (separate track)
- Implement JWT-based auth
- Issue tokens at login
- Require token on all protected endpoints
- Replace X-User-Id with Authorization header
- Retire SECURITY-DEBT-001

---

## References

- **SECURITY_DEBT_LOG.md**: Detailed risk assessment and mitigation plan
- **RFC-001**: Decision on X-User-Id interim model (see separate doc)
- **OpenAPI 3.0 Spec**: https://spec.openapis.org/oas/v3.0.3
- **HTTP Status Codes**: https://httpwg.org/specs/rfc7231.html#status.codes
- **OWASP**: REST Security Best Practices

---

**Document Version**: 1.0
**Last Updated**: 2026-02-19
**Status**: Ready for Implementation
