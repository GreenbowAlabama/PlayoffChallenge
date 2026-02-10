# GAP-04: Time Invariant Enforcement

---

## 1. Purpose

This document explains the implementation of GAP-04: Time Invariant Enforcement for Contest Infrastructure v1. The core objective was to ensure that specific time-based invariants are rigorously enforced on every contest write operation, preventing the creation or modification of contests with incoherent time windows.

---

## 2. High-level design

Time invariant enforcement is implemented within the backend domain layer to ensure consistency and prevent invalid states at the earliest possible point in the data flow. A single-responsibility validation helper is utilized, which is invoked by relevant service methods responsible for creating or updating contest time fields. This design centralizes validation logic, adheres to SOLID principles, and prevents duplication across services. Validation occurs before any database write, and invalid operations fail loudly with clear error messages.

---

## 3. File responsibilities

### `services/helpers/timeInvariantValidator.js`

This file contains the `validateContestTimeInvariants` function, a pure function responsible solely for checking the logical consistency of contest time fields. It accepts an `existing` contest object (representing the current state from the database) and an `updates` object (representing proposed changes). It merges these two to form an "effective state" and validates the following invariants:
- `created_at < lock_time` (if both are present)
- `lock_time <= start_time` (if both are present)
- `start_time < end_time` (if both are present)
- `end_time <= settle_time` (if both are present)

Any violation results in an immediate error throw, aborting the write operation. This validator does not generate `created_at`; it relies on database-authoritative values for existing records.

### `services/customContestService.js`

The `createContestInstance` function in this service is responsible for the initial creation of contest instances. Before inserting a new record into the `contest_instances` table, it collects the proposed time fields (`lock_time`, `start_time`, `end_time`, `settle_time`) from the input and passes them, along with an empty `existing` object, to `validateContestTimeInvariants`. This ensures that newly created contests adhere to the time invariants from inception.

### `services/adminContestService.js`

The `updateLockTime` function within this service allows administrators to modify a contest's `lock_time`. To ensure invariant enforcement during such updates, the function first fetches the complete existing contest record using `SELECT * FROM contest_instances WHERE id = $1 FOR UPDATE`. This row-level lock prevents race conditions. The fetched `existing` contest object and the proposed `lock_time` update are then passed to `validateContestTimeInvariants` before the database update proceeds. This ensures that admin actions also respect the defined time invariants.

---

## 4. Edge cases handled

-   **Partial Updates:** The `validateContestTimeInvariants` function is designed to handle partial updates gracefully by merging existing and proposed fields to form an effective state for validation.
-   **`created_at` for New Records:** `created_at` is a database-managed field. For new contest creations (`createContestInstance`), the `existing` object passed to the validator is empty, thus the `created_at < lock_time` invariant is implicitly satisfied by the database setting `created_at` on insert (which will always be prior to any valid `lock_time` provided).
-   **Nullable Time Fields:** Invariants are only applied when the relevant time fields are explicitly present (non-null). This supports scenarios where certain time fields might not be required or set at every stage of a contest's lifecycle.
-   **Atomicity of Admin Updates:** For `updateLockTime`, `SELECT ... FOR UPDATE` is used to acquire a row-level lock, preventing concurrent modifications during the read-validate-write cycle and ensuring atomicity.

---

## 5. Explicit non-goals

-   This documentation does not restate the complete Contest Lifecycle Contract or describe any gaps other than GAP-04.
-   It does not propose new features, define future roadmap items, or speculate on unrelated functionalities.
-   It does not include database schema changes or migration strategies, as these were addressed in prior gaps (GAP-01, GAP-02, GAP-03).

---

## 6. Guidance for future extensions

-   Any new service methods or API endpoints introduced in the future that can modify `lock_time`, `start_time`, `end_time`, or `settle_time` must invoke `validateContestTimeInvariants` with the appropriate `existing` and `updates` payloads before performing database writes.
-   Automated lifecycle transition mechanisms (e.g., cron jobs, event handlers) that update time fields must also integrate this validator to maintain data integrity.
-   If new time-related invariants are introduced, they should be added to the `validateContestTimeInvariants` function to centralize validation logic.
