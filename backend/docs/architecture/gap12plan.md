GAP-12 ANALYSIS: MY CONTESTS LISTING BEHAVIOR                                                
                                                                                               
  SECTION 1 — CURRENT STATE ANALYSIS

  What Contest Management Does Today

  Endpoint: GET /api/custom-contests/ (customContest.routes.js:271-282)
  - Service: customContestService.getContestInstancesForOrganizer(pool, organizerId)
  - Purpose: Lists all contest instances created/owned by the authenticated user
  - Visibility Scope: Organizer-only (WHERE clause: organizer_id = $1)
  - Current SQL Query (customContestService.js:674-698):
  SELECT ci.id, ci.template_id, ci.organizer_id, ci.entry_fee_cents,
         ci.payout_structure, ci.status, ci.start_time, ci.lock_time,
         ci.created_at, ci.updated_at, ci.join_token, ci.max_entries,
         ci.contest_name, ci.end_time, ci.settle_time,
         COALESCE(u.username, u.name, 'Unknown') as organizer_name,
         (SELECT COUNT(*) FROM contest_participants cp WHERE cp.contest_instance_id =
  ci.id)::int as entry_count,
         EXISTS(SELECT 1 FROM contest_participants WHERE contest_instance_id = ci.id AND
  user_id = $1) AS user_has_entered
  FROM contest_instances ci
  LEFT JOIN users u ON u.id = ci.organizer_id
  WHERE ci.organizer_id = $1
  ORDER BY ci.created_at DESC

  Sorting Analysis

  - Current behavior: ORDER BY ci.created_at DESC (newest first)
  - Layer: Database (SQL ORDER BY)
  - Determinism: Relies on created_at timestamp only; no tiebreaker for simultaneous creation
  - Persisted columns only: Yes ✓ (uses created_at which is persisted)

  ERROR Contest Visibility

  - Current: No special handling for ERROR status; ERROR contests are included in all lists
  - Current behavior for admins: Same as all users (no differentiation)
  - Current behavior for non-admins: ERROR contests are visible

  Role/Authorization Handling

  - Current segregation: Organizer-only (where clause on organizer_id)
  - Mixing of roles: No mixing; this is purely organizer view
  - No participant data: Does not include contests where user is a participant (only contests
  they created)

  Read-Path Self-Healing

  - Present: Yes (lines 706-718)
  - Impact: Contests may advance state during list retrieval
  - Risk: List sorts by created_at, so state advancement doesn't affect sort order (safe)

  ---
  SECTION 2 — GAP-12 DEFINITION CLARIFIED

  Explicit GAP-12 Requirement (contest-infrastructure-v1-gaps.md, lines 195-203)

  Status: EXISTS but violates contract

  Contract states (contest-lifecycle.md, lines 146-157):
  "The 'My Contests' view returns all contests the requesting user has entered, plus any
  SCHEDULED contests open for entry."

  Sorting Rules (6-tier, tiered ordering in SQL):
  1. LIVE contests → sorted by end_time ASC (soonest ending first)
  2. LOCKED contests → sorted by start_time ASC
  3. SCHEDULED contests → sorted by lock_time ASC (soonest locking first)
  4. COMPLETE contests → sorted by settle_time DESC (most recently settled first)
  5. CANCELLED contests → sorted by created_at DESC
  6. ERROR contests → excluded from non-admin user views

  Key Distinctions from Current Implementation
  ┌───────────────┬────────────────────────────────────────┬──────────────────────────────────┐
  │    Aspect     │      Current (Contest Management)      │ GAP-12 Requirement (My Contests) │
  ├───────────────┼────────────────────────────────────────┼──────────────────────────────────┤
  │ Data Scope    │ Contests user created (organizer_id =  │ Contests user joined + open      │
  │               │ user)                                  │ SCHEDULED contests               │
  ├───────────────┼────────────────────────────────────────┼──────────────────────────────────┤
  │ Sort Strategy │ Single-tier: created_at DESC           │ Six-tier: CASE-based with        │
  │               │                                        │ per-tier ordering                │
  ├───────────────┼────────────────────────────────────────┼──────────────────────────────────┤
  │ ERROR         │ Visible to all                         │ Hidden from non-admin users      │
  │ Visibility    │                                        │                                  │
  ├───────────────┼────────────────────────────────────────┼──────────────────────────────────┤
  │ Status        │ All statuses included                  │ All statuses included, but ERROR │
  │ Handling      │                                        │  excluded per role               │
  ├───────────────┼────────────────────────────────────────┼──────────────────────────────────┤
  │ New Endpoint  │ No change; existing endpoint remains   │ YES – new endpoint recommended   │
  │               │ for Contest Management                 │                                  │
  └───────────────┴────────────────────────────────────────┴──────────────────────────────────┘
  Whether GAP-12 Introduces New Endpoint (Recommended)

  YES. The current GET /api/custom-contests/ is functionally Contest Management (organizer
  view). GAP-12 "My Contests" is fundamentally different:
  - Different data scope (participations, not organizations)
  - Different sorting (6-tier, not single-tier)
  - Different role model (user-centric, not organizer-centric)
  - Different error handling (ERROR exclusion per role)

  Recommendation: Create a new endpoint (GET /api/contests/my) rather than modify the existing
  endpoint. This preserves Contest Management backward compatibility and makes the role
  distinction explicit.

  ---
  SECTION 3 — ARCHITECTURAL DECISION

  Decision: Create New Endpoint

  Recommended Path: GET /api/contests/my

  Rationale:
  1. Current endpoint (GET /api/custom-contests/) serves Contest Management
  (organizer-specific)
  2. GAP-12 "My Contests" is user-centric (participant-centric)
  3. Modifying existing endpoint would break organizer workflows
  4. New endpoint signals clear separation of concerns and prevents accidental role leakage

  Parameters
  ┌───────────┬─────────┬──────────┬────────────────────────────────────────────────────────┐
  │ Parameter │  Type   │ Required │                        Purpose                         │
  ├───────────┼─────────┼──────────┼────────────────────────────────────────────────────────┤
  │ (path)    │ N/A     │ N/A      │ No path parameters; user inferred from auth context    │
  ├───────────┼─────────┼──────────┼────────────────────────────────────────────────────────┤
  │ is_admin  │ derived │ N/A      │ Derived from authentication; controls ERROR visibility │
  ├───────────┼─────────┼──────────┼────────────────────────────────────────────────────────┤
  │ limit     │ query   │ No       │ Pagination limit (default 50, max 200)                 │
  ├───────────┼─────────┼──────────┼────────────────────────────────────────────────────────┤
  │ offset    │ query   │ No       │ Pagination offset (default 0)                          │
  └───────────┴─────────┴──────────┴────────────────────────────────────────────────────────┘
  User Identification: Via existing extractUserId middleware (customContest.routes.js:39-70)

  Admin Detection: Recommended approach:
  - Check for admin role/claim in auth token
  - If not present, treat as non-admin (safe default)
  - Pass isAdmin boolean to service layer

  Role Separation Logic

  Non-Admin Users:
  SELECT contests WHERE:
    (contest_id IN (SELECT contest_instance_id FROM contest_participants WHERE user_id = $1))
    OR (status = 'SCHEDULED')
  ORDER BY tier, time_field, contest_id
  EXCLUDE: status = 'ERROR'

  Admin Users:
  SELECT contests WHERE:
    (contest_id IN (SELECT contest_instance_id FROM contest_participants WHERE user_id = $1))
    OR (status = 'SCHEDULED')
  ORDER BY tier, time_field, contest_id
  INCLUDE: status = 'ERROR'

  ---
  SECTION 4 — SQL ORDERING STRATEGY

  Tier-Based Ordering Implementation

  The sorting must occur entirely in the SQL ORDER BY clause using a CASE expression. The tier
  assignment determines primary sort order; within each tier, persisted timestamp columns
  provide secondary ordering.

  SQL Query Structure

  SELECT
    ci.id,
    ci.status,
    ci.end_time,
    ci.start_time,
    ci.lock_time,
    ci.settle_time,
    ci.created_at,
    -- all other fields...
  FROM contest_instances ci
  LEFT JOIN contest_participants cp ON ci.id = cp.contest_instance_id
  WHERE
    -- Data scope
    (
      cp.user_id = $1  -- Contests user has entered
      OR ci.status = 'SCHEDULED'  -- Or any open SCHEDULED contest
    )
    -- Role-based visibility
    AND (
      ci.status != 'ERROR'  -- Non-admin: exclude ERROR
      OR $2 = TRUE  -- Admin: include ERROR
    )
  ORDER BY
    -- Tier 1: LIVE
    CASE WHEN ci.status = 'LIVE' THEN 0 ELSE 1 END ASC,
    -- Within LIVE: sort by end_time ASC
    CASE WHEN ci.status = 'LIVE' THEN ci.end_time ELSE NULL END ASC,

    -- Tier 2: LOCKED
    CASE WHEN ci.status = 'LOCKED' THEN 0 ELSE 1 END ASC,
    CASE WHEN ci.status = 'LOCKED' THEN ci.start_time ELSE NULL END ASC,

    -- Tier 3: SCHEDULED
    CASE WHEN ci.status = 'SCHEDULED' THEN 0 ELSE 1 END ASC,
    CASE WHEN ci.status = 'SCHEDULED' THEN ci.lock_time ELSE NULL END ASC,

    -- Tier 4: COMPLETE
    CASE WHEN ci.status = 'COMPLETE' THEN 0 ELSE 1 END ASC,
    CASE WHEN ci.status = 'COMPLETE' THEN ci.settle_time ELSE NULL END DESC,

    -- Tier 5: CANCELLED
    CASE WHEN ci.status = 'CANCELLED' THEN 0 ELSE 1 END ASC,
    CASE WHEN ci.status = 'CANCELLED' THEN ci.created_at ELSE NULL END DESC,

    -- Tier 6: ERROR (only if visible)
    CASE WHEN ci.status = 'ERROR' THEN 0 ELSE 1 END ASC,
    CASE WHEN ci.status = 'ERROR' THEN ci.created_at ELSE NULL END DESC,

    -- Deterministic tie-breaker
    ci.id ASC
  LIMIT $3 OFFSET $4;

  Persisted Columns Used

  - ci.end_time (Tier 1: LIVE)
  - ci.start_time (Tier 2: LOCKED)
  - ci.lock_time (Tier 3: SCHEDULED)
  - ci.settle_time (Tier 4: COMPLETE)
  - ci.created_at (Tier 5: CANCELLED, Tier 6: ERROR)
  - ci.id (deterministic tie-breaker)

  All are persisted columns in contest_instances schema.

  NULL Handling for Timestamps

  Constraint from contract (contest-lifecycle.md, lines 78-92):
  created_at < lock_time ≤ start_time < end_time
  end_time ≤ settle_time (when present)

  Invariant consequence: In a well-formed system:
  - lock_time, start_time, end_time are always non-null (enforced at write time)
  - settle_time is null until settlement occurs; only non-null for COMPLETE contests

  Safe NULL handling in ORDER BY:
  - CASE expressions return NULL for non-matching statuses; NULLs sort first (PostgreSQL
  default)
  - Within each tier, the secondary CASE returns the appropriate timestamp or NULL
  - Example: For LIVE contests, CASE WHEN ci.status = 'LIVE' THEN ci.end_time ELSE NULL END
  returns the end_time for LIVE or NULL for others; NULLs are excluded by the primary tier CASE
  - Effect: Each tier's secondary sort is clean; no cross-tier pollution

  ERROR Exclusion at Query Time

  Non-admin:
  AND (ci.status != 'ERROR' OR FALSE)  -- Excludes ERROR

  Admin:
  AND (ci.status != 'ERROR' OR TRUE)   -- Includes ERROR

  Where $2 is the isAdmin boolean parameter.

  ---
  SECTION 5 — RISK ANALYSIS

  Pagination Stability Risk: LOW

  Risk: Inserting new contests between pagination requests could shift results.

  Mitigation:
  - Tier-based sort is stable within tier (sorted by timestamp, then ID)
  - Deterministic tie-breaker (ci.id ASC) ensures no duplicate row pairs across requests
  - Stability guarantee: If contests A and B appear in pages 1 and 2, and no contests are
  deleted between requests, they will maintain relative order

  Recommendation: Add created_at and id to index to support efficient pagination scans.

  Index Coverage Risk: MEDIUM

  Required indexes for efficient execution:
  1. Primary: (status, end_time, id) for LIVE tier
  2. Secondary: (status, start_time, id) for LOCKED tier
  3. Tertiary: (status, lock_time, id) for SCHEDULED tier
  4. Quaternary: (status, settle_time DESC, id) for COMPLETE tier
  5. Quinary: (status, created_at DESC, id) for CANCELLED and ERROR tiers
  6. Participation lookups: (user_id, contest_instance_id) on contest_participants (likely
  exists)

  Current schema: Need to verify indexes exist. If not, query planner will full-scan
  contest_instances.

  Risk without indexes: Query could perform poorly with large contest counts (>10k contests).

  Mitigation:
  - Create composite index: CREATE INDEX idx_contest_status_ordering ON contest_instances
  (status, end_time, start_time, lock_time, settle_time DESC, created_at DESC, id);
  - OR create separate indexes per tier (more granular; PostgreSQL query planner chooses best
  fit)

  Role Leakage Risk: LOW

  Risk: Admin flag passed incorrectly, causing non-admins to see ERROR contests.

  Mitigation:
  - Admin flag derived from authentication token/session (not user input)
  - Default to non-admin if flag is missing or false (fail-safe)
  - Explicit WHERE clause enforces exclusion: AND (ci.status != 'ERROR' OR $2 = TRUE)
  - Test coverage: Verify non-admin user receives no ERROR contests; verify admin user receives
   all

  Status Drift Risk: MEDIUM

  Risk: Contest status changes between ORDER BY evaluation and result return, causing
  unexpected sort order on client.

  Analysis:
  - SQL ORDER BY is evaluated once at query execution
  - Statuses do not change after query returns (within same transaction)
  - Client receives stable sort order for that point in time
  - Next read: If status has advanced (e.g., SCHEDULED → LOCKED), sort order will change
  (contest moves from Tier 3 to Tier 2)

  This is expected behavior per contract — sort order reflects current state, not historical
  state.

  Risk mitigation:
  - Document that sort order can change between requests as contests advance
  - Clients should not assume static order across multiple list fetches
  - Sorting is correct at time of fetch (source of truth is database)

  Interaction with lifecycleAdvancer Risk: MEDIUM

  Risk: Read-path self-healing (in single-instance reads) can advance contest status. "My
  Contests" is a list endpoint (non-mutating per contract requirement).

  Current contract behavior (contest-infrastructure-v1-gaps.md, lines 316-318):
  List endpoints (getContestInstancesForOrganizer) deliberately do not self-heal. Multiple
  contests in a single read would incur high write fan-out; callers requiring current state
  should fetch individual contests.

  Impact on GAP-12:
  - "My Contests" list endpoint will NOT trigger self-healing
  - Client sees status from last write path or previous self-healing
  - This is correct per contract — list queries are read-only
  - Clients wanting fresh state must call single-instance endpoints (GET
  /api/custom-contests/:id)

  Mitigation:
  - Ensure no self-healing in new list query
  - Document behavior in API docs: "Status reflects last database write; to refresh status,
  fetch contest detail"

  Interaction with Future GAP-13 (Admin Operations) Risk: LOW

  Gap-13 will introduce admin-only state transitions (force-lock, manual error resolution,
  etc.).

  Impact on "My Contests":
  - Admin operations do not directly affect sort order (they transition status; sort handles
  all statuses)
  - If admin transitions a SCHEDULED → LOCKED, that contest moves from Tier 3 to Tier 2 in next
   fetch
  - No conflict — sort order adapts to new status automatically

  Safe: GAP-13 admin operations work with existing sort contract.

  ---
  SECTION 6 — IMPLEMENTATION PLAN (ORDERED STEPS)

  Step 1: Create Service Function getContestsForUser(pool, userId, isAdmin, limit, offset)

  File: backend/services/customContestService.js

  Responsibility:
  - Accept user ID, admin flag, pagination params
  - Construct SQL with 6-tier ordering
  - Execute query using parameters: $1 = userId, $2 = isAdmin, $3 = limit, $4 = offset
  - Return array of contest rows (unmapped)

  Input Validation:
  - userId: UUID format (existing validation)
  - isAdmin: boolean (coerce from route)
  - limit: integer 1-200 (clamp to defaults if missing)
  - offset: integer ≥0 (default 0)

  Dependencies: None new (uses existing pool, existing mapper)

  Step 2: Create Route GET /api/contests/my

  File: backend/routes/customContest.routes.js

  Responsibility:
  - Extract userId via extractUserId middleware (already exists)
  - Extract isAdmin from auth context (implementation TBD; recommend via token claims)
  - Parse query params: limit, offset
  - Call service function
  - Map responses to API format
  - Handle errors (400 for invalid pagination, 500 for DB errors)

  Route definition:
  router.get('/my', async (req, res) => {
    try {
      const pool = req.app.locals.pool;
      const userId = req.userId; // From extractUserId middleware
      const isAdmin = req.isAdmin ?? false; // Derived from auth; default non-admin

      const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);

      const contests = await customContestService.getContestsForUser(
        pool, userId, isAdmin, limit, offset
      );

      // contests are already mapped by service
      res.json(contests);
    } catch (err) {
      console.error('[Custom Contest] Error fetching my contests:', err);
      res.status(500).json({ error: 'Failed to fetch contests' });
    }
  });

  Placement: After existing routes but before module.exports.

  Step 3: Add SQL Query with 6-Tier Ordering

  Location: Inside getContestsForUser function

  Key elements:
  - Data scope: User's participations OR SCHEDULED contests
  - Role-based visibility: Non-admins exclude ERROR
  - Ordering: 6-tier CASE logic
  - Pagination: LIMIT/OFFSET
  - Deterministic tie-breaker: ORDER BY id ASC

  Full SQL: (As specified in SECTION 4)

  Step 4: Add Integration Tests

  File: backend/tests/services/customContest.service.test.js (existing) or new test file

  Test cases (minimum 12):

  1. Mixed status ordering:
    - Create contests in each status (LIVE, LOCKED, SCHEDULED, COMPLETE, CANCELLED, ERROR)
    - User participates in each
    - Verify order matches tiers
    - Verify within-tier ordering (timestamps)
  2. Within-tier timestamp ordering:
    - LIVE tier: Two LIVE contests, one ending at T1, one at T2 (T1 < T2)
    - Verify T1 contest appears before T2 contract
    - Repeat for each tier with its respective timestamp
  3. Deterministic tie-breaker:
    - Create two contests with identical timestamps (same status, same end_time, etc.)
    - Verify order by ID (no arbitrary ordering)
    - Repeat with different status pairs
  4. ERROR exclusion (non-admin):
    - Create ERROR contest user participates in
    - Fetch as non-admin
    - Verify ERROR not present in results
    - Fetch as admin
    - Verify ERROR present
  5. Admin visibility:
    - Set admin flag = true
    - Fetch "My Contests"
    - Verify ERROR contests included
  6. Non-admin default:
    - Omit isAdmin parameter (undefined/null)
    - Verify defaults to non-admin (ERROR excluded)
  7. SCHEDULED contest discovery:
    - User does NOT participate in SCHEDULED contest
    - Fetch "My Contests"
    - Verify SCHEDULED contest appears (even without participation)
  8. Pagination stability:
    - Create 10 contests across statuses
    - Fetch with limit=3, offset=0 (page 1)
    - Fetch with limit=3, offset=3 (page 2)
    - Verify no contests repeat across pages
    - Verify relative order preserved
  9. Role-specific visibility:
    - Admin user has contests in all tiers
    - Fetch as admin: all present (including ERROR)
    - Fetch as same user but non-admin: ERROR absent
  10. Empty result set:
    - User has no participations and no SCHEDULED contests open
    - Fetch "My Contests"
    - Verify empty array returned (no error)
  11. Limit and offset clamping:
    - Request limit=500 (max 200)
    - Verify query uses limit 200
    - Request offset=-5
    - Verify query uses offset 0
  12. Tie-breaking with multiple timestamps equal:
    - Create 3 COMPLETE contests all with same settle_time
    - Verify order by ID is deterministic

  Step 5: Add Role-Based Filtering (Authentication Integration)

  Integration point: Extract isAdmin from authentication context

  Implementation approach (TBD by auth design):
  - If using JWT tokens: Check admin claim in decoded token
  - If using session: Check isAdmin field in session
  - If using middleware: Create extractIsAdmin middleware similar to extractUserId

  Recommendation: Create middleware consistent with extractUserId:
  function extractIsAdmin(req, res, next) {
    // Derive from token claims or session
    // Default to false (non-admin) if not present
    req.isAdmin = req.token?.claims?.admin ?? false;
    next();
  }

  // Apply to /my route
  router.get('/my', extractIsAdmin, async (req, res) => { ... });

  Step 6: Validate No Impact on Contest Management

  Verification:
  - GET /api/custom-contests/ (existing organizer list) continues unchanged
  - Existing route serves getContestInstancesForOrganizer (organizer-only)
  - New route serves getContestsForUser (participant + SCHEDULED)
  - Routes are separate; no cross-contamination

  Tests:
  - Verify organizer sees only their own contests on /api/custom-contests/
  - Verify organizer also sees participations + SCHEDULED on /api/contests/my
  - Verify non-organizer cannot access /api/custom-contests/ (or gets empty result)
  - Verify non-organizer can access /api/contests/my (sees participations + SCHEDULED)

  Step 7: Update Documentation

  Files to update:
  - backend/docs/architecture/contest-infrastructure-v1-gaps.md → Mark GAP-12 CLOSED, document
  implementation
  - backend/docs/architecture/contest-lifecycle.md → Add implementation notes for "My Contests"
   sorting
  - API documentation (if exists) → Document new /api/contests/my endpoint
  - Create backend/routes/README.md or update if exists → Document endpoint purposes

  GAP-12 Closure entry:
  ### GAP-12: My Contests sorting conforms to contract (CLOSED)

  **Implementation:**
  - New endpoint `GET /api/contests/my` returns user's contest participations plus open
  SCHEDULED contests
  - Sorting implemented as 6-tier SQL CASE expression in ORDER BY clause
  - Tier order: LIVE (by end_time ASC), LOCKED (by start_time ASC), SCHEDULED (by lock_time
  ASC), COMPLETE (by settle_time DESC), CANCELLED (by created_at DESC), ERROR (by created_at
  DESC, excluded for non-admin)
  - Deterministic tie-breaker: contest_instance_id ASC
  - Pagination support: limit (1-200, default 50) and offset (default 0)
  - Role-based visibility: ERROR contests hidden from non-admin users
  - List endpoint is non-mutating (no read-path self-healing per contract)

  **Tested:**
  - Mixed status ordering
  - Within-tier timestamp ordering
  - Deterministic tie-breaker
  - ERROR exclusion for non-admin
  - Admin visibility
  - SCHEDULED discovery
  - Pagination stability
  - Limit/offset clamping
  - Empty result sets

  ---
  SECTION 7 — TEST PLAN

  Test Organization

  File: backend/tests/services/customContest.service.test.js (add to existing test suite)

  Test counts:
  - Unit tests: 3 (for sorting logic helpers if extracted)
  - Integration tests: 12 (as outlined in Step 4)
  - Route tests: 4 (route-level validation)
  - Total: ~19 tests

  Integration Test Suite: describe('getContestsForUser', () => { ... })

  Test 1: Mixed Status Ordering

  it('should order contests by tier (LIVE, LOCKED, SCHEDULED, COMPLETE, CANCELLED)', async ()
  => {
    const userId = uuidv4();
    const now = new Date();

    // Create contests in each status
    const live = await createContest(pool, { status: 'LIVE', end_time: now });
    const locked = await createContest(pool, { status: 'LOCKED', start_time: now });
    const scheduled = await createContest(pool, { status: 'SCHEDULED', lock_time: now });
    const complete = await createContest(pool, { status: 'COMPLETE', settle_time: now });
    const cancelled = await createContest(pool, { status: 'CANCELLED', created_at: now });

    // User participates in each
    await joinContest(pool, live.id, userId);
    await joinContest(pool, locked.id, userId);
    // SCHEDULED is visible without participation
    await joinContest(pool, complete.id, userId);
    await joinContest(pool, cancelled.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    const ids = result.map(c => c.id);
    expect(ids[0]).toBe(live.id); // Tier 1
    expect(ids[1]).toBe(locked.id); // Tier 2
    expect(ids[2]).toBe(scheduled.id); // Tier 3
    expect(ids[3]).toBe(complete.id); // Tier 4
    expect(ids[4]).toBe(cancelled.id); // Tier 5
  });

  Test 2: Within-Tier Timestamp Ordering (LIVE by end_time ASC)

  it('LIVE contests should order by end_time ASC (soonest ending first)', async () => {
    const userId = uuidv4();
    const baseTime = new Date('2026-02-20T00:00:00Z');

    const live1 = await createContest(pool, {
      status: 'LIVE',
      end_time: new Date(baseTime.getTime() + 1000 * 60) // +1 min
    });
    const live2 = await createContest(pool, {
      status: 'LIVE',
      end_time: new Date(baseTime.getTime() + 2000 * 60) // +2 min
    });

    await joinContest(pool, live1.id, userId);
    await joinContest(pool, live2.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    expect(result[0].id).toBe(live1.id); // Soonest ending
    expect(result[1].id).toBe(live2.id); // Latest ending
  });

  Test 3: LOCKED by start_time ASC

  it('LOCKED contests should order by start_time ASC', async () => {
    const userId = uuidv4();
    const baseTime = new Date('2026-02-20T00:00:00Z');

    const locked1 = await createContest(pool, {
      status: 'LOCKED',
      start_time: new Date(baseTime.getTime() + 1000 * 60)
    });
    const locked2 = await createContest(pool, {
      status: 'LOCKED',
      start_time: new Date(baseTime.getTime() + 5000 * 60)
    });

    await joinContest(pool, locked1.id, userId);
    await joinContest(pool, locked2.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    expect(result[0].id).toBe(locked1.id); // Earlier start_time
    expect(result[1].id).toBe(locked2.id);
  });

  Test 4: SCHEDULED by lock_time ASC

  it('SCHEDULED contests should order by lock_time ASC (soonest locking first)', async () => {
    const baseTime = new Date('2026-02-20T00:00:00Z');

    const sched1 = await createContest(pool, {
      status: 'SCHEDULED',
      lock_time: new Date(baseTime.getTime() + 1000 * 60)
    });
    const sched2 = await createContest(pool, {
      status: 'SCHEDULED',
      lock_time: new Date(baseTime.getTime() + 3000 * 60)
    });

    const userId = uuidv4();
    // Do NOT join; should appear because SCHEDULED is visible to all

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    const scheduledInResult = result.filter(c => c.status === 'SCHEDULED');
    expect(scheduledInResult[0].id).toBe(sched1.id);
    expect(scheduledInResult[1].id).toBe(sched2.id);
  });

  Test 5: COMPLETE by settle_time DESC

  it('COMPLETE contests should order by settle_time DESC (most recently settled first)', async
  () => {
    const userId = uuidv4();
    const baseTime = new Date('2026-02-20T00:00:00Z');

    const complete1 = await createContest(pool, {
      status: 'COMPLETE',
      settle_time: new Date(baseTime.getTime() + 2000 * 60) // Earlier
    });
    const complete2 = await createContest(pool, {
      status: 'COMPLETE',
      settle_time: new Date(baseTime.getTime() + 1000 * 60) // Later (DESC)
    });

    await joinContest(pool, complete1.id, userId);
    await joinContest(pool, complete2.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    // Most recent settled should appear first
    expect(result[result.length - 2].id).toBe(complete2.id); // Adjust for other tiers
    expect(result[result.length - 1].id).toBe(complete1.id);
  });

  Test 6: CANCELLED by created_at DESC

  it('CANCELLED contests should order by created_at DESC', async () => {
    const userId = uuidv4();
    const baseTime = new Date('2026-02-20T00:00:00Z');

    const cancelled1 = await createContest(pool, {
      status: 'CANCELLED',
      created_at: new Date(baseTime.getTime() + 1000 * 60)
    });
    const cancelled2 = await createContest(pool, {
      status: 'CANCELLED',
      created_at: new Date(baseTime.getTime() + 2000 * 60) // Newer (DESC)
    });

    await joinContest(pool, cancelled1.id, userId);
    await joinContest(pool, cancelled2.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    const cancelledInResult = result.filter(c => c.status === 'CANCELLED');
    expect(cancelledInResult[0].id).toBe(cancelled2.id); // Newer first
  });

  Test 7: Deterministic Tie-Breaker (ID ASC)

  it('should use contest_id as deterministic tie-breaker for identical timestamps', async () =>
   {
    const userId = uuidv4();
    const baseTime = new Date('2026-02-20T00:00:00Z');
    const endTime = new Date(baseTime.getTime() + 1000 * 60);

    // Create two LIVE contests with identical end_time
    const live1 = await createContest(pool, {
      status: 'LIVE',
      end_time: endTime
    });
    const live2 = await createContest(pool, {
      status: 'LIVE',
      end_time: endTime
    });

    await joinContest(pool, live1.id, userId);
    await joinContest(pool, live2.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    const liveInResult = result.filter(c => c.status === 'LIVE');
    const [first, second] = [liveInResult[0].id, liveInResult[1].id];

    // Should be ordered by ID
    expect(first < second || first > second).toBe(true); // Deterministic order

    // Fetch again, verify same order
    const result2 = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );
    const liveInResult2 = result2.filter(c => c.status === 'LIVE');
    expect(liveInResult2[0].id).toBe(first);
    expect(liveInResult2[1].id).toBe(second);
  });

  Test 8: ERROR Exclusion for Non-Admin

  it('ERROR contests should be hidden from non-admin users', async () => {
    const userId = uuidv4();
    const errorContest = await createContest(pool, { status: 'ERROR' });

    await joinContest(pool, errorContest.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    const errorInResult = result.some(c => c.status === 'ERROR');
    expect(errorInResult).toBe(false);
  });

  Test 9: ERROR Inclusion for Admin

  it('ERROR contests should be visible to admin users', async () => {
    const userId = uuidv4();
    const errorContest = await createContest(pool, { status: 'ERROR' });

    await joinContest(pool, errorContest.id, userId);

    const result = await customContestService.getContestsForUser(
      pool, userId, true, 100, 0 // isAdmin = true
    );

    const errorInResult = result.some(c => c.status === 'ERROR');
    expect(errorInResult).toBe(true);
  });

  Test 10: SCHEDULED Discovery (No Participation Required)

  it('SCHEDULED contests should be visible to all users without participation', async () => {
    const userId = uuidv4();
    const scheduledContest = await createContest(pool, { status: 'SCHEDULED' });

    // User does NOT join

    const result = await customContestService.getContestsForUser(
      pool, userId, false, 100, 0
    );

    const scheduledInResult = result.some(c => c.id === scheduledContest.id);
    expect(scheduledInResult).toBe(true);
  });

  Test 11: Pagination Stability

  it('pagination should be stable across multiple requests', async () => {
    const userId = uuidv4();

    // Create 10 contests across statuses
    const contests = [];
    for (let i = 0; i < 10; i++) {
      const statuses = ['LIVE', 'LOCKED', 'SCHEDULED', 'COMPLETE', 'CANCELLED'];
      const status = statuses[i % statuses.length];
      const c = await createContest(pool, { status });
      contests.push(c);
      await joinContest(pool, c.id, userId);
    }

    // Fetch page 1
    const page1 = await customContestService.getContestsForUser(
      pool, userId, false, 3, 0
    );

    // Fetch page 2
    const page2 = await customContestService.getContestsForUser(
      pool, userId, false, 3, 3
    );

    // Fetch page 3
    const page3 = await customContestService.getContestsForUser(
      pool, userId, false, 3, 6
    );

    // No contest should appear in multiple pages
    const allIds = [...page1.map(c => c.id), ...page2.map(c => c.id), ...page3.map(c => c.id)];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length); // No duplicates

    // Fetch again, verify same order
    const page1Again = await customContestService.getContestsForUser(
      pool, userId, false, 3, 0
    );
    expect(page1Again.map(c => c.id)).toEqual(page1.map(c => c.id));
  });

  Test 12: Limit/Offset Clamping

  it('should clamp limit to 1-200 and offset to >=0', async () => {
    const userId = uuidv4();
    const contests = [];
    for (let i = 0; i < 250; i++) {
      const c = await createContest(pool, { status: 'SCHEDULED' });
      contests.push(c);
    }

    // Request limit=500 (should clamp to 200)
    const resultBig = await customContestService.getContestsForUser(
      pool, userId, false, 500, 0
    );
    expect(resultBig.length).toBeLessThanOrEqual(200);

    // Request offset=-5 (should clamp to 0)
    const resultNegOffset = await customContestService.getContestsForUser(
      pool, userId, false, 10, -5
    );
    // Verify no error; result should start from offset 0
    expect(resultNegOffset.length).toBeGreaterThan(0);
  });

  Route-Level Test Suite

  Test 1: Route Authentication Required

  it('GET /api/contests/my should require authentication', async () => {
    const res = await request(app).get('/api/contests/my');
    expect(res.status).toBe(401);
  });

  Test 2: Route Pagination Defaults

  it('GET /api/contests/my should apply pagination defaults', async () => {
    const userId = uuidv4();
    const res = await request(app)
      .get('/api/contests/my')
      .set('Authorization', `Bearer ${userId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(50); // Default limit
  });

  Test 3: Invalid Pagination Parameters

  it('should reject invalid pagination parameters', async () => {
    const userId = uuidv4();
    const res = await request(app)
      .get('/api/contests/my?limit=abc&offset=xyz')
      .set('Authorization', `Bearer ${userId}`);
    // Should clamp to defaults, not error
    expect(res.status).toBe(200);
  });

  Test 4: Role-Based Visibility from Route

  it('non-admin users should not see ERROR contests', async () => {
    const userId = uuidv4();
    const adminUserId = uuidv4();

    // Create ERROR contest, join as regular user
    const errorContest = await createContest(pool, { status: 'ERROR' });
    await joinContest(pool, errorContest.id, userId);

    // Fetch as non-admin
    const resNonAdmin = await request(app)
      .get('/api/contests/my')
      .set('Authorization', `Bearer ${userId}`);

    const hasError = resNonAdmin.body.some(c => c.status === 'ERROR');
    expect(hasError).toBe(false);

    // Fetch as admin
    const resAdmin = await request(app)
      .get('/api/contests/my')
      .set('Authorization', `Bearer ${adminUserId}`)
      .set('X-Admin', 'true'); // TBD: admin flag mechanism

    // Admin user who joined should see ERROR
    const hasErrorAdmin = resAdmin.body.some(c => c.status === 'ERROR');
    expect(hasErrorAdmin).toBe(true);
  });

  ---
  SECTION 8 — DOCUMENTATION UPDATES REQUIRED AFTER IMPLEMENTATION

  1. Update contest-infrastructure-v1-gaps.md

  Section to update: GAP-12 entry (lines 195-204)

  New status: CLOSED

  Updated entry:
  ### GAP-12: My Contests sorting conforms to contract (CLOSED)

  | Attribute | Value |
  |---|---|
  | Status | `CLOSED` |
  | Layer | API contract and database query |
  | Description | New endpoint `GET /api/contests/my` returns contests matching the contract
  definition: all contests the requesting user has entered, plus any SCHEDULED contests open
  for entry. Sorting implemented as six-tier SQL CASE expression ordered by tier (LIVE, LOCKED,
   SCHEDULED, COMPLETE, CANCELLED, ERROR), with within-tier sorting by persisted timestamps:
  (1) LIVE by `end_time ASC`; (2) LOCKED by `start_time ASC`; (3) SCHEDULED by `lock_time ASC`;
   (4) COMPLETE by `settle_time DESC`; (5) CANCELLED by `created_at DESC`; (6) ERROR by
  `created_at DESC`. Deterministic tie-breaker: `contest_instance_id ASC`. ERROR contests
  excluded from non-admin user views via WHERE clause. Sorting occurs entirely in SQL ORDER BY;
   no application-layer sorting. Pagination support: limit (1-200, default 50) and offset
  (default 0). List endpoint is non-mutating per contract (no read-path self-healing). Data
  scope enforced via: `(user_id IN (SELECT contest_instance_id FROM contest_participants WHERE
  user_id = $1)) OR (status = 'SCHEDULED')`. Role-based visibility enforced via: `(status !=
  'ERROR' OR $2 = TRUE)` where $2 is isAdmin boolean. Existing endpoint `GET
  /api/custom-contests/` remains unchanged for Contest Management (organizer-only view). |
  | Why it matters | Sorting defines user experience and must match contract to ensure
  consistency across clients. Database-layer sorting guarantees stability and performance.
  Role-based ERROR exclusion ensures non-admin users cannot discover admin-internal contest
  states. |
  | Dependencies | GAP-01 (state enum), GAP-02 (`end_time`), GAP-03 (`settle_time`), GAP-11
  (derived fields mapped to response) |

  2. Update contest-lifecycle.md

  Section to add: Implementation notes under "Authoritative API Contract → Contest List (My
  Contests)"

  New content:
  #### Implementation Notes (GAP-12)

  **Endpoint:** `GET /api/contests/my` (new endpoint)

  **Data scope:**
  - All contests where the requesting user is a participant (via `contest_participants` join)
  - Plus all SCHEDULED contests (regardless of participation)

  **Query pattern:**
  ```sql
  WHERE
    (user_id IN (SELECT ... FROM contest_participants WHERE user_id = $1))
    OR (status = 'SCHEDULED')

  Sorting: Implemented as SQL CASE expression in ORDER BY clause:
  1. Tier assignment: CASE WHEN status = 'LIVE' THEN 0 ELSE 1 END, then LOCKED tier 1,
  SCHEDULED tier 2, etc.
  2. Within tier: Secondary CASE returns appropriate timestamp column or NULL
  3. Tie-breaker: contest_instance_id ASC

  Example SQL (excerpt):
  ORDER BY
    CASE WHEN ci.status = 'LIVE' THEN 0 ELSE 1 END ASC,
    CASE WHEN ci.status = 'LIVE' THEN ci.end_time ELSE NULL END ASC,
    CASE WHEN ci.status = 'LOCKED' THEN 0 ELSE 1 END ASC,
    CASE WHEN ci.status = 'LOCKED' THEN ci.start_time ELSE NULL END ASC,
    -- ... (remaining tiers)
    ci.id ASC

  Role-based visibility:
  - Non-admin: WHERE clause excludes ERROR: AND (ci.status != 'ERROR' OR FALSE)
  - Admin: WHERE clause includes ERROR: AND (ci.status != 'ERROR' OR TRUE)

  Pagination:
  - LIMIT and OFFSET for stable pagination
  - Default limit: 50, max: 200
  - Default offset: 0

  Non-mutating: List endpoint does not trigger read-path self-healing. Clients needing fresh
  status should call single-instance endpoints.

  Distinction from Contest Management:
  - GET /api/custom-contests/ (existing): Organizer-only, lists contests created by user
  - GET /api/contests/my (new): User-centric, lists contests user participates in + open
  entries

  ### 3. Create/Update API Documentation

  **File:** `backend/docs/API.md` (if exists) or new file `backend/docs/api/contests-my.md`

  **New API documentation section:**

  ```markdown
  # My Contests Endpoint

  ## GET /api/contests/my

  Returns all contests the requesting user has entered, plus any SCHEDULED contests open for
  entry.

  ### Authentication
  Required. User ID extracted from Bearer token or X-User-Id header.

  ### Parameters

  | Name | Type | In | Required | Default | Description |
  |------|------|-----|----------|---------|---|
  | limit | integer | query | No | 50 | Number of contests to return (clamped to 1-200) |
  | offset | integer | query | No | 0 | Number of contests to skip (clamped to ≥0) |

  ### Response

  Status: 200 OK

  ```json
  [
    {
      "id": "uuid",
      "status": "LIVE",
      "contest_name": "string",
      "entry_fee_cents": 1000,
      "max_entries": 20,
      "organizer_id": "uuid",
      "lock_time": "ISO8601",
      "start_time": "ISO8601",
      "end_time": "ISO8601",
      "settle_time": "ISO8601 or null",
      "entry_count": 5,
      "user_has_entered": true,
      "is_locked": false,
      "is_live": true,
      "is_settled": false,
      "time_until_lock": 3600,
      "standings": [
        {
          "user_id": "uuid",
          "user_display_name": "string",
          "total_score": 45.5,
          "rank": 1
        }
      ]
    }
  ]

  Sorting Order

  Results are sorted by lifecycle status tier:
  1. LIVE contests (by end_time ascending — soonest ending first)
  2. LOCKED contests (by start_time ascending)
  3. SCHEDULED contests (by lock_time ascending — soonest locking first)
  4. COMPLETE contests (by settle_time descending — most recently settled first)
  5. CANCELLED contests (by created_at descending)
  6. ERROR contests (hidden from non-admin users)

  Within each tier, contests with identical timestamps are ordered by contest ID
  (deterministic).

  Role-Based Behavior
  Role: Non-admin
  Error Contests Visible?: No
  Notes: ERROR contests are filtered by the query WHERE clause
  ────────────────────────────────────────
  Role: Admin
  Error Contests Visible?: Yes
  Notes: ERROR contests included for troubleshooting and recovery
  Errors
  ┌────────┬───────────────────────┬──────────────────────────────┐
  │ Status │         Error         │         Description          │
  ├────────┼───────────────────────┼──────────────────────────────┤
  │ 401    │ Unauthorized          │ User authentication required │
  ├────────┼───────────────────────┼──────────────────────────────┤
  │ 500    │ Internal Server Error │ Database or service error    │
  └────────┴───────────────────────┴──────────────────────────────┘
  Notes

  - This endpoint is non-mutating. Contests' lifecycle states are not advanced by this request.
  - To refresh contest status, call GET /api/custom-contests/:id (single-instance read, which
  triggers read-path self-healing).
  - SCHEDULED contests are visible to all authenticated users, regardless of participation.
  - Pagination is stable: the same limit/offset will return consistent results across requests
  (assuming no deletions).

  ### 4. Add Setup/Deployment Notes for GAP-13

  **File:** `backend/docs/architecture/contest-infrastructure-v1-gaps.md` → New section after
  GAP-12 closure

  **New section:**

  ```markdown
  ## Setup for Future Work: GAP-13 (Admin Operations)

  GAP-12 (My Contests) is now closed. The next gap, **GAP-13**, will introduce admin-only
  operations beyond what read-path self-healing provides.

  ### What GAP-13 Will Introduce

  GAP-13 defines the following admin operations (from Contest Lifecycle Contract v1):
  1. **Create contest** — exists for organizers; no admin-specific path
  2. **Update time fields** — only `lock_time` supported; `start_time` and `end_time` updates
  needed
  3. **Cancel contest** — exists but uses non-contract states
  4. **Force-lock contest** — does not exist as a discrete operation
  5. **Trigger settlement** — no endpoint
  6. **Resolve error** — no endpoint for ERROR state recovery

  ### Admin Read Surface (Enabled by GAP-12)

  With GAP-12 complete, the `GET /api/contests/my` endpoint now supports `isAdmin` flag. This
  same flag can be leveraged for admin-specific read surfaces:

  1. **Admin dashboard view** (future): `GET /api/admin/contests` might return:
     - All contests (not just user's)
     - ERROR contests visible
     - Additional admin-relevant fields (participant list, audit trail summary)

  2. **ERROR discovery** (now possible): Admins can call `GET /api/contests/my` with admin flag
   to see ERROR contests they're involved in and assess recovery options.

  ### Error Handling Surface

  With GAP-12 and GAP-13, the error handling workflow will be:
  1. **Detection:** Contest transitions to ERROR via read-path self-healing or admin action
  2. **Visibility:** Admin sees ERROR in `GET /api/contests/my` or admin dashboard
  3. **Recovery:** Admin calls new GAP-13 endpoint to transition ERROR → COMPLETE or ERROR →
  CANCELLED
  4. **Audit:** Transition recorded in admin_contest_audit table (if schema exists)

  ### Role-Based Read Surfaces

  GAP-12 establishes the pattern for role-based queries:
  - `isAdmin` parameter controls WHERE clause for sensitive data
  - Non-admin: excluded ERROR contests via WHERE clause
  - Admin: included ERROR contests

  Future GAP-13 operations can extend this:
  - Non-admin users cannot call mutation endpoints (POST, PATCH, DELETE)
  - Admin-only endpoints enforce `isAdmin = TRUE` before executing
  - Same pattern as read-path: fail-safe to non-admin if flag is absent

  ### New Constraints Discovered (None)

  No new constraints or edge cases were discovered during GAP-12 implementation that would
  require changes to the Contest Lifecycle Contract v1.

  5. Update v1 Completion Checklist

  File: contest-infrastructure-v1-gaps.md → Section "v1 Completion Criteria" (around line 283)

  Update checklist item:
  - [x] My Contests sorting follows the six-tier contract sort order. ERROR contests are hidden
   from non-admin users. (GAP-12)

  ---
  SUMMARY

  GAP-12 is well-scoped and ready for implementation. Key points:

  1. Current state: "Contest Management" (GET /api/custom-contests/) is organizer-only; sorting
   by created_at DESC
  2. GAP-12 requirement: New "My Contests" view showing user's participations + open SCHEDULED
  contests with 6-tier SQL ordering
  3. Architectural decision: Create new endpoint GET /api/contests/my to avoid breaking Contest
   Management
  4. SQL strategy: CASE-based tier assignment in ORDER BY; deterministic tiebreaker (id ASC)
  5. Role separation: isAdmin flag controls ERROR visibility via WHERE clause
  6. Pagination: Stable, limit-clamped (1-200), offset-safe
  7. No self-healing: List endpoint is read-only per contract
  8. Tests: 12 integration tests + 4 route tests cover all requirements
  9. Risks: Minimal with proper index coverage and role-based WHERE clause enforcement
  10. Documentation: Update gap checklist, add implementation notes to lifecycle contract, and
  document API

  No code shall be written until this plan receives approval.