# iOS Client Architecture
67 Enterprises – Playoff Challenge Platform

---

## Sport-Based Gameplay Routing

The iOS client routes gameplay behavior using the `sport` property on the Contest domain model.

### Mapping

| Layer | Field |
|-------|-------|
| Backend Field | `template_sport` |
| DTO | `ContestDetailResponseDTO.template_sport` |
| Domain | `Contest.sport` |
| Enum | `Sport.swift` |

### Routing Behavior

- **`Sport.golf`**
  - Use `/api/custom-contests/{id}/my-entry`
  - Golf-specific player pool logic

- **`Sport.nfl`**
  - Use `/api/players` and week-based logic
  - NFL-specific lineup submission

**Benefit:** Prevents coupling gameplay logic to template types.

---
