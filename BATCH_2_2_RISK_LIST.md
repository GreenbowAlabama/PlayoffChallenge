# Batch 2.2 Risk List — Polling Orchestrator & ESPN Integration

**Strategic risks that will shape API call + polling loop design**

---

## Risk 1: ESPN Rate Limits
**Problem:** ESPN API enforces rate limits. Hitting limits → 429 responses → loses polling window.
**Impact:** Cascading failures across multiple contests if orchestrator doesn't respect backoff.
**Mitigation:** Respect Retry-After headers, implement exponential backoff (capped), log 429 as WARN (not ERROR), skip poll gracefully.

---

## Risk 2: Network Timeouts & Transient Failures
**Problem:** ESPN API timeouts, connection resets, partial responses → incomplete data.
**Impact:** Incomplete work units passed to pipeline → silent data corruption or failed ingestion.
**Mitigation:** Timeout explicit (3-5s), retry transient errors 3x max, fail-fast on 4xx, always validate shape before building unit.

---

## Risk 3: Partial Leaderboard Snapshots During Tournament
**Problem:** ESPN publishes leaderboard during round → some competitors missing, some holes incomplete.
**Impact:** Hash key changes with each update (expected) but partial data may be incomplete for scoring.
**Mitigation:** Accept partial snapshots (adapter already filters incomplete rounds), validate minimal shape, rely on adapter's round-filtering logic, logs must indicate partial vs. complete.

---

## Risk 4: Poll Overlap & Race Conditions
**Problem:** Multiple cron instances or rapid polling → two polls fetch same data simultaneously → duplicate work units → dedup races.
**Impact:** UNIQUE constraint protects correctness (winners + losers) but duplicate API calls waste resources and ESPN quota.
**Mitigation:** Implement `lastKey` tracking (in-memory, not DB), skip API calls if no key change, orchestrator is stateless (no cross-restart state), UNIQUE constraint is source of truth.

---

## Risk 5: Cron Job Drift & Missed Windows
**Problem:** Cron executes late, pipeline slow → next poll triggers before previous completes → cascading delays.
**Impact:** Contests drift out of polling window → stale data → missed scoring updates.
**Mitigation:** Cron window (e.g., every 2 min) must allow 60% headroom, implement contest-level timeout (abort if > 30s in progress), log wall-clock duration per poll.

---

## Risk 6: Contest Locked Before Ingestion Completes
**Problem:** Contest transitions to SCORING (locked) while polling + ingestion in flight.
**Impact:** Race between ingest-in-progress and state-lock → corrupted scores or rejected snapshots.
**Mitigation:** Load contest FOR UPDATE at service layer (already done), check status before ingestion, reject post-COMPLETE ingestion (logged separately), fail-fast on state mismatch.

---

## Risk 7: Leaderboard Mid-Round Behavior (Holes Incomplete)
**Problem:** ESPN publishes leaderboard at hole 5/18 → incomplete round data → key changes per hole → many redundant ingestions.
**Impact:** Explosion of work units (1 per hole update) → inflates ingestion_runs table → scoring chaos.
**Mitigation:** Adapter already filters to complete rounds (18 holes). Partial rounds excluded from hash. This is secure but means no scoring during round. Accept this for Batch 2.2.

---

## Risk 8: Replay Safety During Rapid Polling
**Problem:** Rapid polls fetch historical snapshots (day-by-day replay) → same data re-ingested → UNIQUE constraint must catch duplicates across restarts.
**Impact:** If deterministic hashing is wrong, duplicates slip through → double-scored entries.
**Mitigation:** Hashing tested (Batch 1). Determinism verified by unit tests. Rely on UNIQUE constraint. Log dedup skips. Never assume app-side dedup logic.

---

## Risk 9: Multi-Event Calendar Overlap & Ambiguity
**Problem:** ESPN calendar includes similar-named events in same season (e.g., two "Masters" entries due to data issue, or overlapping tournament windows).
**Impact:** selectEventIdForContest picks wrong event → wrong leaderboard ingested → wrong scores.
**Mitigation:** Deterministic tie-breaker rules are locked. Year validation enforces season_year. Config override available. Test multi-event scenarios in Batch 2.2 fixtures.

---

## Risk 10: ESPN Provider Outage Behavior
**Problem:** ESPN down → calendar fetch fails → no events returned → selection returns null → no work units → contests not polled.
**Impact:** Silent degradation: contests drift, users see stale leaderboards, no error indication.
**Mitigation:** Log ESPN outages as ERROR (not graceful). Skip contest polling (don't ingest nulls). Increment "outage window" counter. Operator must manually restart after recovery. No automatic retry-forever loops.

---

## Implementation Implications for Batch 2.2

1. **ESPN API Layer:** Must be separate from orchestrator logic. Implement fetch functions with explicit timeout + retry.
2. **Polling Loop:** Stateless cron model (recommended). Per-contest timeout window (not global). Parallel contests with isolation.
3. **Logging:** Must distinguish transient (WARN) vs. fatal (ERROR) vs. skipped (INFO). Wall-clock timing per poll.
4. **Testing:** Mock ESPN fixtures for all 10 risk scenarios (rate limit, timeout, partial data, multi-event, outage).
5. **Monitoring:** Track poll duration, dedup skip rate, ESPN error rate, outage windows. Alert on degradation.

---

**These 10 risks will guide fixture design, error handling patterns, and integration test coverage for Batch 2.2.**
