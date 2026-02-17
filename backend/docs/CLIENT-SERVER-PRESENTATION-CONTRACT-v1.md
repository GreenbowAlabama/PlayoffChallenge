# Client–Server Presentation Contract v1
Version: 1.0  
Status: Active  
Owner: Platform Architecture  
Last Updated: 2026-02-16  

---

# 1. Purpose

This document defines the JSON contract required for the iOS client to render contests without requiring app updates for new contest types.

The goal is **client fluidity**:
- New contest types can be introduced server-side.
- The iOS client renders them using structured presentation metadata.
- No contest-type branching logic exists in the client.
- Infrastructure invariants remain untouched.

This contract governs presentation only. It does not redefine settlement, payment, or lifecycle logic.

---

# 2. Design Principles

1. **Server Defines Presentation**
   The backend provides structured display configuration.

2. **Client Renders Sections**
   The client renders UI based on `sections[]`, not `contest.type`.

3. **No Type Switching**
   The client must not switch behavior on contest type.

4. **Deterministic Structure**
   All fields required for rendering must be present and typed.

5. **Backward Compatibility**
   New fields may be added.
   Existing fields must not change meaning.

---

# 3. Contest List Contract

Endpoint:
GET /api/contests

Purpose:
Render contest list screen without type-specific logic.

### Response Shape

```json
{
  "contests": [
    {
      "id": "uuid",
      "type": "string",
      "state": "SCHEDULED | LOCKED | LIVE | COMPLETE | PAID | CANCELLED | ERROR",

      "display": {
        "title": "string",
        "subtitle": "string",
        "badge": "string",
        "status_label": "string"
      },

      "timing": {
        "starts_at": "ISO8601",
        "locks_at": "ISO8601",
        "completes_at": "ISO8601 | null"
      },

      "entry": {
        "entry_fee_cents": "integer",
        "currency": "ISO currency code",
        "max_entries": "integer",
        "current_entries": "integer"
      },

      "presentation": {
        "primary_color": "hex string",
        "icon": "string identifier",
        "hero_image_url": "string URL"
      }
    }
  ]
}

Rules
	•	Client must render list using display and presentation.
	•	Client must not infer layout from type.
	•	All currency formatting is client responsibility.
	•	All numeric values are raw integers.

⸻

4. Contest Detail Contract

Endpoint:
GET /api/contests/{id}

Purpose:
Render contest detail screen dynamically.

Response Shape

{
  "id": "uuid",
  "type": "string",
  "state": "enum",

  "display": {
    "title": "string",
    "description": "string",
    "rules_url": "string URL | null"
  },

  "sections": [
    {
      "type": "summary | roster_config | scoring_overview | payout_table | custom",
      "data": "object (defined per section type)"
    }
  ],

  "actions": {
    "can_join": "boolean",
    "can_edit_roster": "boolean",
    "can_view_leaderboard": "boolean"
  }
}


⸻

5. Section Type Definitions

5.1 summary

{
  "type": "summary",
  "data": {
    "entry_fee": "string",
    "prize_pool": "string",
    "entries": "string"
  }
}


⸻

5.2 roster_config

{
  "type": "roster_config",
  "data": {
    "roster_size": "integer",
    "positions": ["string"],
    "salary_cap": "integer | null",
    "lock_time": "ISO8601"
  }
}

Client must generate roster UI dynamically from this section.

⸻

5.3 scoring_overview

{
  "type": "scoring_overview",
  "data": {
    "format": "string",
    "rounds": "integer | null",
    "tie_breaker": "string | null"
  }
}

Purely informational.

⸻

5.4 payout_table

{
  "type": "payout_table",
  "data": [
    {
      "rank": "integer",
      "amount": "string"
    }
  ]
}

Client renders table rows in order received.

⸻

6. Leaderboard Contract

Endpoint:
GET /api/contests/{id}/leaderboard

Purpose:
Dynamic leaderboard rendering.

Response Shape

{
  "contest_id": "uuid",
  "state": "enum",

  "columns": [
    { "key": "string", "label": "string" }
  ],

  "rows": [
    {
      "key": "value"
    }
  ]
}

Rules
	•	Client renders table using provided columns.
	•	Client must not assume specific column names.
	•	Row keys must match column keys.

⸻

7. Roster Submission Contract

Endpoint:
POST /api/contests/{id}/entries

Request

{
  "roster": [
    { "player_id": "uuid" }
  ]
}

Validation is server authoritative.

Client uses roster_config to guide UI, but server enforces rules.

⸻

8. Prohibited Client Behavior

The client MUST NOT:
	•	Branch on contest.type
	•	Hardcode payout layout
	•	Hardcode roster positions
	•	Hardcode scoring format
	•	Hardcode leaderboard columns
	•	Modify contest lifecycle
	•	Infer settlement logic

All rendering must derive from contract fields.

⸻

9. Versioning Rules
	•	Breaking changes require contract version increment.
	•	Additive fields are allowed.
	•	Section types may expand.
	•	Removal of section types requires deprecation window.

⸻

10. Definition of Client Fluidity

The system is considered fluid when:
	1.	A new contest type is created server-side.
	2.	Backend defines its sections[].
	3.	iOS renders the contest without code modification.
	4.	No App Store release is required.

⸻

11. Non-Goals

This contract does not:
	•	Redefine scoring algorithms
	•	Redefine settlement logic
	•	Redefine payout execution
	•	Modify contest lifecycle
	•	Replace OpenAPI documentation

This is a presentation-layer contract only.

⸻

End of Document