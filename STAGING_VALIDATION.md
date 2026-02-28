# Phase 2A Staging Validation — LOCKED → LIVE Reconciliation

**Timeline:** 24-48 hours observation
**Environment:** Staging
**Scope:** LOCKED → LIVE orchestration only
**Success Criteria:** Clean operational behavior, ready for production

---

## Pre-Deployment Setup

### 1. Configure Staging

Ensure staging has:
```bash
NODE_ENV=staging
LOCKED_TO_LIVE_INTERVAL_MS=10000
LOG_LEVEL=debug  # Allows DEBUG logs, filters INFO noise
```

### 2. Verify Database

Confirm tables exist:
```sql
SELECT COUNT(*) FROM contest_instances;
SELECT COUNT(*) FROM contest_state_transitions;
```

### 3. Deploy Code

- Update `server.js` to initialize orchestrator
- Verify `lifecycleOrchestrator.js` is in place
- Deploy to staging (both web instances if applicable)

---

## 24-Hour Observation Checklist

### ✅ Logging Behavior

- [ ] INFO logs appear **only when transitions occur** (not every 10 seconds)
- [ ] DEBUG logs are present but filtered in logs (log level is set to INFO for noise reduction)
- [ ] Timestamp format is ISO-8601 (e.g., `2026-02-28T15:30:45.123Z`)
- [ ] Duration logs show consistent low numbers (< 100ms typical)

**Success:** ~0-5 INFO logs per hour (only when transitions happen)
**Failure:** 360+ INFO logs per hour (every 10 seconds = noise)

### ✅ Database Integrity

- [ ] Count transition records: `SELECT COUNT(*) FROM contest_state_transitions WHERE triggered_by = 'TOURNAMENT_START_TIME_REACHED';`
- [ ] Verify no duplicate transitions for same contest
- [ ] Spot-check a transition: Contest was LOCKED, is now LIVE, has one transition record

**Success:** Transition count matches manually triggered contests
**Failure:** Duplicate records, out-of-order transitions, missing records

### ✅ Performance Monitoring

- [ ] Duration_ms in logs consistently < 100ms
- [ ] No sudden spikes in query time
- [ ] DB connection pool remains healthy (< max connections)
- [ ] CPU and memory stable, no growth over 24h

**Success:** Steady state operation, no anomalies
**Failure:** Duration_ms > 500ms, memory growth, pool exhaustion

### ✅ Edge Case: Restart During Reconciliation

**Trigger:**
1. Create contest with `tournament_start_time = now + 15 seconds`
2. Wait 5 seconds into the 10-second loop
3. Kill the process mid-execution
4. Restart server immediately

**Validate:**
- [ ] Orchestrator restarts cleanly
- [ ] Transition fires on next scheduled tick
- [ ] Only one transition record exists (no duplicate from restart)
- [ ] Contest status is LIVE

**Success:** Single idempotent transition
**Failure:** Duplicate transitions, status confusion, errors on restart

### ✅ Edge Case: Deploy During Active Countdown

**Trigger:**
1. Create contest with `tournament_start_time = now + 8 seconds`
2. At 3 seconds remaining, deploy new version (orchestrator stops, new instance starts)

**Validate:**
- [ ] Orchestration pauses during deploy
- [ ] No transitions missed
- [ ] Transition fires on new instance's first scheduled tick
- [ ] Single transition record

**Success:** Clean handoff between instances
**Failure:** Missed transition, duplicate record, timing edge cases

### ✅ Edge Case: Empty Tick (No Eligible Contests)

**Trigger:**
- No contests with `tournament_start_time <= now`

**Validate:**
- [ ] No INFO logs (only DEBUG no-op entries if enabled)
- [ ] Duration_ms recorded but low
- [ ] No DB anomalies
- [ ] Loop continues normally

**Success:** Silent no-op, normal operation
**Failure:** Error logs, DB errors, loop hangs

### ✅ Multi-Instance Behavior (If Deployed)

**Setup:** Deploy to 2 staging instances

**Trigger:**
1. Create contest with `tournament_start_time = now + 10 seconds`
2. Both instances receive reconciliation tick at ~10 seconds
3. Both call `transitionLockedToLive()`

**Validate:**
```sql
-- Check transition records for this contest
SELECT COUNT(*)
FROM contest_state_transitions
WHERE contest_instance_id = 'contest-uuid';
-- Expected: 1 (not 2, not 0)

-- Verify contest status
SELECT status FROM contest_instances WHERE id = 'contest-uuid';
-- Expected: LIVE
```

**Success:** Exactly one transition record despite concurrent calls
**Failure:** Duplicate records, missed transition, status inconsistency

### ✅ Shutdown Behavior

**Trigger:**
- Send SIGTERM to running process
- Send SIGINT (Ctrl+C) to running process

**Validate:**
- [ ] Orchestrator calls `stop()`
- [ ] Timers are cleared
- [ ] No errors in shutdown logs
- [ ] Process exits cleanly (exit code 0)

**Success:** Clean shutdown
**Failure:** Hanging timers, error logs, non-zero exit code

---

## Success Criteria (All Must Pass)

✅ **Logging:** INFO only on transitions, no noise
✅ **Reconciliation:** Single idempotent transitions, no duplicates
✅ **Performance:** Duration_ms stable and low (< 100ms)
✅ **Restart Safety:** Cold start reconciles eligible contests
✅ **Multi-Instance:** No race conditions, atomic UPDATE works
✅ **Shutdown:** Clean process termination
✅ **No unexpected errors:** All logs at appropriate levels

---

## Failure Criteria (Any One Blocks Expansion)

❌ **Duplicate transitions** for same contest
❌ **Missing transitions** despite eligible contests
❌ **Log spam** (INFO logs every 10 seconds)
❌ **Duration_ms > 1000ms** (indicates DB issue)
❌ **Process hangs** on shutdown
❌ **Memory growth** over 24 hours
❌ **Pool exhaustion** (max connections reached)
❌ **Timestamp inconsistencies** (status changed before transition logged)

---

## Rollback Plan

If orchestration misbehaves during staging validation:

### Quick Disable (5 seconds)

**Option 1: Code Comment**
```javascript
// server.js
const server = app.listen(PORT, () => {
  // orchestrator.start();  // DISABLED for rollback
  logger.info(`Server listening (orchestration disabled)`);
});
```
Deploy. No orchestrator runs.

**Option 2: Environment Flag**
```javascript
if (process.env.ENABLE_LIFECYCLE_ORCHESTRATION === 'true') {
  orchestrator.start();
}
```
Set `ENABLE_LIFECYCLE_ORCHESTRATION=false` in staging env, redeploy.

### Full Rollback to Previous Version

```bash
git revert <commit>
git push
# Deploy previous version
```

---

## Observation Log Template

Copy this and fill in during the 24-48 hour window:

```
Date: [Date]
Instance Count: [1 or 2+]
Contests Created: [X]
Transitions Observed: [Y]
Duration Range: [min-max ms]
INFO Log Count (per hour): [estimate]
Errors: [list any]
Anomalies: [list any]
Ready for Production: [YES / NO / INVESTIGATE]
```

---

## Sign-Off

After 48 hours of clean observation:

**Staging Validation Complete** ✅
- All success criteria met
- No failure criteria triggered
- Ready for Phase 2B discussion
- Document any performance tuning (e.g., interval adjust, log level change)

**Do NOT proceed to Phase 2B until validation is complete.**
