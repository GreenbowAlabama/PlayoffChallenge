# CLAUDE.md

## Purpose

This file documents how AI tools are intended to be used in this repository.

It is written for **humans**, not for automated execution.
It does not define instructions, triggers, or workflows for Claude.
Agent behavior is defined elsewhere.

---

## AI Usage Overview

This repository commonly uses a two-role AI workflow during development:

- Architecture-oriented reasoning
- Implementation-oriented execution

These roles are conceptual and help structure how AI assistance is applied.

---

## Architecture-Oriented Work

Architecture-oriented work typically involves:

- Reasoning about existing behavior
- Diagnosing bugs or inconsistencies
- Understanding system structure
- Planning validation or testing approaches
- Preparing implementation guidance

This work focuses on clarity and intent, not code changes.

Outputs from this phase are often written as temporary handoff documents
to guide implementation work.

---

## Implementation-Oriented Work

Implementation-oriented work typically involves:

- Writing or modifying code
- Applying an existing plan
- Fixing bugs within a defined scope
- Iterating on errors or test failures
- Producing concrete changes

This work is guided by prior analysis or a handoff document.

---

## Handoffs

A handoff is a short-lived artifact used to communicate intent
between analysis and implementation phases.

Handoffs are usually kept local during active work and may later be
promoted to documentation if they prove stable and reusable.

A typical handoff includes:
- Objective
- Current behavior
- Intended behavior
- Constraints
- Files or areas involved
- Validation steps

---

## Session Discipline

AI-assisted work in this repository favors short, focused sessions.

Common practices include:
- Starting new sessions frequently
- Avoiding reliance on conversational memory
- Restating context explicitly when needed

AI systems only know what is provided in the current session.

---

## Documentation

Only stable, validated knowledge should be committed as documentation.

Examples include:
- Confirmed root cause analyses
- Proven workflows
- Repeatable implementation guidance

Exploratory or scratch work should remain local.

---

## Source of Truth

- The codebase is the ultimate source of truth
- Documentation explains intent and context
- AI tools assist with analysis and execution

When discrepancies arise, the code takes precedence.