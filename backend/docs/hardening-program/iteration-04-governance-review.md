(a) Updated checklist order of operations (Iteration 04)
	1.	Governance preflight

	•	Confirm env isolation is still true (no code conditionals per env, only env vars).  ￼
	•	Confirm payment remains lifecycle-independent (no contest state mutation from payment paths).  ￼  ￼
	•	Confirm idempotency invariants remain DB-backed (unique keys, append-only triggers).  ￼

	2.	DB foundation (run SQL below)

	•	Add contract freeze primitives (append-only API contract snapshots, error code registry).
	•	Add optional “failure visibility” storage (append-only dead-letter table) as a foundation, even if Phase 04 only designs/queries it.  ￼

	3.	Tests first (Phase 04 hardening targets)

	•	Add replay attack simulation tests.  ￼
	•	Add signature failure tests (ensure 0 DB writes on invalid signature).  ￼
	•	Add duplicate event stress tests (local only, CI gated).  ￼

	4.	Contract freeze outputs

	•	Generate canonical OpenAPI from route schemas, freeze it (hash + stored artifact).
	•	Freeze error code registry (must match what routes actually emit).
	•	Confirm “no breaking API changes without version bump” by asserting OpenAPI diff rules (additive only for public routes).  ￼

	5.	Documentation closure

	•	Update Iteration 04 .md (final guarantees, non-goals, and verification steps).
	•	Update DECISION-LOG.md for any iteration numbering mismatches noted below.
	•	Update LESSONS-LEARNED.md (Iteration 04 section).
	•	Update DB schema snapshot and commit.  ￼

Decision-log compliance note (do this during doc closure)
	•	Decision "Explicit Error Codes (No Generic Errors)" is labeled "Iteration 03 - Contract Freeze" but contract freeze is Iteration 04 per the program restructure. Update the iteration number to 04 to remove drift.  ￼  ￼
	•	Decision "Runbooks Executable By Ops" is labeled "Iteration 04 - Runbooks" but runbooks are now Iteration 06 after the payout restructure (Iteration 05 = Automatic Payout). Update to Iteration 06 to remove drift.  ￼  ￼
	•	New Decision: "Automatic Payout Required for Survivability" added to DECISION-LOG for Iteration 05-06 restructure.  ￼
	•	No decision is violated by Phase 04 as planned. The work is hardening, tests, and documentation. No abstraction creep.  ￼  ￼

(b) Test matrix
	1.	Stripe webhook idempotency and replay

	•	tests/api/webhook-replay.test.js
	•	5 concurrent deliveries of same evt_* results in:
	•	stripe_events: 1 row
	•	ledger: 1 row (idempotency key unique)
	•	payment_intents.status: stable, no race regressions  ￼  ￼

	2.	Stripe signature validation failures (must have zero side effects)

	•	tests/api/webhook-signature.test.js
	•	missing stripe-signature header -> 400 and no stripe_events insert
	•	tampered body with signature -> 400 and no inserts
	•	valid JSON but invalid signature -> 400 and no inserts  ￼

	3.	Duplicate delivery stress (pathological retry storms)

	•	tests/api/webhook-stress.test.js
	•	50 rapid duplicates
	•	100 rapid duplicates
	•	500 concurrent replays (local, not CI by default)
	•	asserts no deadlocks, and exactly 1 row per unique evt_* in stripe_events and ledger  ￼

	4.	Contract freeze enforcement

	•	tests/contracts/openapi-freeze.test.js
	•	generates OpenAPI, hashes it
	•	asserts stored hash matches committed artifact (or fails)
	•	asserts “public routes are additive-only” unless version bump is present  ￼

	5.	Error code registry alignment

	•	tests/contracts/error-codes.test.js
	•	enumerated error code list matches:
	•	registry table entries
	•	actual route outputs for known failure cases
	•	asserts no generic “UNKNOWN_ERROR” for expected failures  ￼  ￼

	6.	Settlement purity regression guard (carry forward)

	•	existing settlement purity tests remain mandatory
	•	ensure no Stripe/email/state transitions appear inside settlement compute paths  ￼

(c) Schema delta summary (Iteration 04)

Planned delta (minimal, governance-oriented, append-only friendly)
	1.	api_contract_snapshots (append-only)

	•	Purpose: store contract version snapshots (OpenAPI hash + content) per deploy or per iteration closure.
	•	Enforces: “contract freeze” becomes enforceable and auditable.

	2.	api_error_codes (registry)

	•	Purpose: canonical list of enumerated error codes and meanings.
	•	Enforces: “explicit error codes” as a queryable contract surface.

	3.	stripe_webhook_dead_letters (append-only, optional foundation)

	•	Purpose: store failures for manual review without mutating stripe_events.
	•	Note: Phase 04 target says “design only” for DLQ, but adding the table now is a safe foundation that does not change business logic.  ￼

No other schema changes are required to complete the Phase 04 test suites themselves, assuming existing stripe_events and ledger constraints from Phase 03 remain intact.  ￼

(d) Risk register (Iteration 04)
	1.	Risk: Contract drift between docs, tests, and runtime behavior

	•	Likelihood: Medium
	•	Impact: High
	•	Mitigation:
	•	OpenAPI generation test that fails on mismatch
	•	error code registry test that fails on undocumented codes  ￼  ￼

	2.	Risk: Replay tests introduce non-determinism or test-suite flakiness

	•	Likelihood: Medium
	•	Impact: Medium
	•	Mitigation:
	•	isolate DB fixtures per test
	•	force serial execution for concurrency tests only
	•	keep stress tests gated behind env var (SKIP_STRESS_TESTS=true in CI)  ￼

	3.	Risk: Stress tests cause DB lock contention and hide real deadlocks

	•	Likelihood: Medium
	•	Impact: High
	•	Mitigation:
	•	add explicit deadlock detection assertions
	•	cap concurrency in CI, run 500-concurrent locally only  ￼

	4.	Risk: Signature failure tests accidentally write to DB (security regression)

	•	Likelihood: Low
	•	Impact: High
	•	Mitigation:
	•	assert row counts unchanged for stripe_events and ledger on every invalid signature case  ￼

	5.	Risk: Observability logging becomes noisy or leaks sensitive payloads

	•	Likelihood: Medium
	•	Impact: Medium
	•	Mitigation:
	•	structured logs with event_id, duration_ms, result only
	•	never log full raw Stripe payloads outside stripe_events storage  ￼  ￼

	6.	Risk: Decision log iteration numbering drift causes governance confusion

	•	Likelihood: High
	•	Impact: Medium
	•	Mitigation:
	•	fix the 2 mislabeled decisions during Iteration 04 closure (not optional)  ￼  ￼

SQL commands to run first (DB foundation)

Run these against staging first. These are additive and safe. They do not modify existing payment tables.

BEGIN;

-- 1) Contract Freeze: append-only OpenAPI snapshot storage
CREATE TABLE IF NOT EXISTS api_contract_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_name TEXT NOT NULL,                 -- e.g. 'public-api'
  version TEXT NOT NULL,                       -- e.g. 'v1', or build tag
  sha256 TEXT NOT NULL,                        -- hash of the canonical spec text
  spec_json JSONB NOT NULL,                    -- stored canonical OpenAPI JSON
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_contract_snapshots_unique
  ON api_contract_snapshots (contract_name, version, sha256);

-- Optional: enforce append-only at DB level
CREATE OR REPLACE FUNCTION api_contract_snapshots_no_update_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'api_contract_snapshots is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS api_contract_snapshots_block_update ON api_contract_snapshots;
CREATE TRIGGER api_contract_snapshots_block_update
BEFORE UPDATE ON api_contract_snapshots
FOR EACH ROW EXECUTE FUNCTION api_contract_snapshots_no_update_delete();

DROP TRIGGER IF EXISTS api_contract_snapshots_block_delete ON api_contract_snapshots;
CREATE TRIGGER api_contract_snapshots_block_delete
BEFORE DELETE ON api_contract_snapshots
FOR EACH ROW EXECUTE FUNCTION api_contract_snapshots_no_update_delete();


-- 2) Error Code Registry: canonical enumerated errors (contract surface)
CREATE TABLE IF NOT EXISTS api_error_codes (
  code TEXT PRIMARY KEY,                       -- e.g. 'STRIPE_SIGNATURE_INVALID'
  http_status INT NOT NULL,
  scope TEXT NOT NULL,                         -- 'public' | 'admin' | 'internal'
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Optional: prevent edits to existing codes (append-only semantics for governance)
CREATE OR REPLACE FUNCTION api_error_codes_no_update_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'api_error_codes is append-only (add new rows only)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS api_error_codes_block_update ON api_error_codes;
CREATE TRIGGER api_error_codes_block_update
BEFORE UPDATE ON api_error_codes
FOR EACH ROW EXECUTE FUNCTION api_error_codes_no_update_delete();

DROP TRIGGER IF EXISTS api_error_codes_block_delete ON api_error_codes;
CREATE TRIGGER api_error_codes_block_delete
BEFORE DELETE ON api_error_codes
FOR EACH ROW EXECUTE FUNCTION api_error_codes_no_update_delete();


-- 3) Optional foundation: Dead letter storage for webhook failures (append-only)
-- This does NOT replace stripe_events. It is only for failures that need manual review.
CREATE TABLE IF NOT EXISTS stripe_webhook_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT,                        -- evt_... if present
  event_type TEXT,                             -- payment_intent.succeeded, etc.
  failure_class TEXT NOT NULL,                 -- e.g. 'PAYMENT_INTENT_NOT_FOUND', 'DB_ERROR'
  error_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_webhook_dead_letters_event_id_idx
  ON stripe_webhook_dead_letters (stripe_event_id);

COMMIT;

If you want, I can also return the exact seed INSERTs for api_error_codes based on your Iteration 03 documented codes so you can load the registry immediately.  ￼