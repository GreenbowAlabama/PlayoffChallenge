# Control Room Architecture (Operational Governance)

## Purpose

The Control Room is the **single operational console** for platform monitoring and diagnosis.

No new monitoring dashboards, diagnostics pages, or admin health panels may be created
outside the Control Room tower structure.

All operational visibility must surface through the towers.

---

## Control Room Entry Point

/admin

This is the root of all operational monitoring.

Operators must be able to diagnose system state without running manual queries.

---

## Tower Structure

Each operational domain is represented by a tower.

Current towers:

1. Platform Health
   Path: /admin/platform-health
   Responsibility:
   - worker health
   - infrastructure signals
   - lifecycle engines
   - system invariants

2. Contest Ops
   Path: /admin/contest-ops
   Responsibility:
   - contest lifecycle monitoring
   - lock states
   - contest state distribution
   - entry counts

3. Player Data
   Path: /admin/player-data
   Responsibility:
   - ingestion pipeline
   - snapshot health
   - scoring lag
   - player pool coverage

4. User Ops
   Path: /admin/user-ops
   Responsibility:
   - user growth
   - wallet health
   - engagement metrics
   - participation rates

5. Financial Ops (reserved)
   Future path: /admin/financial
   Responsibility:
   - wallet float
   - payout pipeline
   - ledger integrity
   - settlement health

---

## Architectural Rules

1. All monitoring UI must live inside towers.

2. New monitoring pages are **not allowed** outside `/admin`.

3. Towers must only display **signals**, not manual actions.

4. Actions belong in operational pages such as:
   /admin/operations
   /funding
   /users

5. Towers must rely on **API snapshots**, never direct queries.

---

## Design Principles

The Control Room is designed for **signal detection**, not exploration.

Operators should be able to:

- detect platform failures
- identify pipeline lag
- detect lifecycle errors
- detect financial anomalies

within seconds of opening the Control Room.

---

## Forbidden Patterns

The following patterns are banned:

- "mega dashboards"
- ad-hoc diagnostic pages
- duplicate health panels
- monitoring UI outside /admin

Examples of removed legacy pages:

- /dashboard
- /system-invariants
- /contest-ops (legacy)
- /diagnostics/users

These were removed during the Control Room consolidation.

---

## Extending the System

When new operational visibility is required:

1. Identify the correct tower
2. Add a new panel to that tower
3. Extend the tower snapshot API
4. Do not create new admin dashboards

---

## Outcome

The platform now has a **single operational console**.

All system health, pipeline health, contest health, and user health signals are centralized.

This architecture dramatically reduces operational complexity and eliminates monitoring fragmentation.

