# Contest API Endpoints

**Version:** v1
**Maintainer:** Platform Backend
**Last Updated:** 2026-03-12
**Status:** Temporary test surface (MVP)

---

## Quick Mental Model

- **Home** = Discover upcoming contests
- **My** = Track your joined contests
- **Available** = Legacy endpoint for joinable contests

---

## Overview

Contest discovery in Playoff Challenge is **lifecycle-driven**. Visibility is determined by contest status rather than time-based filtering.

### Contest Lifecycle States

| Status | Meaning | Visible | Joinable |
|--------|---------|---------|----------|
| **SCHEDULED** | Accepting entries | ✅ Yes | ✅ Yes (before lock) |
| **LIVE** | Contest in progress | ✅ Yes | ❌ No |
| **COMPLETE** | Contest finished | ✅ Yes | ❌ No |
| **CANCELLED** | Cancelled by organizer | ⚠️ Archived | ❌ No |
| **ERROR** | System failure state | ❌ Hidden | ❌ No |

**Design Principle:** Visibility is determined by status field, not time comparisons. This prevents race conditions and maintains deterministic behavior.

---

## GET /api/contests/home

**Purpose:** Home feed discovery for rotating weekly contest visibility.

**Use Case:** Display upcoming contests on home tab. Shows all available SCHEDULED contests.

### Request

```http
GET /api/contests/home
Authorization: Bearer {user_id}
```

### Filters

- **Status:** `SCHEDULED` only
- **Participation:** None (shows all SCHEDULED contests)
- **Capacity:** None (shows all regardless of entries)

### Sorting

- **Primary:** `lock_time ASC` (earliest lock first)
- **Secondary:** `created_at DESC` (newest first when lock_time is NULL)

### Response

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "contest_name": "PGA — THE PLAYERS Championship 2026 Contest",
    "status": "SCHEDULED",
    "lock_time": "2026-03-13T12:30:00Z",
    "entry_fee_cents": 5000,
    "entry_count": 12,
    "max_entries": 100,
    "user_has_entered": false,
    "organizer_name": "Platform"
  },
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "contest_name": "PGA — Arnold Palmer Invitational 2026 Contest",
    "status": "SCHEDULED",
    "lock_time": "2026-03-15T14:00:00Z",
    "entry_fee_cents": 5000,
    "entry_count": 8,
    "max_entries": 100,
    "user_has_entered": false,
    "organizer_name": "Platform"
  }
]
```

### Notes

- May include contests the user has already joined (use `user_has_entered` to determine state)
- No time-based filtering (`lock_time > NOW()` is forbidden)
- Designed for iOS Home tab rotation
- No pagination (returns all SCHEDULED contests)

---

## GET /api/contests/my

**Purpose:** User contest dashboard showing all contests user has joined.

**Use Case:** "My Contests" tab showing active, past, and archived contests.

### Request

```http
GET /api/contests/my
Authorization: Bearer {user_id}
Content-Type: application/json
```

### Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 50 | 200 | Page size |
| `offset` | integer | 0 | — | Skip N results |

### Filters

- **User:** Must be participant in `contest_participants` table
- **Status:** All statuses (SCHEDULED, LIVE, COMPLETE, CANCELLED, ERROR)

### Sorting

**Primary:** Lifecycle order

1. LIVE (soonest end_time first)
2. SCHEDULED (latest lock_time first)
3. COMPLETE (newest settle_time first)
4. CANCELLED (newest created_at first)
5. ERROR (newest created_at first)

### Request Example

```http
GET /api/contests/my?limit=10&offset=0 HTTP/1.1
Authorization: Bearer 11111111-1111-1111-1111-111111111111
```

### Response Example

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "contest_name": "PGA — THE PLAYERS Championship 2026 Contest",
    "status": "LIVE",
    "entry_fee_cents": 5000,
    "entry_count": 45,
    "user_has_entered": true,
    "lock_time": "2026-03-13T12:30:00Z",
    "end_time": "2026-03-16T17:00:00Z",
    "organizer_name": "Platform"
  },
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "contest_name": "PGA — Arnold Palmer Invitational 2026 Contest",
    "status": "SCHEDULED",
    "entry_fee_cents": 5000,
    "entry_count": 8,
    "user_has_entered": true,
    "lock_time": "2026-03-15T14:00:00Z",
    "organizer_name": "Platform"
  }
]
```

### Notes

- Only returns contests where user is a **participant**
- Includes all lifecycle statuses
- Pagination supported via `limit` and `offset` parameters
- Response is array only (no pagination metadata wrapper)

---

## GET /api/contests/live

**Purpose:** Live contests display for the LIVE tab showing contests currently in progress.

**Use Case:** Display all contests that are currently executing (LIVE status).

### Request

```http
GET /api/contests/live
Authorization: Bearer {user_id}
```

### Filters

- **Status:** `LIVE` only
- **Participation:** None (shows all LIVE contests)
- **Capacity:** None (shows all regardless of entries)

### Sorting

- **Primary:** `end_time ASC` (contests ending soonest first)

### Response

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "contest_name": "PGA — THE PLAYERS Championship 2026 Contest",
    "status": "LIVE",
    "lock_time": "2026-03-13T12:30:00Z",
    "end_time": "2026-03-16T17:00:00Z",
    "entry_fee_cents": 5000,
    "entry_count": 45,
    "user_has_entered": true,
    "organizer_name": "Platform"
  },
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "contest_name": "PGA — Arnold Palmer Invitational 2026 Contest",
    "status": "LIVE",
    "lock_time": "2026-03-14T10:00:00Z",
    "end_time": "2026-03-17T18:00:00Z",
    "entry_fee_cents": 5000,
    "entry_count": 32,
    "user_has_entered": false,
    "organizer_name": "Platform"
  }
]
```

### Notes

- Returns contests sorted by proximity to end (soonest end first)
- Includes all users regardless of participation
- No pagination (returns all LIVE contests)
- Used by iOS LIVE tab to show active contests

---

## GET /api/contests/available (Legacy)

⚠️ **DEPRECATED:** This endpoint is retained for backward compatibility.
**Recommendation:** Migrate to `GET /api/contests/home` for new clients.

**Purpose:** Joinable contests available for user enrollment.

### Request

```http
GET /api/contests/available
Authorization: Bearer {user_id}
```

### Filters

- **Status:** `SCHEDULED` only
- **User Participation:** NOT in contest_participants
- **Capacity:** `entry_count < max_entries` OR `max_entries IS NULL`
- **Time Filter:** `lock_time IS NULL OR lock_time > NOW()` (legacy time-based filter)

### Sorting

- **Primary:** `is_platform_owned DESC` (platform contests first)
- **Secondary:** `created_at DESC` (newest first)

### Response

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "contest_name": "PGA — THE PLAYERS Championship 2026 Contest",
    "status": "SCHEDULED",
    "entry_fee_cents": 5000,
    "entry_count": 12,
    "max_entries": 100,
    "user_has_entered": false,
    "is_platform_owned": true,
    "organizer_name": "Platform"
  }
]
```

### Notes

- ⚠️ **Legacy:** Uses time-based filtering (`lock_time > NOW()`)
- Excludes contests user already joined
- Excludes full contests
- Not recommended for new integrations
- Will be phased out in Phase 2

---

## Architecture Notes

### The Four Endpoint Roles

**Home (`GET /api/contests/home`)**
- Discovers **all upcoming contests** for discovery
- No user-scoping
- Sorted by proximity (earliest lock first)
- Enables rotation between contests

**My Contests (`GET /api/contests/my`)**
- Shows **user's personal engagement**
- Includes all lifecycle statuses
- Sorted by urgency (LIVE first)
- Supports pagination for large portfolios

**LIVE (`GET /api/contests/live`)**
- Shows **contests currently executing**
- Status-filtered (LIVE only)
- Sorted by end time (soonest first)
- No pagination (all LIVE contests)
- Used by iOS LIVE tab

**Available/Legacy (`GET /api/contests/available`)**
- Historical endpoint
- Time-based filtering (deprecated pattern)
- Retained for backward compatibility
- Will be removed in Phase 2+

### Design Principles

**Lifecycle-Driven Visibility**
```
Visibility = Contest Status (not time comparison)

✅ Correct:   WHERE status = 'SCHEDULED'
❌ Wrong:     WHERE lock_time > NOW()
```

**Rationale:** Time comparisons create race conditions. The contest status field is the authoritative visibility indicator.

**Determinism**
- All sorting uses timestamp fields (not `NOW()`)
- No implicit time-based filtering
- Replaying the same query produces identical results

---

## Joining Contests

Joining is handled by a separate endpoint:

```http
POST /api/custom-contests/{id}/join
Authorization: Bearer {user_id}
Content-Type: application/json

{
  "entry_data": { /* contest-type specific */ }
}
```

**Enforcement:**
- Backend validates `lock_time` at join time
- Entry fee is atomic with participant insert
- User can only join once (unique constraint)
- Capacity enforced via CTE

---

## Submitting Picks (Golf)

Submitting player picks is handled by a separate endpoint:

```http
POST /api/custom-contests/{id}/picks
Authorization: Bearer {user_id}
Content-Type: application/json

{
  "player_ids": ["espn_5724", "espn_8234", "espn_9102"]
}
```

### Request

- **player_ids:** Array of player IDs (required)
- **Format:** Player IDs may be submitted as `"5724"` or `"espn_5724"` (backend normalizes to canonical format)

### Response (200 OK)

```json
{
  "success": true,
  "player_ids": ["espn_5724", "espn_8234", "espn_9102"],
  "updated_at": "2026-03-13T10:24:36.000Z"
}
```

### Roster Submission Rules

**Partial roster persistence is supported.** Valid roster sizes:

- `[]` — Empty roster (0 players)
- `["p1"]` — Single player (partial)
- `["p1", "p2", "p3"]` — Multiple players (partial)
- `["p1", "p2", "p3", "p4", "p5", "p6", "p7"]` — Full roster (complete)

**Validation range:** `0 <= player_ids.length <= roster_size`

### Validation Constraints

Backend enforces:

1. **Roster size** — Must not exceed `roster_size` limit (400 error)
2. **No duplicates** — All player_ids must be unique (400 error)
3. **Field membership** — All players must exist in contest field (400 error)
4. **Contest state** — Contest must be SCHEDULED (409 error)
5. **Lock window** — Contest must not be past lock_time (409 error)
6. **Participation** — User must be an entered participant (403 error)

### Architectural Notes

Incremental roster persistence enables clients to save lineup progress while users build their roster. This prevents data loss and improves UX during lineup construction.

---

## Error Responses

### Common Errors

| Status | Code | Meaning |
|--------|------|---------|
| 401 | `UNAUTHORIZED` | Missing or invalid auth token |
| 404 | `NOT_FOUND` | Contest does not exist |
| 409 | `CONTEST_LOCKED` | Cannot join (past lock_time) |
| 409 | `CONTEST_FULL` | Cannot join (at capacity) |
| 409 | `ALREADY_JOINED` | User already participant |

---

## Migration Path

### For Clients Currently Using `/available`

**Phase 1 (Current):**
- Both `/available` and `/home` are available
- `/available` continues to work with time-based filtering

**Phase 2 (Planned):**
- Recommend migrating to `/home`
- `/available` still functional but deprecated

**Phase 3+ (Future):**
- `/available` may be removed
- Clients must use `/home` for discovery

---

## Related Documentation

- **Architecture:** `/docs/architecture/Architecture-Deep-Dive.md`
- **Contest Lifecycle:** `/docs/governance/LIFECYCLE_EXECUTION_MAP.md`
- **Discovery System:** `/docs/governance/04-discovery-system/`
- **OpenAPI Schema:** `/backend/contracts/openapi.yaml`
