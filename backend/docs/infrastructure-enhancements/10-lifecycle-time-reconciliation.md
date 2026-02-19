# 10 - Lifecycle Time Reconciliation Enhancement

## Status
Proposed

## Context

The `contest_instances.status` column is currently stored and manually mutated.
There is no time-driven reconciliation process.

Observed behavior:
- Contests remain `SCHEDULED` even after `lock_time`, `start_time`, or `end_time` have passed.
- iOS renders stale lifecycle state accurately based on stored data.
- Filtering patch applied to Available endpoint prevents joinable leakage.

This reveals a lifecycle governance gap:
The system models a time-based lifecycle but does not enforce it.

## Problem

Lifecycle states:
SCHEDULED → LOCKED → LIVE → COMPLETE

Time fields:
- lock_time
- start_time
- end_time

Currently:
- Status does not auto-transition.
- No background reconciler exists.
- No DB-level enforcement.
- No audit trail for lifecycle transitions.

## Risk

- Inconsistent lifecycle state
- Operational confusion
- Settlement automation risk
- Incorrect reporting

## Proposed Enhancement

Implement a deterministic background reconciliation worker that:

1. Transitions SCHEDULED → LOCKED when now >= lock_time
2. Transitions LOCKED → LIVE when now >= start_time
3. Transitions LIVE → COMPLETE when now >= end_time

Requirements:

- Idempotent
- Append audit log entries
- No destructive rewrites
- Safe to run every minute
- Deterministic ordering of transitions

## Implementation Phase

Post-demo.
After Available endpoint patch stabilizes.

## Architectural Notes

Do NOT compute lifecycle dynamically inside list endpoints.
Do NOT mutate lifecycle on read.
Use background worker model.

## Decision

Deferred until after MVP demo.
Filtering patch mitigates user-facing issue.

