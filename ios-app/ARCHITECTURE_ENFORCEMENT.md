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

## Phase 6C — Spacing & Padding Normalization (CLOSED)

### Summary
Complete migration of all numeric spacing and padding literals to centralized design tokens. Established second enforcement guard to prevent regression of spacing standardization.

### Migration Details
- **Total instances migrated:** 85+ spacing and padding normalizations
- **Files modified:** 19 Views across core views, helpers, utilities, and components
- **Token compliance:** 100% of mapped spacing values (4,6,8,12,16,20,24) now use `DesignTokens.Spacing`
- **Padding compliance:** 100% of `.padding()` directional calls use token values

### Token Mapping
| Token | Value | Usage |
|-------|-------|-------|
| `DesignTokens.Spacing.xxs` | 4 | Extra-tight spacing (23 usages) |
| `DesignTokens.Spacing.xs` | 6 | Tight spacing (8 usages) |
| `DesignTokens.Spacing.sm` | 8 | Small spacing (11 usages) |
| `DesignTokens.Spacing.md` | 12 | Medium spacing (20 usages) |
| `DesignTokens.Spacing.lg` | 16 | Large spacing (17 usages) |
| `DesignTokens.Spacing.xl` | 20 | Extra-large spacing (13 usages) |
| `DesignTokens.Spacing.xxl` | 24 | Double extra-large spacing (1 usage) |

### Intentional Exceptions (Documented)
- **spacing: 0** (9 usages) — Stacked layouts where no separation is needed
- **spacing: 2** (8 usages) — Tightly grouped items (not tokenized)
- **spacing: 3** (3 usages) — Custom interior spacing for specific components
- **spacing: 10** (3 usages) — Non-standard context-specific spacing
- **spacing: 15** (4 usages) — Non-standard context-specific spacing
- **spacing: 30** (2 usages) — Section breaks (larger than xxl, not in standard token set)

These exceptions are allowed because they are context-specific and do not fit standard spacing intervals.

### Enforcement
- **CI Guard:** `ios-app/scripts/enforce-spacing-tokens.sh`
- **Trigger:** Detects numeric literals in `spacing:` and `.padding()` calls
- **Scope:** Blocks mapped values (4,6,8,12,16,20,24) unless using `DesignTokens.Spacing`
- **Exceptions:** Allows 0,2,3,10,15,30 as documented context-specific values
- **Failure mode:** CI exits with error on violation

### Definition of Done
✓ All numeric spacing/padding literals eliminated (mapped values)
✓ 100% token-driven spacing system
✓ No layout drift introduced
✓ No modifier reordering
✓ No spacing degradation in compact views
✓ Design system authority enforced
✓ CI guard in place

### Enforcement Rule (Going Forward)
**Numeric spacing/padding usage for standardized values is forbidden.**
All mapped spacing values (4,6,8,12,16,20,24) must come from `DesignTokens.Spacing`.

Exception values (0,2,3,10,15,30) are allowed for documented context-specific spacing only.

Violations of mapped values will fail CI and must be corrected before merge.

---
