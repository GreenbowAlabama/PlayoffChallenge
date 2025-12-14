# CLAUDE.md

Purpose:
This file defines how AI tools are used in this repository.
It is for humans, not for Claude.
Claude does not read this file automatically.

Do not paste this entire file into Claude.

---

## AI Usage Model

This repository uses a two-role AI workflow:

1. Architect
2. Worker

Each role has strict boundaries.

---

## Architect Role

Use the Architect role when:
- Designing a solution
- Diagnosing a bug
- Understanding existing architecture
- Planning testing or data flows
- Resuming partially completed work

Rules:
- No production code
- No refactoring
- No long-running sessions
- Focus on reasoning and decisions

Every Architect session must end with a handoff.

---

## Worker Role

Use the Worker role when:
- Writing or modifying code
- Implementing a known plan
- Debugging within defined scope
- Creating scripts or SQL
- Iterating on errors

Rules:
- Do not redesign
- Do not expand scope
- Follow the handoff exactly
- Ask questions only when blocked

---

## Handoffs

Handoffs are the contract between Architect and Worker.

Rules:
- Handoffs live locally during active work as `handoff.md`
- Handoffs are not committed by default
- Promote a handoff to documentation only after it is validated

A good handoff includes:
- Objective
- Current state
- Files to touch
- What to reuse
- What not to change
- Validation steps

---

## Session Discipline

- Start new Claude sessions aggressively
- Never rely on session memory
- Never attempt to resume a dying session
- If interrupted, restart with a continuation goal

Claude has no memory unless you give it memory.

---

## Documentation Promotion

Only stable, repeatable knowledge belongs in documentation.

Examples:
- Final bug root cause analyses
- Validated testing workflows
- Reusable implementation guides

Scratch work does not belong in the repo.

---

## Source of Truth

- Code is the source of truth
- Documentation explains intent
- AI assists, but does not decide

If there is conflict, trust the code.