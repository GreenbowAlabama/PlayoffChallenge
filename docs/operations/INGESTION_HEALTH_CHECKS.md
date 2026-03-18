# Ingestion Health Checks — Operational Monitoring

**Purpose:** Detect ingestion failures and provider data inconsistencies in under 2 seconds per query.

**Status:** Recommended for Admin Operations Tower dashboard

---

## 1. PRIMARY HEALTH CHECK (Most Important)

**What it detects:** LIVE contests with stale snapshots and no provider finality signal.

**Signals ingestion failure:** Snapshots exist but `provider_final_flag` never becomes true.

```sql
SELECT
  ci.id AS contest_id,
  ci.name,
  ci.status,
  MAX(s.ingested_at) AS last_snapshot,
  BOOL_OR(s.provider_final_flag) AS ever_final,
  COUNT(*) AS snapshot_count
FROM contest_instances ci
JOIN event_data_snapshots s
  ON s.contest_instance_id = ci.id
WHERE ci.status = 'LIVE'
GROUP BY ci.id, ci.name, ci.status
HAVING
  MAX(s.ingested_at) < NOW() - INTERVAL '30 minutes'
  AND BOOL_OR(s.provider_final_flag) = false
ORDER BY last_snapshot DESC;
```

**Interpretation:**
- `status = LIVE` — Contest is still in progress (should not be)
- `last_snapshot < 30 min ago` — Ingestion has run since event should end
- `ever_final = false` — Provider finality was never detected

**Action:** Alert ops. Check ESPN provider response or ingestion logs.

---

## 2. ESPN EVENT MISMATCH DETECTOR

**What it detects:** Provider mapping anomalies (multiple events per contest, or provider response format changes).

```sql
SELECT
  provider_event_id,
  COUNT(DISTINCT contest_instance_id) AS contests,
  COUNT(*) AS snapshots
FROM event_data_snapshots
GROUP BY provider_event_id
HAVING COUNT(*) > 50
ORDER BY snapshots DESC;
```

**Interpretation:**
- Healthy: Each event_id maps to consistent contest counts
- Unhealthy: Same event_id maps to multiple contest_ids, or snapshots are growing unexpectedly

**Action:** If sudden jump in snapshots for same event, check if ingestion is duplicating.

---

## 3. SNAPSHOT INGESTION STALENESS CHECK

**What it detects:** Ingestion pipeline stopped receiving updates.

```sql
SELECT
  ci.id,
  ci.name,
  MAX(s.ingested_at) AS last_snapshot
FROM contest_instances ci
LEFT JOIN event_data_snapshots s
  ON s.contest_instance_id = ci.id
WHERE ci.status = 'LIVE'
GROUP BY ci.id, ci.name
HAVING MAX(s.ingested_at) < NOW() - INTERVAL '15 minutes'
ORDER BY last_snapshot ASC;
```

**Interpretation:**
- LIVE contest but no snapshots in last 15 minutes
- Indicates ingestion worker is down or blocked

**Action:** Check ingestion worker logs, ESPN API connectivity.

---

## 4. LIFECYCLE RECONCILIATION FAILURE CHECK

**What it detects:** Final snapshots that exist but lifecycle reconciler didn't trigger settlement.

```sql
SELECT
  s.contest_instance_id,
  ci.name,
  MAX(s.ingested_at) AS final_snapshot_time,
  ci.status
FROM event_data_snapshots s
JOIN contest_instances ci
  ON ci.id = s.contest_instance_id
WHERE s.provider_final_flag = true
AND ci.status != 'COMPLETE'
GROUP BY s.contest_instance_id, ci.name, ci.status
ORDER BY final_snapshot_time DESC;
```

**Interpretation:**
- `provider_final_flag = true` — Ingestion detected provider completion
- `status != COMPLETE` — But lifecycle reconciler never triggered

**Action:** Check lifecycle reconciler worker. May indicate a bug in settlement logic.

---

## 5. ADMIN DASHBOARD QUERY (Recommended)

**What it detects:** Overall contest health at a glance.

**Best for:** Ops tower dashboard. Single view of contest lifecycle status.

```sql
SELECT
  ci.name,
  ci.status,
  MAX(s.ingested_at) AS last_snapshot,
  BOOL_OR(s.provider_final_flag) AS final_seen
FROM contest_instances ci
LEFT JOIN event_data_snapshots s
  ON s.contest_instance_id = ci.id
WHERE ci.status IN ('LIVE','LOCKED','SCHEDULED')
GROUP BY ci.name, ci.status
ORDER BY last_snapshot DESC;
```

**Display Format:**
```
Contest Ops Health

Contest                        Status      Last Snapshot      Final Seen
──────────────────────────────────────────────────────────────────────────
Masters $50                    LIVE        12:04:33 PM        ✗ false
Players Championship $5        COMPLETE    11:59:21 PM        ✓ true
Arnold Palmer Invitational $10 LOCKED      11:42:05 PM        ✗ false
```

---

## 6. RECOMMENDED ALERT RULES

### Red Alert (Critical)

Trigger when:
```
status = 'LIVE'
AND final_seen = false
AND last_snapshot > event_end_time + 10 minutes
```

Meaning: Event finished, ingestion is still running, but finality never detected.

**This is the bug you just fixed.**

### Yellow Alert (Warning)

Trigger when:
```
status IN ('LIVE', 'LOCKED')
AND last_snapshot < NOW() - INTERVAL '15 minutes'
```

Meaning: Ingestion has stopped updating.

### Green (Healthy)

```
status = 'COMPLETE'
AND final_seen = true
AND settlement_records exist
```

---

## 7. OPERATIONAL PLAYBOOK

**If Primary Check Returns Rows:**

1. Run finality check:
   ```sql
   SELECT MAX(ingested_at), provider_final_flag
   FROM event_data_snapshots
   WHERE contest_instance_id = '<contest_id>'
   GROUP BY provider_final_flag
   ORDER BY ingested_at DESC;
   ```

2. Check ESPN API response:
   - Did ESPN send `status.type.name = 'STATUS_FINAL'`?
   - Or did API structure change?

3. Check ingestion logs:
   - Look for invariant violation errors
   - Check if event ID matching is working

4. Verify lifecycle reconciler:
   - Is `lifecycleReconciliationService` running?
   - Are there errors in settlement attempt?

---

## 8. INTEGRATION WITH ADMIN TOWER

**Recommended placement:** New "Ingestion Health" card in Contest Operations area.

**Refresh interval:** 30 seconds (queries run in <2s each)

**Color coding:**
- 🟢 Green: All contests progressing normally
- 🟡 Yellow: Ingestion staleness detected
- 🔴 Red: Stuck LIVE contests with no finality

---

## 9. REFERENCE

Related documents:
- `docs/governance/LIFECYCLE_EXECUTION_MAP.md` — Contest state machine
- `docs/ai/AI_WORKER_RULES.md` — Ingestion framework rules
- `backend/services/ingestion/strategies/pgaEspnIngestion.js` — ESPN adapter implementation

Related incidents:
- **March 18, 2026:** Fixed deterministic event filtering in ESPN API client
  - Symptom: Zero scores despite competitors present
  - Cause: `fetchLeaderboard()` ignored eventId parameter, always returned all ESPN events
  - Solution: Implemented deterministic event filtering with exact ID matching (no fallback to events[0])
  - Status: ✅ Fixed, implemented and validated through testing; ongoing monitoring enforces compliance

---

## PGA ESPN Ingestion — Operational Expectations

This section documents operational expectations for PGA ESPN contests (verified March 18, 2026).

### Normal Pre-Tournament State

**Expected state 1-2 hours before tournament:**

```sql
-- PLAYER_POOL phase complete
SELECT COUNT(*) FROM ingestion_events
WHERE event_type = 'player_pool'
  AND contest_instance_id = <contest_id>;
-- Result: 1 row

-- No scoring yet
SELECT COUNT(*) FROM ingestion_events
WHERE event_type = 'scoring'
  AND contest_instance_id = <contest_id>;
-- Result: 0 rows

-- Competitors loaded but no scores
SELECT COUNT(*) FROM golfer_event_scores
WHERE contest_instance_id = <contest_id>;
-- Result: 0 rows
```

**Leaderboard logs:**
```
[SCORING] No scoring data yet (tournament likely not started) | contest=<id> | competitors=135 | currentRound=null | is_final_round=false
```

**Assessment:** ✅ HEALTHY. Wait for tournament start.

### During Tournament

**Expected state while tournament is live:**

```sql
-- Multiple SCORING events captured
SELECT COUNT(*) FROM ingestion_events
WHERE event_type = 'scoring'
  AND contest_instance_id = <contest_id>;
-- Result: ≥ 1 rows

-- Scores accumulating
SELECT COUNT(DISTINCT round_number) FROM golfer_event_scores
WHERE contest_instance_id = <contest_id>;
-- Result: 1, 2, 3, ... (increases each round)

-- Latest snapshot should be recent
SELECT MAX(validated_at) FROM ingestion_events
WHERE contest_instance_id = <contest_id>;
-- Result: within last 5 minutes
```

**Assessment:** ✅ HEALTHY. Ingestion running every cycle.

### Event ID Validation

**To verify correct event is being ingested:**

```sql
SELECT DISTINCT
  provider_event_id,
  COUNT(*) as snapshot_count
FROM event_data_snapshots
WHERE contest_instance_id = <contest_id>
GROUP BY provider_event_id;
```

**Expected:** 1 row with format `espn_pga_<numeric_id>`

**If multiple event IDs appear:** 🔴 ALERT. Event ID mismatch detected.

### Deduplication Health

**To verify payload deduplication is working:**

```sql
SELECT
  COUNT(DISTINCT payload_hash) as unique_payloads,
  COUNT(*) as total_events
FROM event_data_snapshots
WHERE contest_instance_id = <contest_id>;
```

**Expected behavior:**
- Early in tournament: `unique_payloads` grows (scores update)
- Late in tournament: `unique_payloads` stable (same score state repeated)
- After final: `unique_payloads` stable, no new events

**Assessment:** If `total_events >> unique_payloads`, deduplication working correctly (same payload skipped).

### Alert Thresholds

**🟡 Yellow Alert:** No SCORING events for 15 minutes during LIVE contest
- Action: Check ingestion worker logs, ESPN API connectivity

**🔴 Red Alert:**
- Event ID mismatch (multiple provider_event_ids for one contest)
- SCORING event count stopped increasing for 30 minutes during LIVE contest
- Action: Escalate to engineering team
