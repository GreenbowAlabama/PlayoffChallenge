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

### Automatic Template and Contest Creation

**Discovery automatically generates system templates and contest instances when a tournament is first detected.**

When `runDiscoveryCycle()` discovers a new tournament (an event with no existing system template), it:

1. Calls `discoverTournament()` to create a system-generated template
2. Automatically configures the template with PGA-specific scoring, settlement, and payout rules
3. Calls `createContestsForEvent()` to auto-create contest instances with deterministic tier ladder:
   - 5 contests per event ($5, $10, $20, $50, $100)
   - Highest tier ($100) deterministically marked: `is_primary_marketing = true`
   - All instances status = SCHEDULED, is_platform_owned = true

**This flow is fully autonomous** — manual template and contest creation is not required.

**Event ID Normalization:**

All event IDs are normalized to the format `espn_pga_{event_id}` before any database queries:

```
Raw ESPN ID:     401811937
Normalized:      espn_pga_401811937
```

Normalization happens in `calendarProvider.js` before events reach discovery logic.

### Discovery Cycle Behavior

**Single Cycle (runDiscoveryCycle):**

1. **Fetch ALL events** from the provider calendar
2. **Filter events** whose start_time falls within the discovery window (14 days)
3. **Sort events** by start_time ASC for deterministic processing
4. **For each event:**
   - Check if a system-generated contest template exists
   - **If NOT found:**
     - Call `discoverTournament()` to auto-create the template
     - Call `createContestsForEvent()` to create 5-tier contest ladder
   - **If found:**
     - Skip template creation (idempotent)
     - Skip instance creation (idempotent)
5. **Result:** Exactly 5 contests per event with deterministic marketing selection

### Key Guarantees

| Guarantee | Mechanism |
|---|---|
| **Idempotency** | Template existence checked before creation; ON CONFLICT clauses prevent duplicate inserts |
| **All-in-one cycle** | Processes ALL events in window in single cycle; no sequential iteration |
| **Template deduplication** | Unique constraint on `(provider_tournament_id, season_year)` |
| **Instance deduplication** | Unique constraint on `(provider_event_id, template_id, entry_fee_cents)` |
| **Deterministic ordering** | Events sorted by start_time before processing |
| **Deterministic marketing** | Highest tier ($100) always marked `is_primary_marketing = true`; unique constraint enforces at most 1 per template |
| **Tier ladder exactness** | Exactly 5 contests per event: [$5, $10, $20, $50, $100] |
| **Non-blocking** | ESPN data fetch failures fall back to fixture data; errors logged, cycle continues |

### Inputs

- **Provider Calendar:** ESPN PGA events with:
  - `id` (ESPN event ID)
  - `label` (tournament name)
  - `startDate` (ISO 8601 UTC)
  - `endDate` (ISO 8601 UTC)

### Outputs

- **contest_templates rows:** System-generated PGA_TOURNAMENT type templates
- **contest_instances rows:** Platform-owned 5-tier contests for each event with:
  - Entry fees: $5, $10, $20, $50, $100 (in cents: 500, 1000, 2000, 5000, 10000)
  - Exactly one marked `is_primary_marketing = true` ($100 tier)
  - All others `is_primary_marketing = false`
  - All status = SCHEDULED with is_platform_owned = true

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
[Discovery Calendar] Creating system template for event espn_pga_XXX
[Discovery] ✓ Created system template: event=espn_pga_XXX, template_id=<uuid>
[Discovery Calendar] Completed event espn_pga_XXX: templates_created=X, instances_created=Y
[Discovery Calendar] cycle_duration_ms=DURATION
```

**Template Auto-Creation Logs:**
- `[Discovery Calendar] Creating system template for event espn_pga_XXX` — Template creation initiated
- `[Discovery] ✓ Created system template: event=espn_pga_XXX, template_id=<uuid>` — Template successfully created
- `[Discovery Calendar] Skipped event espn_pga_XXX reason=template_exists` — Template already existed, skipped creation

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

