# Standings — Lifecycle Integration

**Status:** AUTHORITATIVE
**Last Updated:** 2026-03-20

---

## When Standings Are Computed

| Contest Status | Standings Source | Method |
|---|---|---|
| SCHEDULED | Participant list (no scores) | `_getScheduledStandings()` |
| LOCKED | Participant list (no scores) | `_getScheduledStandings()` |
| LIVE | Strategy-specific live computation | `strategy.liveStandings()` |
| COMPLETE | Settlement snapshot (immutable) | `_getCompleteStandings()` |
| CANCELLED | None | Not included in response |
| ERROR | None | Not included in response |

---

## LIVE Standings — PGA Standard V1

Dispatched via `scoringStrategyRegistry.getStrategy('pga_standard_v1')`.

### Data Flow

1. `entry_rosters.player_ids` → UNNEST → full roster (7 golfers per user)
2. Pre-aggregate `golfer_scores` by `(contest_instance_id, golfer_id)`
3. LEFT JOIN aggregated scores onto roster (missing = 0)
4. Rank per user by `total_points DESC`
5. Conditional best-6-of-7 (drop lowest if roster >= 7)
6. Return flat `{ user_id, user_display_name, total_score, rank }`

### **INVARIANT: Same golfer across multiple users → identical contribution**

The pre-aggregation step (2) is critical. Without it, cross-user rows in `golfer_scores` cause score multiplication.

See `docs/architecture/scoring/PGA_STANDARD_V1.md` for full postmortem and canonical SQL pattern.

---

## Response Shape (Contest Detail Standings)

Backend returns flat standings array on `row.standings`:

```json
{
  "user_id": "uuid",
  "user_display_name": "string",
  "total_score": 3,
  "rank": 1
}
```

iOS decodes via `StandingDTO` (flat, no nesting).

The dedicated leaderboard endpoint returns the full `LeaderboardRowAPIDTO` shape with `values` dict. These are two separate paths.
