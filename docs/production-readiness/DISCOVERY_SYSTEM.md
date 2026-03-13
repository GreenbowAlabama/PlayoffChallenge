# Discovery System Documentation

**Status:** OPERATIONAL
**Version:** 1.0
**Last Updated:** March 12, 2026

---

## Discovery Engine Behavior (v1)

The discovery engine scans the provider calendar and ensures system contest templates and contest instances exist for upcoming tournaments.

### Discovery Window

**14 days** from current time.

All events with `start_time` that falls within this window will be discovered and processed.

### Discovery Cycle Behavior

**Single Cycle (runDiscoveryCycle):**

1. **Fetch ALL events** from the provider calendar
2. **Filter events** whose start_time falls within the discovery window (14 days)
3. **Sort events** by start_time ASC for deterministic processing
4. **For each event:**
   - Check if a system-generated contest template exists
   - If not, create the tournament template
   - Create contest instances for the template (multiple entry fee tiers)
5. **Skip events** that already have templates (idempotent)

### Key Guarantees

| Guarantee | Mechanism |
|---|---|
| **Idempotency** | Template existence checked before creation; ON CONFLICT clauses prevent duplicate inserts |
| **All-in-one cycle** | Processes ALL events in window in single cycle; no sequential iteration |
| **Template deduplication** | Unique constraint on `(provider_tournament_id, season_year)` |
| **Instance deduplication** | Unique constraint on `(provider_event_id, template_id, entry_fee_cents)` |
| **Deterministic ordering** | Events sorted by start_time before processing |
| **Non-blocking** | ESPN data fetch failures fall back to fixture data; errors logged, cycle continues |

### Inputs

- **Provider Calendar:** ESPN PGA events with:
  - `id` (ESPN event ID)
  - `label` (tournament name)
  - `startDate` (ISO 8601 UTC)
  - `endDate` (ISO 8601 UTC)

### Outputs

- **contest_templates rows:** System-generated PGA_TOURNAMENT type templates
- **contest_instances rows:** Platform-owned contests for each entry fee tier

### Processing Example

**Given:** Current time = 2026-03-12, Calendar contains events starting Mar 5, 12, 19, Apr 9

**Discovery window:** 2026-03-12 to 2026-03-26 (14 days)

**Processing:**
```
[Discovery Calendar] Checking window: 2026-03-12T00:00:00Z to 2026-03-26T00:00:00Z (5 total events, 2 candidates)
[Discovery Calendar] Evaluating event espn_pga_401811937 start=2026-03-12T04:00:00Z
[Discovery Calendar] Creating template for event espn_pga_401811937
[Discovery Calendar] Completed event espn_pga_401811937: templates_created=1, instances_created=5
[Discovery Calendar] Evaluating event espn_pga_401811938 start=2026-03-19T07:00:00Z
[Discovery Calendar] Creating template for event espn_pga_401811938
[Discovery Calendar] Completed event espn_pga_401811938: templates_created=1, instances_created=5
[Discovery Calendar] cycle_duration_ms=2341
```

**Result:**
- ✅ 2 events processed (within 14-day window)
- ✅ 2 templates created (espn_pga_401811937, espn_pga_401811938)
- ✅ 10 contest instances created (5 tiers × 2 tournaments)
- ✅ Mar 5 event skipped (before window)
- ✅ Apr 9 event skipped (beyond window)

### Configuration

**Environment Variables:**

| Variable | Purpose | Default |
|---|---|---|
| `ENABLE_DISCOVERY_WORKER` | Whether to start background discovery | `false` |
| `DISCOVERY_WORKER_INTERVAL_MS` | How often discovery runs (ms) | `300000` (5 min) |
| `PLATFORM_ORGANIZER_ID` | UUID of platform organizer user | Required |

**In Code:**

```javascript
const DISCOVERY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;  // 14 days
```

### Observability

**Startup:**
```
[Discovery Worker] Starting (interval: 300000ms, organizer: 00000000-0000-0000-0000-000000000000)
```

**Per Cycle:**
```
[Discovery Calendar] Checking window: ... (N total events, M candidates)
[Discovery Calendar] Evaluating event espn_pga_XXX start=...
[Discovery Calendar] Creating template for event espn_pga_XXX
[Discovery Calendar] Completed event espn_pga_XXX: templates_created=X, instances_created=Y
[Discovery Calendar] cycle_duration_ms=DURATION
```

**Errors:**
```
[Discovery Calendar] Skipped event espn_pga_XXX reason=template_exists
[Discovery Calendar] ERROR Evaluating event espn_pga_XXX: message
```

### Testing

**Unit Tests (discoveryContestCreation.test.js):**
- ✅ Multiple events processed in single cycle
- ✅ Templates skipped if already exist
- ✅ Idempotency across multiple cycles

### Related Documentation

- **Worker:** `/docs/production-readiness/PLATFORM_WORKERS.md`
- **Contracts:** `/docs/api/contests-endpoints.md`
- **Governance:** `/docs/governance/LIFECYCLE_EXECUTION_MAP.md`

