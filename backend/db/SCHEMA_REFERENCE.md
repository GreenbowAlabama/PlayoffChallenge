# Database Schema Reference

Generated from `backend/db/schema.snapshot.sql` for quick lookup and understanding.

**Last Updated:** 2026-03-09

---

## Table of Contents

1. [Contest Management](#contest-management)
2. [Financial & Payments](#financial--payments)
3. [Scoring & Results](#scoring--results)
4. [Players & Rosters](#players--rosters)
5. [Ingestion & Data Pipeline](#ingestion--data-pipeline)
6. [Ledger & Accounting](#ledger--accounting)
7. [User Management](#user-management)
8. [System & Monitoring](#system--monitoring)
9. [Views](#views)

---

## Contest Management

### `contest_instances`
**Primary contest entity.** One row per contest run with state transitions.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| template_id | UUID | FK to contest_templates |
| organizer_id | UUID | User who created contest |
| entry_fee_cents | integer | **IMMUTABLE after publish** |
| payout_structure | jsonb | Structure cannot change after LOCKED |
| status | text | SCHEDULED, LOCKED, LIVE, COMPLETE, CANCELLED, ERROR |
| contest_name | text | Contest display name |
| join_token | text | UNIQUE, required for phase 1 join |
| max_entries | integer | Capacity (default 20, NULL = unlimited) |
| start_time | timestamp | When contest goes LIVE |
| lock_time | timestamp | When lineups lock |
| lock_at | timestamp | Alternative lock timestamp |
| settle_time | timestamp | When settlement runs |
| end_time | timestamp | Contest ends |
| tournament_start_time | timestamp | Tournament begins |
| tournament_end_time | timestamp | Tournament ends |
| is_platform_owned | boolean | Platform-created vs user-created |
| is_primary_marketing | boolean | Featured on homepage |
| is_system_generated | boolean | System-created (not user) |
| provider_event_id | text | External provider reference |
| current_entries | integer | Active participant count |
| created_at | timestamp | NOT NULL DEFAULT now() |
| updated_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `entry_fee_cents >= 0`
- `max_entries > 0` (if not NULL)
- status must be one of valid values
- join_token is UNIQUE

---

### `contest_templates`
**Blueprint for contests.** Reusable template with sport and strategy.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | text | Template name |
| sport | text | NFL, PGA, etc. |
| template_type | text | Game mode type |
| scoring_strategy_key | text | References scoring rules |
| lock_strategy_key | text | Lineups lock timing |
| settlement_strategy_key | text | Payout calculation method |
| default_entry_fee_cents | integer | Recommended fee |
| allowed_entry_fee_min_cents | integer | Minimum allowed fee |
| allowed_entry_fee_max_cents | integer | Maximum allowed fee |
| allowed_payout_structures | jsonb | Valid payout configurations |
| provider_tournament_id | text | External provider ID |
| season_year | integer | Year for seasonal sports |
| is_active | boolean | Template available for new contests |
| is_system_generated | boolean | System-created template |
| status | text | SCHEDULED, COMPLETE, CANCELLED |
| lineup_size | integer | Players per roster |
| scoring_count | integer | Number of scoring periods |
| drop_lowest | boolean | Drop lowest score in calculation |
| scoring_format | text | Scoring rule format |
| created_at | timestamp | NOT NULL DEFAULT now() |
| updated_at | timestamp | NOT NULL DEFAULT now() |

---

### `contest_participants`
**Who joined.** Tracks user participation in contests.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK to contest_instances |
| user_id | UUID | FK to users |
| joined_at | timestamp | When user joined |

**Constraints:**
- `(contest_instance_id, user_id)` UNIQUE (user can only join once)
- Organizer auto-joined on publish

---

### `contest_state_transitions`
**Append-only audit log.** Records every contest state change.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK to contest_instances |
| from_state | text | Previous status |
| to_state | text | New status |
| triggered_by | text | Who/what triggered change |
| reason | text | Why state changed |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Immutability:** Updates and deletes are blocked by trigger.

---

## Financial & Payments

### `ledger`
**Append-only transaction log.** Foundation of financial accounting.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK, NULL for wallet-only |
| user_id | UUID | FK to users |
| entry_type | text | ENTRY_FEE, PRIZE_PAYOUT, ADJUSTMENT, WALLET_DEPOSIT, WALLET_WITHDRAWAL, etc. |
| direction | text | DEBIT or CREDIT |
| amount_cents | integer | >= 0 |
| currency | text | Default 'USD' |
| reference_type | text | stripe_event, CONTEST, WALLET |
| reference_id | UUID | FK to source of transaction |
| idempotency_key | text | UNIQUE, prevents duplicates |
| metadata_json | jsonb | Additional context |
| snapshot_id | UUID | Reference to event_data_snapshots |
| snapshot_hash | text | blake3 hash for integrity |
| scoring_run_id | UUID | Reference to settlement computation |
| stripe_event_id | text | Stripe webhook event |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `amount_cents >= 0`
- `direction IN ('CREDIT', 'DEBIT')`
- `entry_type IN ('ENTRY_FEE', 'PRIZE_PAYOUT', 'ADJUSTMENT', ...)`
- ENTRY_FEE must have direction=DEBIT
- `idempotency_key` is UNIQUE (prevents double-posting)
- `reference_id` is required

**Core Invariant:** wallet_liability + contest_pools = deposits - withdrawals

---

### `payment_intents`
**Stripe payment tracking.** One per user per contest fee.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| user_id | UUID | FK |
| idempotency_key | text | UNIQUE |
| stripe_payment_intent_id | text | From Stripe API |
| stripe_customer_id | text | Stripe customer reference |
| status | text | REQUIRES_PAYMENT_METHOD, SUCCEEDED, FAILED, CANCELED |
| amount_cents | integer | >= 0 |
| currency | text | Default 'USD' |
| stripe_client_secret | text | For frontend integration |
| created_at | timestamp | NOT NULL DEFAULT now() |
| updated_at | timestamp | NOT NULL DEFAULT now() |

---

### `wallet_deposit_intents`
**User deposit flow.** Tracks wallet top-ups.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK |
| stripe_payment_intent_id | text |
| amount_cents | integer | > 0 |
| currency | text | Default 'USD' |
| status | text | REQUIRES_CONFIRMATION, SUCCEEDED, FAILED, CANCELLED |
| idempotency_key | text | UNIQUE |
| created_at | timestamp | NOT NULL DEFAULT now() |
| updated_at | timestamp | NOT NULL DEFAULT now() |

---

### `wallet_withdrawals`
**Cash-out requests.** User withdrawals with retry logic.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK |
| amount_cents | integer | > 0 |
| method | text | standard, instant |
| instant_fee_cents | integer | >= 0 |
| status | text | REQUESTED, PROCESSING, PAID, FAILED, CANCELLED |
| stripe_payout_id | text | Stripe payout reference |
| idempotency_key | text | UNIQUE |
| failure_reason | text | Error message if failed |
| requested_at | timestamp | Default now() |
| processed_at | timestamp | When completed |
| updated_at | timestamp | Default now() |
| attempt_count | integer | Retry counter |
| next_attempt_at | timestamp | When to retry |
| last_error_code | text | Error code from processor |
| last_error_details_json | jsonb | Error details |

---

### `withdrawal_config`
**Withdrawal limits and settings.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| environment | text | Environment name |
| min_withdrawal_cents | integer | Default 500 |
| max_withdrawal_cents | integer | Cap per withdrawal |
| daily_withdrawal_limit_cents | integer | Daily aggregate limit |
| max_withdrawals_per_day | integer | Number of withdrawals allowed |
| instant_enabled | boolean | Default true |
| instant_fee_percent | numeric | Fee percentage for instant |
| cooldown_seconds | integer | Time between withdrawals |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `payout_requests`
**User winnings claim.** Entry points for prize disbursement.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| user_id | UUID | FK |
| idempotency_key | text | UNIQUE |
| amount_cents | integer | >= 0 |
| currency | text | Default 'USD' |
| status | text | REQUESTED, PROCESSING, SUCCEEDED, FAILED, CANCELED |
| requested_at | timestamp | Default now() |
| processed_at | timestamp | When fulfilled |
| processor_ref | text | External processor ID |
| error_code | text | Error if failed |
| error_details_json | jsonb | Error details |

---

### `payout_transfers`
**Individual payout distribution.** Part of payout_job.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| payout_job_id | UUID | FK |
| contest_id | UUID | FK to contest_instances |
| user_id | UUID | FK |
| amount_cents | integer | > 0 |
| status | text | pending, processing, retryable, completed, failed_terminal |
| attempt_count | integer | >= 0 |
| max_attempts | integer | Default 3 |
| stripe_transfer_id | text | Stripe reference |
| idempotency_key | text | UNIQUE |
| failure_reason | text | Why failed |
| created_at | timestamp | NOT NULL DEFAULT now() |
| updated_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `(contest_id, user_id)` UNIQUE (one payout per user per contest)
- `amount_cents > 0`
- Retry logic with exponential backoff

---

### `payout_jobs`
**Batch payout orchestration.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| settlement_id | UUID | FK |
| contest_id | UUID | FK |
| status | text | pending, processing, complete |
| total_payouts | integer | Expected payout count |
| completed_count | integer | Successful payouts |
| failed_count | integer | Failed payouts |
| started_at | timestamp | When batch started |
| completed_at | timestamp | When batch finished |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `(settlement_id)` UNIQUE (one job per settlement)

---

### `payout_structure`
**Payout tiers.** Place finish -> payout percentage.

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK (auto-increment) |
| place | integer | UNIQUE (1st, 2nd, 3rd, etc.) |
| percentage | numeric(5,2) | % of pool |
| description | varchar(100) | "First Place", "2nd Place", etc. |
| is_active | boolean | Default true |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `financial_reconciliation_snapshots`
**Financial health checks.** Invariant monitoring.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| timestamp | timestamp | When snapshot taken |
| wallet_liability_cents | integer | >= 0 |
| contest_pools_cents | integer | Total in pools |
| deposits_cents | integer | >= 0 |
| withdrawals_cents | integer | >= 0 |
| difference_cents | integer | Imbalance |
| status | text | coherent, drift, critical |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Key Equation:** wallet_liability_cents + contest_pools_cents = deposits_cents - withdrawals_cents

---

### `financial_reconciliations`
**Stripe/wallet balance reconciliation.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| stripe_balance | integer | Stripe account balance |
| wallet_balance | integer | Total wallet liability |
| contest_pool_balance | integer | Money in contest pools |
| pending_withdrawals | integer | Default 0 |
| platform_float | integer | Operating funds |
| expected_total | integer | Calculated total |
| difference | integer | Imbalance amount |
| status | character varying(20) | HEALTHY, WARNING, CRITICAL |
| alert_sent | boolean | Default false |
| alert_channel | varchar(50) | Slack, email, etc. |
| notes | text | Additional context |
| created_at | timestamp | NOT NULL DEFAULT CURRENT_TIMESTAMP |

---

### `financial_alerts`
**System anomaly alerts.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| severity | text | CRITICAL, WARNING, INFO |
| alert_type | text | Category (imbalance, liquidity, etc.) |
| message | text | Alert description |
| first_detected | timestamp | Default now() |
| last_seen | timestamp | Last occurrence |
| occurrence_count | integer | Default 1 |
| repair_action_available | boolean | Can auto-repair? |
| repair_action_function | text | Function to call |
| acknowledged_by | UUID | Admin who acknowledged |
| acknowledged_at | timestamp | When acknowledged |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `financial_feature_flags`
**Feature toggles for financial operations.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| feature | text | Feature name (UNIQUE) |
| enabled | boolean | Default true |
| disabled_by | UUID | Admin who disabled |
| disabled_reason | text | Why disabled |
| disabled_at | timestamp | When disabled |
| re_enabled_by | UUID | Admin who re-enabled |
| re_enabled_at | timestamp | When re-enabled |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `financial_admin_actions`
**Audit trail for manual interventions.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| admin_id | UUID | Admin who took action |
| action_type | text | Action category |
| ledger_id | UUID | Related ledger entry |
| affected_user_id | UUID | User impacted |
| amount_cents | integer | >= 0 |
| reason | text | Why action taken |
| status | text | pending, completed, failed |
| result_message | text | Outcome details |
| created_at | timestamp | NOT NULL DEFAULT now() |
| completed_at | timestamp | When completed |

---

## Scoring & Results

### `settlement_audit`
**Immutable settlement record.** One per contest, locked after creation.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK, part of UNIQUE constraint |
| settlement_run_id | UUID | FK, part of UNIQUE constraint |
| engine_version | text | Settlement algorithm version (IMMUTABLE) |
| event_ids_applied | UUID[] | Events used in settlement (IMMUTABLE) |
| started_at | timestamp | When computation began (IMMUTABLE) |
| completed_at | timestamp | When settlement finished |
| status | text | STARTED, COMPLETE, FAILED |
| error_json | jsonb | Error details if FAILED |
| final_scores_json | jsonb | Final scores and rankings |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `(contest_instance_id, settlement_run_id)` UNIQUE
- Identity fields (contest_id, settlement_run_id, engine_version, event_ids_applied, started_at) are IMMUTABLE
- Status: STARTED → (COMPLETE or FAILED)

---

### `settlement_records`
**Final settlement results.** One per contest.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK, UNIQUE (one per contest) |
| settled_at | timestamp | Default now() |
| results | jsonb | Winner list with payouts |
| results_sha256 | text | Hash for tamper detection |
| settlement_version | text | 'v1' |
| participant_count | integer | Contestants in contest |
| total_pool_cents | integer | Prize pool sum |
| snapshot_id | UUID | Event data snapshot used |
| snapshot_hash | text | blake3 hash for integrity |
| scoring_run_id | UUID | Settlement computation reference |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Immutability:** One record per contest, append-only.

---

### `settlement_consumption`
**Tracks which lifecycle events generated settlements.**

| Column | Type | Notes |
|--------|------|-------|
| contest_instance_id | UUID | PK/FK |
| consumed_outbox_id | UUID | FK to lifecycle_outbox |
| consumed_at | timestamp | Default now() |

---

### `score_history`
**Historical score snapshots.** Audit trail of score changes.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| settlement_audit_id | UUID | FK |
| scores_json | jsonb | Score state |
| scores_hash | text | Hash for integrity |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `(contest_instance_id, settlement_audit_id)` UNIQUE

---

### `scores`
**Calculated scores.** Per-player scores per week.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK |
| player_id | varchar(50) | External player ID |
| week_number | integer | Scoring week |
| points | numeric(10,2) | Calculated points |
| base_points | numeric(10,2) | Before multiplier |
| multiplier | numeric(3,1) | Score multiplier |
| final_points | numeric(10,2) | base_points * multiplier |
| stats_json | jsonb | Detailed stats |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `golfer_scores`
**PGA-specific scoring.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| user_id | UUID | FK |
| golfer_id | text | Golfer identifier |
| round_number | integer | Round (>= 1) |
| hole_points | integer | Points earned |
| bonus_points | integer | Bonus points |
| finish_bonus | integer | Placement bonus |
| total_points | integer | Sum of all points |
| details | jsonb | Hole-by-hole breakdown |
| created_at | timestamp | NOT NULL DEFAULT now() |
| updated_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `(contest_instance_id, user_id, golfer_id, round_number)` UNIQUE

---

### `scoring_audit`
**Scoring computation audit trail.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| tournament_config_id | UUID | FK |
| provider_payload_hash | text | Hash of input data |
| scoring_output_hash | text | Hash of scoring result |
| scoring_json | jsonb | Full scoring output |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `scoring_rules`
**Scoring configuration.** Points per stat.

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK |
| category | varchar(50) | Stat category |
| stat_name | varchar(100) | Stat name |
| points | numeric(5,2) | Points for this stat |
| description | text | Human explanation |
| is_active | boolean | Default true |
| display_order | integer | UI sort order |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

## Players & Rosters

### `entry_rosters`
**User lineups.** One per user per contest.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK, part of UNIQUE |
| user_id | UUID | FK, part of UNIQUE |
| player_ids | text[] | Array of player IDs |
| submitted_at | timestamp | Default now() |
| updated_at | timestamp | Default now() |

**Constraints:**
- `(contest_instance_id, user_id)` UNIQUE (one roster per user per contest)

---

### `players`
**Player database.** Master list of athletes.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(50) | PK |
| position | varchar(10) | QB, RB, WR, TE, K, DEF, etc. |
| team | varchar(10) | NFL team code |
| full_name | varchar(100) | Display name |
| first_name | varchar(100) | |
| last_name | varchar(100) | |
| sleeper_id | varchar(50) | UNIQUE, external reference |
| espn_id | varchar(50) | ESPN reference |
| image_url | varchar(255) | Profile image |
| sport | varchar(10) | Default 'NFL' |
| available | boolean | Can be drafted |
| is_active | boolean | Currently in league |
| status | varchar(50) | Player status |
| injury_status | varchar(100) | Injury details |
| game_time | timestamp | Game start time |
| years_exp | integer | Years in league |
| number | varchar(10) | Jersey number |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `picks`
**Individual player picks.** In playoff pick contests.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| user_id | UUID | FK |
| player_id | varchar(50) | FK to players |
| week_number | integer | Game week |
| position | varchar(10) | Player position |
| locked | boolean | Default false |
| consecutive_weeks | integer | Default 0 |
| multiplier | numeric(3,1) | Default 1.0 |
| is_bye_week | boolean | Default false |
| created_at | timestamp | Default CURRENT_TIMESTAMP |

**Constraints:**
- `(contest_instance_id, user_id, player_id, week_number)` UNIQUE (no duplicate picks)

---

### `player_swaps`
**Lineup changes.**

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK |
| user_id | UUID | FK |
| old_player_id | varchar | |
| new_player_id | varchar | |
| position | varchar(10) | |
| week_number | integer | |
| swapped_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `pick_multipliers`
**Multiplier configuration for picks.**

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK |
| pick_id | UUID | FK |
| week_number | integer | UNIQUE with pick_id |
| consecutive_weeks | integer | Default 1 |
| multiplier | numeric(3,1) | Default 1.0 |
| is_bye_week | boolean | Default false |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `position_requirements`
**Roster composition rules.**

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK |
| position | varchar(10) | UNIQUE |
| required_count | integer | How many required |
| display_name | varchar(50) | UI label |
| display_order | integer | Sort order |
| is_active | boolean | Default true |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

## Ingestion & Data Pipeline

### `ingestion_events`
**Raw event feed from providers.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| provider | text | Data source (ESPN, PGA, etc.) |
| event_type | text | Event category |
| provider_data_json | jsonb | Full event payload |
| payload_hash | text | Hash for deduplication |
| received_at | timestamp | When received |
| validated_at | timestamp | When validated |
| validation_status | text | VALID, INVALID |
| validation_errors_json | jsonb | Validation errors if invalid |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `ingestion_runs`
**Processing status per work unit.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| ingestion_strategy_key | text | Strategy identifier |
| work_unit_key | text | Unit of work |
| status | text | RUNNING, COMPLETE, ERROR |
| started_at | timestamp | Default now() |
| completed_at | timestamp | When finished |
| error_message | text | Error if failed |
| external_player_id | text | External reference |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Constraints:**
- `(contest_instance_id, work_unit_key)` UNIQUE (one run per work unit)

---

### `ingestion_validation_errors`
**Detailed validation errors.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| ingestion_event_id | UUID | FK |
| contest_instance_id | UUID | FK |
| error_code | text | Error type |
| error_details_json | jsonb | Details |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `event_data_snapshots`
**Immutable data snapshots.** Used for settlement replay.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| snapshot_hash | text | blake3 hash |
| provider_event_id | text | External event ID |
| provider_final_flag | boolean | Provider marked final |
| payload | jsonb | Full event data |
| ingested_at | timestamp | Default now() |

**Purpose:** Ensure settlement is reproducible from same data.

---

### `tournament_configs`
**Tournament metadata and structure.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| provider_event_id | text | External tournament ID |
| ingestion_endpoint | text | API endpoint for data |
| event_start_date | timestamp | Tournament begins |
| event_end_date | timestamp | Tournament ends |
| round_count | integer | Default 4, > 0 |
| cut_after_round | integer | Cut after round N |
| leaderboard_schema_version | integer | Leaderboard format |
| field_source | text | provider_sync or static_import |
| hash | text | Config hash |
| is_active | boolean | Default false |
| created_at | timestamp | NOT NULL DEFAULT now() |
| published_at | timestamp | When published |

**Constraints:**
- `cut_after_round` between 1 and round_count (if set)
- `field_source IN ('provider_sync', 'static_import')`

---

### `tournament_config_versions`
**Version history for tournament configs.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| tournament_config_id | UUID | FK |
| version | integer | Version number |
| config_json | jsonb | Config snapshot |
| hash | text | Version hash |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `field_selections`
**Golfer field for tournament.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK, UNIQUE |
| tournament_config_id | UUID | FK |
| selection_json | jsonb | Field data |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

## Ledger & Accounting

### `case_notes`
**CSA audit trail for financial issues.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| issue_type | varchar(50) | NEGATIVE_POOL, STRANDED_FUNDS |
| issue_contest_id | UUID | Affected contest |
| issue_user_id | UUID | Affected user (optional) |
| csa_user_id | UUID | Admin handling |
| note_text | text | Notes on resolution |
| created_at | timestamp | Default now() |
| updated_at | timestamp | Default now() |
| resolved_at | timestamp | When marked resolved |

---

## User Management

### `users`
**Platform user accounts.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| username | varchar(100) | Display name |
| team_name | varchar(100) | Fantasy team name |
| email | varchar(255) | Email address |
| apple_id | varchar(255) | Apple Sign-In ID |
| name | varchar(255) | Full name |
| phone | varchar(50) | Phone number |
| state | varchar(2) | Self-certified residence |
| ip_state_verified | varchar(2) | Geolocation state |
| state_certification_date | timestamp | When user certified |
| eligibility_confirmed_at | timestamp | When age verified |
| tos_version | varchar(20) | TOS version accepted |
| tos_accepted_at | timestamp | When accepted |
| age_verified | boolean | 18+ verification |
| paid | boolean | Has paid entry |
| payment_method | varchar(50) | Payment type |
| payment_date | timestamp | Last payment |
| password_hash | varchar(255) | For web login |
| auth_method | varchar(20) | Default 'apple' |
| is_admin | boolean | Admin privileges |
| is_system_user | boolean | Platform service account |
| admin_notes | text | Admin comments |
| stripe_connected_account_id | text | Seller account |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default now() |

---

### `signup_attempts`
**Compliance audit log.** All signup attempts including blocked.

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK |
| apple_id | varchar(255) | Apple ID attempting |
| email | varchar(255) | Email attempted |
| name | varchar(255) | Name provided |
| attempted_state | varchar(2) | State claimed |
| ip_state_verified | varchar(2) | State from IP |
| blocked | boolean | Default false |
| blocked_reason | varchar(100) | Why blocked |
| attempted_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `user_wallet_freeze`
**Account suspension audit.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| user_id | UUID | FK |
| frozen_by | UUID | Admin who froze |
| frozen_reason | text | Why frozen |
| frozen_at | timestamp | Default now() |
| unfrozen_by | UUID | Admin who unfroze |
| unfrozen_at | timestamp | When unfrozen |

---

## System & Monitoring

### `worker_heartbeats`
**Operational telemetry for background workers.** Discovery, ingestion, lifecycle, payouts, reconciliation.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| worker_name | text | Worker identifier |
| worker_type | text | discovery, ingestion, lifecycle, payout, reconciliation |
| status | text | HEALTHY, DEGRADED, ERROR |
| last_run_at | timestamp | When last executed |
| error_count | integer | Default 0 |
| metadata | jsonb | Additional telemetry |
| created_at | timestamp | Default now() |

**Purpose:** Monitor pipeline health via explicit worker signals, not indirect inference.

---

### `system_invariant_runs`
**System health snapshot.** Monitors all critical invariants.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| overall_status | text | HEALTHY, WARNING, CRITICAL |
| financial_status | text | BALANCED, DRIFT, CRITICAL_IMBALANCE |
| lifecycle_status | text | HEALTHY, STUCK_TRANSITIONS, ERROR |
| settlement_status | text | HEALTHY, INCOMPLETE, ERROR |
| pipeline_status | text | HEALTHY, DEGRADED, FAILED |
| ledger_status | text | CONSISTENT, VIOLATIONS, ERROR |
| execution_time_ms | integer | How long check took |
| wallet_liability_cents | bigint | Wallet total |
| contest_pools_cents | bigint | Money in contests |
| deposits_cents | bigint | Total deposits |
| withdrawals_cents | bigint | Total withdrawals |
| invariant_diff_cents | bigint | Imbalance amount |
| stuck_locked_count | integer | LOCKED contests hanging |
| stuck_live_count | integer | LIVE contests hanging |
| stuck_settlement_count | integer | Settlement hangs |
| pipeline_errors | jsonb | Worker failure details |
| ledger_anomalies | jsonb | Ledger issues |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `lifecycle_outbox`
**Event outbox for contest state changes.** Guarantees delivery to settlement.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| event_type | text | State transition event |
| payload | jsonb | Default {} |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `lifecycle_reconciler_runs`
**Orchestrator audit log.** Tracks state transition processing.

| Column | Type | Notes |
|--------|------|-------|
| id | bigint | PK (auto-increment) |
| run_at | timestamp | Default now() |
| transitions_count | integer | Processed |
| error_count | integer | Default 0 |

---

### `stripe_events`
**Stripe webhook processing.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| stripe_event_id | text | Stripe event ID |
| event_type | text | Event category |
| raw_payload_json | jsonb | Full webhook payload |
| received_at | timestamp | Default now() |
| processed_at | timestamp | When processed |
| processing_status | text | RECEIVED, PROCESSED, FAILED |
| processing_error_code | text | Error code if failed |
| processing_error_details_json | jsonb | Error details |

---

### `stripe_webhook_dead_letters`
**Failed webhook processing.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| stripe_event_id | text | Stripe event (if known) |
| event_type | text | Event type (if known) |
| failure_class | text | Error classification |
| error_json | jsonb | Full error info |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `admin_contest_audit`
**Admin action audit log.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contest_instance_id | UUID | FK |
| admin_user_id | UUID | FK |
| action | text | Action taken |
| reason | text | Why action taken |
| payload | jsonb | Action details |
| from_status | text | Previous status |
| to_status | text | New status |
| created_at | timestamp | NOT NULL DEFAULT now() |

---

### `runbook_executions`
**Automation/runbook execution history.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| runbook_name | text | Runbook identifier |
| runbook_version | text | Version |
| executed_by | text | Who ran it |
| status | text | pending, in_progress, completed, failed, partial |
| execution_phase | text | Current phase |
| phase_step | integer | Step within phase |
| start_time | timestamp | Default now() |
| end_time | timestamp | When completed |
| duration_seconds | integer | >= 0 |
| result_json | jsonb | Result details |
| error_reason | text | Error if failed |
| system_state_before | jsonb | Pre-execution state |
| system_state_after | jsonb | Post-execution state |
| created_at | timestamp | NOT NULL DEFAULT now() |
| updated_at | timestamp | NOT NULL DEFAULT now() |

---

### `api_contract_snapshots`
**API contract versioning.** Append-only.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| contract_name | text | API name |
| version | text | Version string |
| sha256 | text | Contract hash |
| spec_json | jsonb | OpenAPI spec |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Immutability:** Updates/deletes blocked by trigger.

---

### `api_error_codes`
**Error code registry.** Append-only.

| Column | Type | Notes |
|--------|------|-------|
| code | text | PK |
| http_status | integer | HTTP status |
| scope | text | public or internal |
| description | text | Error message |
| created_at | timestamp | NOT NULL DEFAULT now() |

**Immutability:** Updates/deletes blocked by trigger.

---

### `game_settings`
**Global game configuration.**

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| entry_amount | varchar(10) | Default '50' |
| venmo_handle | varchar(100) | |
| cashapp_handle | varchar(100) | |
| zelle_handle | varchar(100) | |
| game_mode | varchar(50) | Default 'traditional' |
| qb_limit | integer | Default 1 |
| rb_limit | integer | Default 2 |
| wr_limit | integer | Default 3 |
| te_limit | integer | Default 1 |
| k_limit | integer | Default 1 |
| def_limit | integer | Default 1 |
| playoff_start_week | integer | Default 19 (Wild Card) |
| current_playoff_week | integer | Default 0 (not started) |
| season_year | varchar(4) | Default '2024' |
| is_week_active | boolean | Default true |
| active_teams | text[] | Teams in season |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

### `rules_content`
**Modifiable game rules.**

| Column | Type | Notes |
|--------|------|-------|
| id | integer | PK |
| section | varchar(50) | UNIQUE |
| content | text | Rule text |
| display_order | integer | Sort order |
| created_at | timestamp | Default CURRENT_TIMESTAMP |
| updated_at | timestamp | Default CURRENT_TIMESTAMP |

---

## Views

### `api_contract_snapshots_latest`
Distinct on contract_name, ordered by created_at DESC. Latest contract version.

### `api_error_codes_public`
Error codes with scope='public'. For client error handling.

### `v_game_status`
Current game status, round name, week mapping, user counts.

---

## Key Patterns

### Idempotency Keys
Critical fields for preventing duplicates:
- `ledger.idempotency_key` (UNIQUE)
- `payment_intents.idempotency_key` (UNIQUE)
- `wallet_deposit_intents.idempotency_key` (UNIQUE)
- `payout_transfers.idempotency_key` (UNIQUE)
- `ingestion_runs` (`contest_instance_id, work_unit_key`)

### Append-Only Tables
Immutable by trigger:
- `ledger` (financial transactions)
- `contest_state_transitions` (state audit)
- `settlement_audit` (settlement records)
- `settlement_records` (final results)
- `api_contract_snapshots` (API versioning)
- `api_error_codes` (error registry)

### Hashing for Integrity
Used for content verification:
- `snapshot_hash` (blake3) in ledger and settlement records
- `results_sha256` in settlement_records
- `payload_hash` in ingestion_events
- `config_json` versions in tournament_config_versions

### Key Uniqueness Constraints
Prevent duplicates/collisions:
- `contest_instances.join_token` (UNIQUE)
- `contest_participants` (`contest_instance_id, user_id`)
- `entry_rosters` (`contest_instance_id, user_id`)
- `picks` (`contest_instance_id, user_id, player_id, week_number`)
- `players.sleeper_id` (UNIQUE)

### Foreign Key Patterns
Multi-tenant contest scoping:
- All contests filtered by `contest_instance_id`
- Users have `user_id` for ownership
- Ledger entries cross-reference both for double-sided accountability
