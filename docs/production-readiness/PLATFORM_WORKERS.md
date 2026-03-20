# Platform Workers Configuration & Operations

**Version:** 1.0
**Updated:** March 12, 2026
**Status:** PRODUCTION READY

---

## Overview

The Playoff Challenge platform uses background workers to handle asynchronous operations including contest discovery, ingestion, and lifecycle management. This document covers worker configuration, behavior, and operational considerations.

---

## Worker Types

### 1. Ingestion Worker

**Purpose:** Periodically discovers active contest instances and triggers 2-phase ingestion (player pool and scoring data).

**Location:** `/backend/workers/ingestionWorker.js`

**Startup:** Called from server initialization when `NODE_ENV !== 'test'`

**Configuration:**

#### Environment Variable Control

The ingestion worker polling interval can be controlled via environment variable:

```bash
INGESTION_WORKER_INTERVAL_MS=60000
```

**Behavior:**

- **If `INGESTION_WORKER_INTERVAL_MS` is set:** Worker uses that interval for all contest statuses
- **If not set:** Worker uses lifecycle-based adaptive polling (default)

#### Adaptive Polling Mode (Default)

When `INGESTION_WORKER_INTERVAL_MS` is not set, the worker adjusts polling frequency based on contest lifecycle state:

| Contest Status | Interval | Use Case |
|---|---|---|
| **LIVE** | 5 seconds | Frequent updates for active scoring |
| **LOCKED** | 30 seconds | Moderate updates for locked contests |
| **SCHEDULED** | 5 minutes | Infrequent updates for scheduled contests |
| **IDLE** (no active) | 60 seconds | No active contests to poll |

#### Override Mode

When `INGESTION_WORKER_INTERVAL_MS=60000` (example):
- All contests use 60 second polling interval
- Overrides all lifecycle-based intervals
- Useful for:
  - Production environments with specific requirements
  - Testing consistent polling behavior
  - Reducing database load on lightweight deployments

**Startup Logs:**

```
[Ingestion Worker] Starting with OVERRIDE_INTERVAL=60000ms (from INGESTION_WORKER_INTERVAL_MS env var)
[Ingestion Worker] Active contests status: LIVE, next poll in 60000ms
```

vs.

```
[Ingestion Worker] Starting with lifecycle-based adaptive polling (INGESTION_WORKER_INTERVAL_MS not set)
[Ingestion Worker] Active contests status: LIVE, next poll in 5000ms
```

**Phases:**

1. **Phase A — PLAYER_POOL:** Runs for SCHEDULED, LOCKED, LIVE
   - Player field and baseline tournament metadata
   - Required for lineup selection and golfer availability

2. **Phase B — SCORING:** Runs for LOCKED, LIVE only
   - Leaderboard, live stats, scoring data
   - Required for contest progression and settlement

**Error Handling:**
- Non-blocking: Worker continues if individual ingestions fail
- Logs per-phase results with reason codes
- No error throwing (logs and continues)
- Graceful degradation on database errors

**Monitoring:**

Monitor these log patterns:

```
[Ingestion] Cycle complete: contests=5, phases_run=8, phases_skipped=2, failed=0
[Ingestion Worker] Active contests status: LIVE, next poll in 5000ms
```

**Troubleshooting:**

**Issue:** Worker not respecting `INGESTION_WORKER_INTERVAL_MS`

**Solution:** Verify environment variable is set:
```bash
echo $INGESTION_WORKER_INTERVAL_MS
```

Check startup logs:
```
[Ingestion Worker] Starting with OVERRIDE_INTERVAL=60000ms
```

If logs still show wrong interval, restart the application.

**Issue:** Worker polling too frequently

**Solution:** Set environment variable to desired interval:
```bash
INGESTION_WORKER_INTERVAL_MS=120000  # 120 seconds
```

**Issue:** Worker polling too infrequently

**Solution:** Either:
1. Increase the interval value
2. Remove `INGESTION_WORKER_INTERVAL_MS` env var to use adaptive polling

---

## Lifecycle Reconciler Worker

**Purpose:** Monitors contest instances and automatically transitions them through lifecycle states based on timestamp rules.

**Location:** `/backend/services/lifecycleReconciliationService.js`

**Configuration:**

```javascript
// Default poll interval: 30 seconds
// Adjustable via LIFECYCLE_RECONCILER_INTERVAL_MS (optional)
```

**Transitions Managed:**

- SCHEDULED → LOCKED (lock_time reached)
- LOCKED → LIVE (tournament_start_time reached)
- LIVE → COMPLETE (tournament_end_time reached)

**Monitoring:**

Look for these log patterns:
```
[Lifecycle] Reconciliation cycle: 3 contests processed, 1 transition
```

---

## Financial Reconciliation Worker

**Purpose:** Verifies financial system integrity and publishes reconciliation metrics.

**Monitoring:**

Subscribe to these tables:
- `system_invariant_runs` — Reconciliation run history
- `worker_heartbeats` — Worker health status

**Alert Conditions:**

| Metric | Threshold | Action |
|---|---|---|
| Reconciliation lag | > 5 minutes | Check worker health |
| Failed runs | > 2 consecutive | Escalate to ops |
| Wallet discrepancies | Any | STOP — manual review required |

---

## Worker Heartbeat Monitoring

All workers publish heartbeats to the database:

```sql
SELECT worker_name, status, last_run_at, error_count
FROM worker_heartbeats
WHERE worker_name IN ('ingestion_worker', 'lifecycle_worker', 'financial_worker')
ORDER BY last_run_at DESC;
```

**Expected Heartbeat Frequency:**

| Worker | Heartbeat Interval | Freshness Window |
|---|---|---|
| Ingestion | Every cycle (5s-5m depending on state) | 10 minutes |
| Lifecycle | Every 30 seconds | 5 minutes |
| Financial | Every reconciliation (varies) | 15 minutes |

**Health Status Values:**

- `HEALTHY` — Worker running normally
- `DEGRADED` — Worker running but with errors
- `ERROR` — Worker failed or offline
- `UNKNOWN` — No recent heartbeat

---

## Environment Variable Reference

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `INGESTION_WORKER_INTERVAL_MS` | Number (ms) | Not set | Override ingestion polling interval |
| `LIFECYCLE_RECONCILER_INTERVAL_MS` | Number (ms) | 30000 | Lifecycle reconciliation poll interval |
| `ENABLE_LIFECYCLE_RECONCILER` | Boolean | true | Enable lifecycle reconciliation |
| `ENABLE_FINANCIAL_RECONCILIATION` | Boolean | true | Enable financial reconciliation |

---

## Operational Tasks

### Monitor Worker Health

```bash
# Check heartbeats
SELECT worker_name, status, last_run_at, EXTRACT(EPOCH FROM (NOW() - last_run_at)) as seconds_ago
FROM worker_heartbeats
ORDER BY last_run_at DESC;
```

Expected output: All workers with `seconds_ago < 300` (within 5 minutes for most workers).

### Restart Ingestion Worker

The ingestion worker is started automatically when the server starts. To restart:

1. Restart the backend application
2. Verify startup logs show correct configuration
3. Confirm heartbeat appears in worker_heartbeats table

### Adjust Polling Interval

Edit environment variable and restart:

```bash
# For production
INGESTION_WORKER_INTERVAL_MS=90000  # 90 seconds

# Restart application
systemctl restart playoff-challenge-backend

# Verify in logs
tail -f /var/log/playoff-challenge/backend.log | grep "Ingestion Worker"
```

### Disable Adaptive Polling

To use a fixed interval instead of adaptive polling:

```bash
export INGESTION_WORKER_INTERVAL_MS=60000
# Application will now always use 60s interval regardless of contest status
```

### Troubleshoot Missed Ingestions

If contests are not being ingested:

1. Check worker heartbeat is recent:
```sql
SELECT status, last_run_at FROM worker_heartbeats WHERE worker_name = 'ingestion_worker';
```

2. Check logs for errors:
```bash
grep "Ingestion Worker" /var/log/playoff-challenge/backend.log | grep ERROR
```

3. Verify database connectivity:
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1;"
```

4. Check ingestion service:
```bash
# Verify ingestion service functions exist
grep -r "function run" backend/services/ingestionService.js
```

---

## Best Practices

### Production Deployment

1. **Set explicit polling interval** (recommended):
   ```bash
   INGESTION_WORKER_INTERVAL_MS=60000
   ```

2. **Monitor heartbeats** continuously via web admin or dashboards

3. **Set up alerts** for:
   - Heartbeat staleness (> 10 minutes)
   - High error counts
   - Reconciliation failures

4. **Log shipping** to external service for analysis

### Development/Testing

1. **Use adaptive polling** (default, no env var)
2. **Short intervals** for quick testing:
   ```bash
   INGESTION_WORKER_INTERVAL_MS=1000  # 1 second
   ```

3. **Disable workers** if testing synchronously:
   ```bash
   NODE_ENV=test  # Skips worker startup
   ```

---

## Backward Compatibility

The ingestion worker polling configuration is **fully backward compatible**:

- Deployments without `INGESTION_WORKER_INTERVAL_MS` work unchanged (adaptive polling)
- Existing tests pass without modification
- No behavior changes unless environment variable is explicitly set

---

## Settlement Pipeline — End-to-End Verification

### Overview

Settlement depends on a chain of 5 systems working together. If any link breaks, contests stay LIVE indefinitely and users don't get paid.

### Chain of Custody

```
ESPN Event API → Ingestion Worker → event_data_snapshots (provider_final_flag) → Lifecycle Reconciler → Settlement
```

### provider_final_flag — How It Works

**Set by:** `pgaEspnIngestion.js:1092-1153` (ingestWorkUnit, Step 4)

**Primary source:** ESPN Event API (`espnPgaApi.fetchEventMetadata`)
```
https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/{eventId}
```

**Detection logic:**
```javascript
if (eventMetadata.status?.type?.completed === true) → providerFinalFlag = true
else if (eventMetadata.status?.type?.name === 'STATUS_FINAL') → providerFinalFlag = true
```

**Fallback:** If ESPN event API fails, checks leaderboard payload status field.

**Write behavior (CRITICAL):**
```sql
ON CONFLICT (contest_instance_id, snapshot_hash) DO UPDATE
SET provider_final_flag = event_data_snapshots.provider_final_flag OR EXCLUDED.provider_final_flag
```
- OR logic makes the flag **monotonic** (false→true only, never true→false)
- `ingested_at` is NOT updated on conflict — only on INSERT (new hash)
- This means "stale" `ingested_at` does NOT mean ingestion stopped

**Timing:** Event-based, not time-based. ESPN marks events complete after the final round ends (typically Sunday evening for PGA).

### Verification Commands

**Quick check — ESPN event status:**
```bash
curl -s "https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/{ESPN_EVENT_ID}" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Accept: application/json" | jq '.status.type'
```

Expected during tournament: `"completed": false, "name": "STATUS_IN_PROGRESS"`
Expected after tournament: `"completed": true, "name": "STATUS_FINAL"`

**Full pipeline verification:**
```bash
DATABASE_URL=<url> node backend/debug/verifySettlementPipeline.js
```
Checks: worker heartbeat, snapshot freshness, ESPN reachability, code path validation, score drift.

**Settlement readiness audit:**
```bash
DATABASE_URL=<url> node backend/debug/auditSettlementReadiness.js
```

**Final snapshot readiness:**
```bash
DATABASE_URL=<url> node backend/debug/auditFinalSnapshotReadiness.js
```

### Settlement Timeline (Automatic)

1. Tournament final round ends → ESPN marks event `completed: true`
2. Ingestion worker (5s LIVE polling) picks up flag → writes `provider_final_flag=true` on snapshot
3. Lifecycle reconciler (30s interval) finds LIVE contest past `tournament_end_time` with FINAL snapshot
4. `transitionLiveToComplete()` calls `executeSettlement()` atomically
5. Settlement writes: `settlement_records`, `PRIZE_PAYOUT` ledger entries, status → COMPLETE
6. **Total latency from ESPN completion to settlement: <35 seconds**

### Known Gotcha: ingested_at Staleness

`event_data_snapshots.ingested_at` only reflects when the hash was **first seen**, not last processed. If ESPN scores haven't changed, the same hash triggers ON CONFLICT UPDATE (flag only), not a new INSERT. Cross-reference with `worker_heartbeats.last_run_at` to confirm ingestion is actually running.

---

## Related Documentation

- **Governance:** `/docs/governance/LIFECYCLE_EXECUTION_MAP.md`
- **Operations:** `/docs/operations/WEB_ADMIN_MAP.md`
- **Operations:** `/docs/operations/INGESTION_HEALTH_CHECKS.md`
- **System Status:** `/docs/production-readiness/SYSTEM_STATUS_AND_ISSUES.md`

---

## Change Log

| Date | Version | Change |
|---|---|---|
| 2026-03-12 | 1.0 | Initial documentation; INGESTION_WORKER_INTERVAL_MS support documented |
| 2026-03-20 | 1.1 | Added Settlement Pipeline verification section, provider_final_flag documentation, debug script references, ingested_at staleness gotcha |

