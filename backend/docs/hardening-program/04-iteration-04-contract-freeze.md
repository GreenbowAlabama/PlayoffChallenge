# Iteration 04 – Backend Contract Freeze + Canonical Documentation

## Objective

Freeze all public API contracts and establish canonical documentation that makes the backend's behavior observable without code reading.

The backend must:
- Have explicit, documented contracts for every route
- Contracts must be binding; violations are bugs
- All data types are defined with examples
- All error responses are enumerated
- Frontend and admin tools can build against contracts, not guesses
- Contract violations are detected and prevent deployment

---

## Architectural Constraints

### Contracts Are Law
- Every route has an explicit, immutable contract
- Changing a contract is a breaking change; must be version-bumped
- Contract violations are bugs; fix them before merging
- Contracts are documentation; keep them accurate

### No Implicit Behavior
- If a behavior is not documented in the contract, it doesn't exist
- Error codes are enumerated; surprise errors are bugs
- Response shape is explicit; optional fields are marked `?`
- All side effects (DB writes, state changes) are documented

### Single Source of Truth
- Each service documents its own contracts
- Contracts are co-located with code (API docs or JSDoc)
- Contracts are generated into a canonical OpenAPI/GraphQL schema
- Frontend and mobile build against generated schema, not assumptions

---

## SOLID Enforcement

### Explicit Interfaces
- **Route contracts**: Every endpoint has explicit input/output schema
- **Service contracts**: Every service method has explicit input/output
- **Error contracts**: All error codes are enumerable
- **State contracts**: Lifecycle transitions are explicit (no implicit states)

**Document these contracts** in `/backend/routes/API-CONTRACTS.md` and service-level CLAUDE.md files

### No Implicit Behavior
- Every error response is documented with error code and reason
- Every optional field is marked with `?` in schema
- Every side effect (database write, state change) is documented
- No undocumented endpoints; no hidden admin routes

### Admin Endpoint Classification (Required)
- **All admin endpoints must**:
  - Require role-based auth (e.g., `role: 'admin'`)
  - Be marked clearly as internal (e.g., `/api/admin/*`)
  - Be excluded from public OpenAPI schema unless explicitly flagged
  - Have audit logging for all mutations
- **Classification Rule**: Endpoint path starting with `/api/admin/` is automatically internal; no public schema exposure without explicit approval
- **Public vs. Internal**: Contracts must explicitly state if endpoint is public (user-facing) or internal (admin-only)

### Dependency Direction
```
Frontend/Mobile → Generated Schema (from contracts)
                → Backend OpenAPI/GraphQL endpoint
                → Contracts (source of truth)
```
Contracts are the interface; code is the implementation.

### Version Control
- Contracts are versioned with the API
- Breaking changes increment major version
- Non-breaking changes increment minor version
- Deprecation warnings precede removal (2 versions minimum)

### Production Compatibility Rule

Production deploy must maintain backward compatibility with the currently released mobile app.

- **Production deploy must be backward-compatible with currently released mobile app**: Backend changes must never break the app version that is currently live in App Store / Play Store.
  - Verify that all endpoint responses are compatible with current app expectations
  - If response schema changes, ensure all fields are additive (new optional fields OK; removing/renaming fields is breaking)
  - Reject breaking changes unless app version is updated first

- **Breaking API changes require version bump before release**: If a breaking change is necessary, bump API version (major version) before deploying to production.
  - Example: `/api/v1/contests` → `/api/v2/contests` if contract breaks backward compatibility
  - Old version continues to function (deprecated, not deleted) for 2+ releases

- **Contract freeze must precede production promotion**: Do not freeze contracts and immediately deploy to production. Freeze must be reviewed and approved before production deploy.
  - Staging deployment = frozen contracts tested against live data
  - Production promotion = explicit decision after staging validation

- **OpenAPI schema must be regenerated before merge**: Before closing this iteration, regenerate OpenAPI schema from route definitions.
  - Schema is canonical contract
  - Merge blocker if schema generation fails or is out of sync
  - Schema diff must be reviewed in PR

This prevents UI chaos from backend changes. Breaking API changes cause mobile app crashes, which damages user trust and increases support burden.

---

## Data Model Impact

### Schema Changes Required
- `api_contract_versions` table: history of contract changes
- `error_code_registry` table: enumeration of all possible errors
- No schema changes required; contracts are documentation only

### Critical Constraint
- API version is immutable once released
- Contracts are never edited; only new versions created
- Deprecated endpoints are never deleted; marked as deprecated with sunset date

---

## Contract Impact

### Breaking Changes (If Required)
- Must be explicitly enumerated in migration guide
- Must include version bump (major.minor.patch)
- Must be tested against both old and new clients
- Must be communicated in release notes

### Contract Freezing Rules
1. All routes have explicit contracts (no implicit behavior)
2. All error codes are enumerated
3. All data types are defined with examples
4. All optional fields are marked
5. All deprecations are annotated with sunset date

### Documentation Requirements
- **OpenAPI schema** for all HTTP endpoints
- **Service interface documentation** for all services
- **Error catalog** for all error codes
- **Lifecycle state diagram** for contest states
- **Field validation rules** for all data

---

## Validation Rules

### Contract Validation (At Merge Time)
1. Every route has explicit schema documentation
2. Every error response is documented with code
3. Every optional field is marked with `?`
4. All examples are executable and valid
5. All error codes are unique and enumerable

### Runtime Contract Validation
1. Responses match documented schema
2. Error codes are from enumerated list
3. No undocumented fields in response
4. No breaking changes to existing endpoints

### Silent Failures Not Allowed
- Contract violations are logged with stack trace
- Response shape mismatches are caught by unit tests
- Error code not found in registry is a failure
- Missing documentation is a merge blocker

---

## Failure Modes

### Contract Violations
- **Response field missing**: Test fails; developer must update contract or fix code
- **Error code not enumerated**: Request is rejected; must be added to registry
- **Breaking change**: Merge blocker; must version endpoint or create new one
- **Undocumented endpoint**: Merge blocker; must document or remove

### Migration Failures
- **Old client calls deprecated endpoint**: Endpoint returns deprecation warning; continues to work
- **New client expects missing field**: Client code fails; must handle gracefully or wait for release
- **Version mismatch**: API returns version in response; client can validate compatibility

### Recovery
- Contract violation: Fix code or update contract (not both silently)
- Missing documentation: Add to contract before merging
- Breaking change: Bump version; create migration guide; test both versions

---

## Unit Test Requirements

### Contract Schema Tests
- All routes return documented schema
- All error responses use enumerated error codes
- All optional fields are truly optional
- All required fields are present
- All examples are valid and executable

### Error Code Tests
- Every documented error code can be triggered
- No error code is returned that's not documented
- Error messages are consistent and helpful
- Error codes map to HTTP status codes correctly

### Type Validation Tests
- All response fields have correct type
- All arrays have correct element type
- All objects have correct property types
- All enums use documented values only

### Version Compatibility Tests
- Old client can call old endpoint
- Deprecated endpoint returns sunset warning
- New endpoint accepts new fields
- Backward-compatible endpoints accept old requests

### API Contract Tests
- Each route returns documented response
- Each route rejects invalid input with documented error
- Each route handles missing authorization correctly
- Each route handles invalid content-type correctly

---

## Completion Criteria

✓ All routes have explicit input/output schemas
✓ All error codes are enumerated in registry
✓ All error responses documented with code and reason
✓ All optional fields marked with `?`
✓ All examples are valid and tested
✓ OpenAPI schema generated and up-to-date
✓ Service contracts are explicit and documented
✓ No implicit behavior; all documented behavior is explicit
✓ Contract violations are caught by tests and merge blockers
✓ Version control in place for breaking changes
✓ Schema snapshot is updated and committed
✓ No undocumented assumptions remain

---

## Lessons Learned

*To be completed upon iteration closure*

### What Worked
(Document successes)

### What Was Harder Than Expected
(Document surprises)

### Assumptions We Purged
(Document implicit behaviors we discovered and removed)

### Decisions For Next Iteration
(Document architectural choices that affect iteration 04)

### Contract Ownership
(Document who maintains which contracts)

---

## Next Steps

Once this iteration closes:
- Iteration 05 begins: Operational + Technical Runbooks
- Contracts are frozen; breaking changes require explicit versioning
- Frontend and mobile build against generated schema
- No further changes to contract structure without explicit iteration plan
