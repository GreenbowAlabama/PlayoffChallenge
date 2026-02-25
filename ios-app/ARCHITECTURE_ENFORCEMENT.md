# Architecture Enforcement

This document tracks enforcement guardrails introduced to maintain design system authority and prevent architectural drift.

---

## Phase 6 — Radius Token Enforcement (CLOSED)

### Summary
Complete migration of all numeric corner radius literals to centralized design tokens. Established first enforcement guard to prevent regression.

### Migration Details
- **Total instances migrated:** 37 files across Views, Components, and Services
- **Token compliance:** 100% of `.cornerRadius()` calls now use `DesignTokens.Radius`
- **RoundedRectangle compliance:** 100% of `RoundedRectangle(cornerRadius:)` calls use token values

### Intentional Exceptions
- **LineupView.swift, line 289:** 2px decorative micro-radius preserved for specific visual treatment

### Enforcement
- **CI Guard:** `ios-app/scripts/enforce-radius-tokens.sh`
- **Trigger:** Detects numeric literals in `.cornerRadius()` calls
- **Scope:** Excludes `DesignTokens.Radius` usage and documented exceptions
- **Failure mode:** CI exits with error on violation

### Definition of Done
✓ All numeric radius literals eliminated
✓ 100% token-driven corner radius system
✓ No layout drift introduced
✓ No modifier reordering
✓ Shadow integrity preserved
✓ Design system authority enforced
✓ CI guard in place

### Enforcement Rule (Going Forward)
**Numeric `.cornerRadius()` usage is forbidden.**
All corner radius values must come from `DesignTokens.Radius`.

Violations will fail CI and must be corrected before merge.

---
