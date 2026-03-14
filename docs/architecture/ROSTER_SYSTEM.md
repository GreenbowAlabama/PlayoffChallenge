# Roster System
67 Enterprises – Playoff Challenge Platform

---

## Field Selections Lazy Creation (Golf)

### Problem

Golf contests could publish before discovery ingestion created `tournament_configs`.

**Result:** `field_selections` rows were not created, causing the MyLineup screen to show no players.

### Fix

`entryRosterService.getMyEntry()` now lazily creates `field_selections` if:

- `tournament_configs` exists
- `field_selections` does not exist
- `availablePlayers` is populated

**Insert uses:**

```sql
INSERT ... ON CONFLICT DO NOTHING
```

### Guarantees

- ✅ Idempotent
- ✅ Safe under concurrency
- ✅ No fabricated foreign keys
- ✅ Does not block the request path

**Fallback behavior:** Always returns player list even if persistence fails.

---
