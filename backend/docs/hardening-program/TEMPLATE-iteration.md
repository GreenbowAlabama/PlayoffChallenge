# Iteration X – [Title]

## Objective

[1-2 sentences describing what this iteration will achieve]

[Specific goals and success criteria for this iteration]

---

## Architectural Constraints

[Explicit constraints that govern this iteration]

[What this iteration does NOT do]

[Scope boundaries]

---

## SOLID Enforcement

### Single Responsibility Boundaries
[List each service and its single responsibility]

[Cross-reference to service-level CLAUDE.md files]

### Explicit Interfaces
[Define function signatures and contracts for key services]

[Input and output types; no implicit behavior]

### No Hidden Coupling
[Document how services remain independent]

[Dependency direction is explicit and acyclic]

### Dependency Direction
[ASCII diagram showing dependency flow]

---

## Data Model Impact

### Schema Changes Required
[List all table/field additions]

[SQL snippets or descriptions]

### Critical Constraints
[Immutability rules; uniqueness constraints; state rules]

---

## Contract Impact

### Breaking Changes
[Document breaking changes, if any]

[Versioning strategy for breaking changes]

### New Contracts
[List new API endpoints or service interfaces]

[Request/response schemas]

---

## Validation Rules

### [Category] Validation
[List validation rules and their enforcement]

[Silent failures are explicitly forbidden]

---

## Determinism Guarantees

### Is Output Reproducible?
[Answer: Can identical inputs always produce identical outputs?]

### Settlement Replay Safety
[Answer: Can settlement be replayed from the same input data to produce identical results?]

### External State Dependencies
[Answer: Are there time-based or external state dependencies that could make results non-deterministic? If yes, document them and justify why they are acceptable.]

**Mandatory for all iterations**: Operations that affect scoring or financial state must be deterministic and replay-safe.

---

## Idempotency and Side-Effect Review

**All state-mutating operations must be idempotent and side-effect-isolated.**

### Does this iteration introduce state mutation?
[Answer: What state is being mutated (DB writes, file changes, external calls)?]

### Are idempotency keys required?
[Answer: What operations need idempotency? How are duplicate requests detected and handled?]

### Are retries bounded and explicit?
[Answer: If retries are implemented, how many attempts? What errors trigger retries? What errors are NOT retried?]

### Are external calls timeout-controlled?
[Answer: Do all external API calls have timeouts? What is the timeout value? What happens on timeout?]

### Are all side effects isolated from pure computation?
[Answer: Are state-changing operations (emails, webhooks, DB writes) separated from pure logic (computation, scoring, validation)? Can pure functions be tested in isolation?]

**Mandatory for all iterations**: This section must be answered before iteration closure. Side effects discovered during implementation must be documented and justified.

---

## Failure Modes

### [Failure Category]
[Description of failure mode]

[How it is detected]

[How it is recovered]

[How recovery is verified]

---

## Unit Test Requirements

### [Test Category]
[List specific unit tests required]

[Test inputs and expected outputs]

[Edge cases and failure scenarios]

---

## Completion Criteria

✓ [Criterion 1]
✓ [Criterion 2]
✓ [Criterion 3]
✓ Schema snapshot is updated and committed
✓ No undocumented assumptions remain

---

## Lessons Learned

*To be completed upon iteration closure*

### What Worked
(Document successes)

### What Was Harder Than Expected
(Document surprises)

### Assumptions We Purged
(Document implicit behaviors we discovered and removed)

### Decisions For Next Iteration
(Document architectural choices that affect later iterations)

---

## Next Steps

Once this iteration closes:
[What the next iteration depends on from this one]

[Handoff notes for next team]
