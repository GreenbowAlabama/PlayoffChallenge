# API Contracts
67 Enterprises – Playoff Challenge Platform

---

## Contest Sport Field

The backend API returns a `template_sport` field used by the iOS client to determine which gameplay system to route to.

**Example:**

```json
{
  "template_id": "...",
  "type": "PGA_DAILY",
  "template_sport": "GOLF"
}
```

**Values:**

- `GOLF`
- `NFL`

### Client Routing Rule

The iOS client **MUST** route gameplay logic based on `template_sport`, not `template_type`.

**Reason:** Multiple template types can exist within a sport.

**Example:**

- `PGA_DAILY`
- `PGA_TOURNAMENT`
- `PGA_MASTERS`

All must route to the golf roster system.

---
