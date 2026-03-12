# Admin Control Room Governance

**Status:** AUTHORITATIVE
**Governance Version:** 1
**Last Verified:** 2026-03-11

## Purpose

The Admin Control Room provides a single operational console for monitoring the health and behavior of the platform.

It exists to eliminate ad-hoc SQL queries, scattered debugging pages, and fragmented operational tooling.

All operational monitoring must flow through the Control Room.

Primary entry point:

/admin

---

## Control Room Structure

The Control Room consists of four operational towers.

Each tower represents a domain of platform health.

Admin Control Room
│
├ Platform Health Tower
├ Contest Ops Tower
├ Player Data Tower
└ User Ops Tower

These towers are the authoritative locations for operational diagnostics.

---

## Tower Responsibilities

### Platform Health Tower

Purpose:
Monitor infrastructure and platform runtime health.

Signals include:
- Database connectivity
- External API availability
- Worker health
- System invariants
- Server time synchronization

Endpoint sources:

/api/admin/platform-health  
/api/admin/system-invariants

---

### Contest Ops Tower

Purpose:
Monitor the lifecycle and operational status of contests.

Signals include:
- Contest state counts
- Live contest monitoring
- Entry counts
- Lock time validation
- Template and provider event status

Endpoint sources:

Discovery APIs for contest instances.

---

### Player Data Tower

Purpose:
Monitor the player ingestion and scoring pipeline.

Signals include:
- Ingestion lag
- Worker execution health
- Player pool coverage
- Snapshot creation status
- Scoring execution timing

Endpoint sources:

/api/admin/player-data/ops

---

### User Ops Tower

Purpose:
Monitor user growth, engagement, and wallet funding activity.

Signals include:
- User creation trends
- Wallet balances
- Contest participation
- Engagement metrics
- Funded user ratios

Endpoint sources:

/api/admin/users/ops

---

## Governance Rules

### Rule 1 — Single Monitoring Surface

Operational diagnostics must live in the Control Room towers.

New monitoring pages must not be created outside the Control Room.

If a signal is required it must be added to the appropriate tower.

---

### Rule 2 — Towers Own Their Domain

Each operational domain belongs to a specific tower.

Platform infrastructure → Platform Health  
Contest lifecycle → Contest Ops  
Player ingestion & scoring → Player Data  
User growth & wallet activity → User Ops

Signals must not be duplicated across towers.

---

### Rule 3 — No Parallel Debug Pages

Legacy admin pages that expose operational signals must be removed once those signals exist in a tower.

The Control Room replaces:

- ad-hoc debug dashboards
- worker inspection pages
- ingestion status tools
- lifecycle debugging views

Manual administrative actions may exist elsewhere, but monitoring must remain in the towers.

---

### Rule 4 — Signal Over Data

The Control Room is not an analytics dashboard.

Its purpose is operational signal detection.

Each tower should clearly communicate:

- Healthy
- Warning
- Critical

Operators should be able to identify issues within seconds.

---

### Rule 5 — Control Room Is the First Place to Look

During incidents or operational debugging:

Step 1: Open /admin  
Step 2: Identify which tower reports the issue  
Step 3: Investigate within that tower  

SQL queries should only be used if deeper debugging is required.

---

## Outcome

The Control Room ensures that platform operations remain observable, centralized, and maintainable.

It provides a clear operational console for:

- development
- debugging
- launch readiness
- production monitoring

This governance ensures the system does not drift back into fragmented monitoring tools.

