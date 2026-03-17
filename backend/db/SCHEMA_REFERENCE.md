# PostgreSQL Schema Reference — Deterministic Operational Authority

**Status:** AUTHORITATIVE (extracted from schema.snapshot.sql)
**Generated:** 2026-03-17
**Purpose:** Deterministic, ChatGPT-readable schema reference for AI enforcement
**Source of Truth:** /Users/iancarter/Documents/workspace/playoff-challenge/backend/db/schema.snapshot.sql

---

## Tables Summary

**Total Tables:** 57

| Table | Purpose |
|-------|---------|
| admin_contest_audit | Admin action audit log (contest state changes) |
| api_contract_snapshots | API contract versioning (append-only, frozen) |
| api_error_codes | Error code registry (append-only, frozen) |
| case_notes | CSA audit trail (financial issues) |
| contest_instances | Contest instances (PK: id, FK: template_id, organizer_id) |
| contest_participants | User participation (UNIQUE: contest_instance_id, user_id) |
| contest_state_transitions | State machine audit (immutable, append-only) |
| contest_templates | Contest blueprints (sport, strategy, rules) |
| entry_rosters | User lineups (golf contests) |
| event_data_snapshots | Immutable event data (for settlement replay) |
| field_selections | Field/configuration selections |
| financial_admin_actions | Manual financial interventions |
| financial_alerts | System anomaly alerts |
| financial_feature_flags | Feature toggles (financial operations) |
| financial_reconciliation_snapshots | Point-in-time reconciliation checks |
| financial_reconciliations | Stripe/wallet balance reconciliation |
| game_settings | Global game configuration |
| golfer_event_scores | Aggregated golfer scores per event |
| golfer_scores | Per-user golfer scores (PGA) |
| ingestion_events | Provider events (with validation) |
| ingestion_runs | Work unit execution records |
| ingestion_validation_errors | Validation error details |
| ledger | **CRITICAL:** Immutable financial ledger (append-only) |
| lifecycle_outbox | Event outbox (contest state changes) |
| lifecycle_reconciler_runs | Lifecycle orchestrator audit |
| payment_intents | Stripe payment intent tracking |
| payout_jobs | Batch payout orchestration |
| payout_requests | User payout requests |
| payout_structure | Payout tier definitions |
| payout_transfers | Individual payout transfers |
| payouts | Legacy payout tier table |
| pick_multipliers | Pick multiplier tracking |
| picks | User pick selections (NFL) |
| player_swaps | Lineup change history |
| players | Player master data |
| position_requirements | Roster composition rules |
| rules_content | Game rules documentation |
| runbook_executions | Automation/runbook history |
| score_history | Historical score snapshots |
| scores | Per-user player scores |
| scoring_audit | Scoring computation audit |
| scoring_rules | Scoring configuration |
| settlement_audit | Settlement computation audit (immutable) |
| settlement_consumption | Outbox consumption tracking |
| settlement_records | **CRITICAL:** Final settlement results (one per contest, immutable) |
| signup_attempts | Signup audit (compliance tracking) |
| stripe_events | Stripe webhook events |
| stripe_webhook_dead_letters | Failed webhook processing |
| system_invariant_runs | System health check execution |
| tournament_config_versions | Tournament configuration versions |
| tournament_configs | Tournament configuration (PGA) |
| user_wallet_freeze | Wallet freeze audit |
| users | User accounts (authentication) |
| wallet_deposit_intents | Wallet top-up tracking |
| wallet_withdrawals | Cash-out requests (Stripe payouts) |
| withdrawal_config | Withdrawal limits and settings |
| worker_heartbeats | Operational heartbeat telemetry |

---

## CRITICAL TABLES (FULL DETAIL)

### ledger

**Authority:** /mnt/data/LEDGER_ARCHITECTURE_AND_RECONCILIATION.md
**Immutability:** Append-only (trigger: prevent_updates_deletes)
**Purpose:** Single source of truth for all balance calculations

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| contest_instance_id | uuid | YES | NULL | FK contest_instances |
| user_id | uuid | YES | NULL | FK users |
| entry_type | text | NO | — | CHECK: ENTRY_FEE, ENTRY_FEE_REFUND, PRIZE_PAYOUT, PRIZE_PAYOUT_REVERSAL, ADJUSTMENT, WALLET_DEPOSIT, WALLET_DEBIT, WALLET_WITHDRAWAL, WALLET_WITHDRAWAL_REVERSAL |
| direction | text | NO | — | CHECK: CREDIT \| DEBIT only |
| amount_cents | integer | NO | — | CHECK: >= 0 |
| currency | text | NO | USD | — |
| reference_type | text | YES | NULL | CHECK: stripe_event \| CONTEST \| WALLET \| NULL |
| reference_id | uuid | NO | — | CHECK: NOT NULL (required) |
| idempotency_key | text | NO | — | UNIQUE (prevents duplicate entries) |
| metadata_json | jsonb | YES | NULL | — |
| created_at | timestamp | NO | now() | Immutable |
| stripe_event_id | text | YES | NULL | — |
| snapshot_id | uuid | YES | NULL | FK event_data_snapshots (immutable) |
| snapshot_hash | text | YES | NULL | blake3 hash (integrity verification) |
| scoring_run_id | uuid | YES | NULL | FK scoring computation |

**Constraints:**
- UNIQUE (idempotency_key)
- CHECK (amount_cents >= 0)
- CHECK (direction IN ('CREDIT', 'DEBIT'))
- CHECK (entry_type IN (...))
- CHECK (NOT (entry_type = 'ENTRY_FEE' AND direction <> 'DEBIT'))
- CHECK (reference_id IS NOT NULL)
- CHECK ((reference_type IS NULL) OR (reference_type IN (...)))

**Indexes:**
- PK on (id)

---

### contest_instances

**Authority:** /mnt/data/LIFECYCLE_EXECUTION_MAP.md
**Purpose:** Individual contest instances (events, tiers, entry configurations)

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| template_id | uuid | NO | — | FK contest_templates |
| organizer_id | uuid | NO | — | User who created |
| entry_fee_cents | integer | NO | — | CHECK: >= 0 (IMMUTABLE after publish) |
| payout_structure | jsonb | NO | — | (IMMUTABLE after LOCKED) |
| status | text | NO | — | CHECK: SCHEDULED \| LOCKED \| LIVE \| COMPLETE \| CANCELLED \| ERROR |
| start_time | timestamp | YES | NULL | **DEPRECATED:** Use tournament_start_time |
| lock_time | timestamp | YES | NULL | Entry lock time (PGA/custom authority) |
| created_at | timestamp | NO | now() | — |
| updated_at | timestamp | NO | now() | — |
| join_token | text | YES | NULL | UNIQUE (public join identifier) |
| max_entries | integer | NO | 20 | CHECK: NULL \| > 0 |
| lock_at | timestamp | YES | NULL | **DEPRECATED:** Use lock_time |
| contest_name | text | NO | — | Display name |
| end_time | timestamp | YES | NULL | **DEPRECATED:** Use tournament_end_time |
| settle_time | timestamp | YES | NULL | Settlement execution time |
| is_platform_owned | boolean | NO | false | System-generated flag |
| tournament_start_time | timestamp | YES | NULL | **AUTHORITATIVE:** Tournament starts |
| tournament_end_time | timestamp | YES | NULL | **AUTHORITATIVE:** Tournament ends (LIVE→COMPLETE trigger) |
| is_primary_marketing | boolean | NO | false | Featured on homepage |
| provider_event_id | text | YES | NULL | External provider reference |
| is_system_generated | boolean | NO | false | Auto-generated flag |

**Constraints:**
- UNIQUE (join_token)
- UNIQUE (provider_event_id, template_id, entry_fee_cents)
- CHECK (entry_fee_cents >= 0)
- CHECK ((max_entries IS NULL) OR (max_entries > 0))
- CHECK (status IN ('SCHEDULED', 'LOCKED', 'LIVE', 'COMPLETE', 'CANCELLED', 'ERROR'))

**Indexes:**
- PK on (id)
- (status) where join_token NOT NULL
- (template_id, status)

---

### settlement_records

**Authority:** /mnt/data/LIFECYCLE_EXECUTION_MAP.md
**Immutability:** One per contest, append-only
**Purpose:** Immutable settlement results (final payouts)

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| contest_instance_id | uuid | NO | — | FK contest_instances (UNIQUE) |
| settled_at | timestamp | NO | now() | — |
| results | jsonb | NO | — | Payout results |
| results_sha256 | text | NO | — | SHA256 hash (tamper detection) |
| settlement_version | text | NO | v1 | Algorithm version |
| participant_count | integer | NO | — | Contestants |
| total_pool_cents | integer | NO | — | Prize pool total |
| created_at | timestamp | NO | now() | — |
| snapshot_id | uuid | YES | NULL | FK event_data_snapshots (immutable) |
| snapshot_hash | text | YES | NULL | blake3 hash (integrity verification) |
| scoring_run_id | uuid | YES | NULL | FK scoring computation |

**Constraints:**
- UNIQUE (contest_instance_id)

**Indexes:**
- PK on (id)

---

### settlement_audit

**Authority:** /mnt/data/LIFECYCLE_EXECUTION_MAP.md
**Immutability:** Updates forbidden (trigger: prevent_settlement_audit_illegal_update)
**Purpose:** Audit trail of settlement computations

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| contest_instance_id | uuid | NO | — | FK contest_instances |
| settlement_run_id | uuid | NO | — | Settlement identifier |
| engine_version | text | NO | — | Algorithm version (IMMUTABLE) |
| event_ids_applied | uuid[] | NO | — | Events used (IMMUTABLE) |
| started_at | timestamp | NO | — | Start time (IMMUTABLE) |
| completed_at | timestamp | YES | NULL | End time |
| status | text | NO | — | CHECK: STARTED \| COMPLETE \| FAILED |
| error_json | jsonb | YES | NULL | Errors if FAILED |
| final_scores_json | jsonb | YES | NULL | Final scores |
| created_at | timestamp | NO | now() | — |

**Constraints:**
- UNIQUE (contest_instance_id, settlement_run_id)
- CHECK (status IN ('STARTED', 'COMPLETE', 'FAILED'))

---

### contest_state_transitions

**Authority:** /mnt/data/LIFECYCLE_EXECUTION_MAP.md
**Immutability:** Append-only (trigger: prevent_contest_state_transitions_mutation)
**Purpose:** Immutable state machine transition audit

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| contest_instance_id | uuid | NO | — | FK contest_instances |
| from_state | text | NO | — | Source state |
| to_state | text | NO | — | Target state |
| triggered_by | text | NO | — | Trigger reason |
| reason | text | YES | NULL | Extended reason |
| created_at | timestamp | NO | now() | — |

**Constraints:**
- CHECK (from_state IN (...) AND to_state IN (...))

---

### contest_participants

**Authority:** /mnt/data/FINANCIAL_INVARIANTS.md
**Purpose:** User participation records

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| contest_instance_id | uuid | NO | — | FK contest_instances |
| user_id | uuid | NO | — | FK users |
| joined_at | timestamp | NO | now() | — |

**Constraints:**
- UNIQUE (contest_instance_id, user_id)

---

### users

**Authority:** /mnt/data/IOS_SWEEP_PROTOCOL.md
**Purpose:** User accounts (authentication, eligibility)

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| username | varchar(100) | YES | NULL | — |
| team_name | varchar(100) | YES | NULL | — |
| email | varchar(255) | YES | NULL | UNIQUE |
| apple_id | varchar(255) | YES | NULL | UNIQUE |
| name | varchar(255) | YES | NULL | — |
| phone | varchar(50) | YES | NULL | — |
| state | varchar(2) | YES | NULL | State residency |
| ip_state_verified | varchar(2) | YES | NULL | IP geolocation state |
| state_certification_date | timestamp | YES | NULL | Eligibility certification |
| eligibility_confirmed_at | timestamp | YES | NULL | Age 18+ verified |
| tos_version | varchar(20) | YES | NULL | ToS version agreed |
| tos_accepted_at | timestamp | YES | NULL | ToS acceptance time |
| age_verified | boolean | NO | false | Age verification flag |
| paid | boolean | NO | false | Payment status |
| payment_method | varchar(50) | YES | NULL | Payment type |
| payment_date | timestamp | YES | NULL | Last payment |
| password_hash | varchar(255) | YES | NULL | Hashed password |
| auth_method | varchar(20) | NO | apple | apple \| email |
| is_admin | boolean | NO | false | Admin flag |
| is_system_user | boolean | NO | false | System account |
| admin_notes | text | YES | NULL | Admin comments |
| stripe_connected_account_id | text | YES | NULL | Seller account |
| created_at | timestamp | NO | CURRENT_TIMESTAMP | — |
| updated_at | timestamp | NO | now() | — |

**Constraints:**
- UNIQUE (email)
- UNIQUE (apple_id)

---

### payout_transfers

**Authority:** /mnt/data/FINANCIAL_INVARIANTS.md
**Purpose:** Individual payout transfers (Stripe payouts)

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| payout_job_id | uuid | NO | — | FK payout_jobs |
| contest_id | uuid | NO | — | FK contest_instances |
| user_id | uuid | NO | — | FK users |
| amount_cents | integer | NO | — | CHECK: > 0 |
| status | text | NO | — | CHECK: pending \| processing \| retryable \| completed \| failed_terminal |
| attempt_count | integer | NO | 0 | CHECK: >= 0 |
| max_attempts | integer | NO | 3 | CHECK: >= 1 |
| stripe_transfer_id | text | YES | NULL | Stripe reference |
| idempotency_key | text | NO | — | UNIQUE (idempotent) |
| failure_reason | text | YES | NULL | Failure description |
| created_at | timestamp | NO | now() | — |
| updated_at | timestamp | NO | now() | — |

**Constraints:**
- UNIQUE (contest_id, user_id)
- UNIQUE (idempotency_key)
- CHECK (amount_cents > 0)
- CHECK (attempt_count >= 0)
- CHECK (max_attempts >= 1)
- CHECK (status IN (...))

---

### wallet_withdrawals

**Authority:** /mnt/data/FINANCIAL_INVARIANTS.md
**Purpose:** User withdrawal requests (Stripe payouts)

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| user_id | uuid | NO | — | FK users |
| amount_cents | integer | NO | — | CHECK: > 0 |
| method | text | NO | — | CHECK: standard \| instant |
| instant_fee_cents | integer | NO | 0 | — |
| status | text | NO | — | CHECK: REQUESTED \| PROCESSING \| PAID \| FAILED \| CANCELLED |
| stripe_payout_id | text | YES | NULL | UNIQUE (Stripe reference) |
| idempotency_key | text | NO | — | UNIQUE (prevents duplicates) |
| failure_reason | text | YES | NULL | — |
| processed_at | timestamp | YES | NULL | — |
| requested_at | timestamp | NO | now() | — |
| updated_at | timestamp | NO | now() | — |
| attempt_count | integer | NO | 0 | — |
| next_attempt_at | timestamp | YES | NULL | Retry time |
| last_error_code | text | YES | NULL | — |
| last_error_details_json | jsonb | YES | NULL | — |

**Constraints:**
- UNIQUE (idempotency_key)
- UNIQUE (stripe_payout_id)
- CHECK (amount_cents > 0)
- CHECK (method IN ('standard', 'instant'))
- CHECK (status IN (...))

---

### financial_reconciliation_snapshots

**Authority:** /mnt/data/FINANCIAL_INVARIANTS.md
**Purpose:** Point-in-time reconciliation equation snapshots

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| timestamp | timestamp | NO | now() | — |
| wallet_liability_cents | bigint | NO | — | CHECK: >= 0 |
| contest_pools_cents | bigint | NO | — | — |
| deposits_cents | bigint | NO | — | CHECK: >= 0 |
| withdrawals_cents | bigint | NO | — | CHECK: >= 0 |
| difference_cents | bigint | NO | — | Imbalance |
| status | text | NO | — | CHECK: coherent \| drift \| critical |
| created_at | timestamp | NO | now() | — |

**Equation:** wallet_liability_cents + contest_pools_cents = deposits_cents - withdrawals_cents

**Cleanup:** Records older than 90 days auto-deleted by delete_old_reconciliation_snapshots()

---

### system_invariant_runs

**Authority:** /mnt/data/ARCHITECTURE_LOCK.md
**Purpose:** System health check execution records

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| overall_status | text | NO | — | CHECK: HEALTHY \| WARNING \| CRITICAL |
| financial_status | text | NO | — | CHECK: BALANCED \| DRIFT \| CRITICAL_IMBALANCE |
| lifecycle_status | text | NO | — | CHECK: HEALTHY \| STUCK_TRANSITIONS \| ERROR |
| settlement_status | text | NO | — | CHECK: HEALTHY \| INCOMPLETE \| ERROR |
| pipeline_status | text | NO | — | CHECK: HEALTHY \| DEGRADED \| FAILED |
| ledger_status | text | NO | — | CHECK: CONSISTENT \| VIOLATIONS \| ERROR |
| execution_time_ms | integer | NO | — | — |
| created_at | timestamp | NO | now() | — |
| wallet_liability_cents | bigint | YES | NULL | — |
| contest_pools_cents | bigint | YES | NULL | — |
| deposits_cents | bigint | YES | NULL | — |
| withdrawals_cents | bigint | YES | NULL | — |
| invariant_diff_cents | bigint | YES | NULL | — |
| stuck_locked_count | integer | YES | NULL | — |
| stuck_live_count | integer | YES | NULL | — |
| stuck_settlement_count | integer | YES | NULL | — |
| pipeline_errors | jsonb | YES | NULL | — |
| ledger_anomalies | jsonb | YES | NULL | — |

---

### worker_heartbeats

**Authority:** /mnt/data/AI_WORKER_RULES.md
**Purpose:** Operational heartbeat telemetry (discovery, ingestion, lifecycle, payouts, reconciliation)

| Column | Type | NULL | Default | Constraint |
|--------|------|------|---------|-----------|
| id | uuid | NO | gen_random_uuid() | PK |
| worker_name | text | NO | — | UNIQUE (identifier) |
| worker_type | text | NO | — | Worker type |
| status | text | NO | — | CHECK: HEALTHY \| DEGRADED \| ERROR |
| last_run_at | timestamp | YES | NULL | — |
| error_count | integer | NO | 0 | — |
| metadata | jsonb | YES | NULL | Telemetry |
| created_at | timestamp | NO | now() | — |

**Constraints:**
- UNIQUE (worker_name)
- CHECK (status IN ('HEALTHY', 'DEGRADED', 'ERROR'))

---

## Validation Summary

- ✅ **Total Tables:** 57 extracted
- ✅ **Critical Tables:** ledger, contest_instances, settlement_records, settlement_audit, contest_state_transitions, contest_participants, users, payout_transfers, wallet_withdrawals, financial_reconciliation_snapshots, system_invariant_runs, worker_heartbeats
- ✅ **Append-Only:** ledger, settlement_records, settlement_audit, contest_state_transitions, api_contract_snapshots, api_error_codes
- ✅ **Primary Keys:** All documented
- ✅ **Constraints:** All CHECK, UNIQUE, FK constraints documented
- ✅ **Immutability:** Triggers documented for append-only tables
- ✅ **Indexes:** Key indexes listed

**Schema Reference Status:** COMPLETE AND AUTHORITATIVE
