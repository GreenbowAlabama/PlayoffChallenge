# Operational Runbook: Payout Transfer Stuck in Retryable State

## 1. Summary

### Failure condition
One or more payout transfers remain in retryable longer than the stuck threshold (default: 30 minutes), indicating the payout scheduler is not clearing retryable transfers as expected.

### Risk level
High

### Impact
Users do not receive winnings. Contest payout completion is delayed.

### When to execute
- Alert or manual check indicates retryable transfers older than 30 minutes
- Reports of missing payouts after contest completion
- Admin-directed intervention

---

## 2. Preconditions

### Required access
- Admin bearer token (JWT) for admin endpoints
- Network access to the backend API

### Constraints
- No direct DB access
- Use API endpoints only
- Do not invent new endpoints or perform manual SQL

### Environment variables used in this runbook

Set these in your terminal before running steps:

```bash
export API_BASE_URL="https://<your-api-host>"
export ADMIN_TOKEN="<admin-jwt>"
```

---

## 3. Step 1: Start audit record

### Purpose
Create a runbook execution record so every action is auditable.

### Command

```bash
curl -sS -X POST "$API_BASE_URL/api/admin/runbooks/start" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"runbook_name\": \"payout_transfer_stuck_in_retryable\",
    \"runbook_version\": \"1.0.0\",
    \"executed_by\": \"<ops-identifier>\",
    \"system_state_before\": {
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
      \"stuck_threshold_minutes\": 30,
      \"trigger\": \"<alert|user_report|manual_check>\"
    }
  }"
```

### Expected response fields
- `execution_id` (save it, used in Step 5)
- `timestamp`

---

## 4. Step 2: Diagnosis

### Purpose
Confirm how many transfers are retryable and identify which are stuck, using payout diagnostics.

### Command (default stuck threshold 30 minutes)

```bash
curl -sS -X GET "$API_BASE_URL/api/admin/diagnostics/payouts?stuck_minutes=30" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### What to look at in the response

#### `summary`
Status counts grouped by `payout_transfers.status`. Expect keys like `pending`, `retryable`, `completed`, `failed_terminal` depending on what exists in the system right now.

#### `stuck_transfers`
Array of up to 25 retryable transfers older than the threshold. Each item includes:
- `id`
- `contest_id`
- `payout_job_id`
- `attempt_count`
- `max_attempts`
- `failure_reason` (may be null)
- `minutes_in_retryable`

#### Scheduler visibility
The response includes `scheduler`. Treat this as informational only. Do not assume it contains any specific fields. Presence or absence does not block recovery. Your source of truth is stuck transfers and the scheduler run endpoint response.

### Decision point
If `stuck_transfers.length` is 0, stop here and complete the runbook as `completed` with result "no stuck transfers found".

---

## 5. Step 3: Recovery

### Goal
Run the payout scheduler now to clear retryable transfers, without DB access.

### Command

```bash
curl -sS -X POST "$API_BASE_URL/api/admin/diagnostics/run-payout-scheduler" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}"
```

### What to capture from the response
Record these fields into your runbook completion payload:
- top-level `success`
- the full `result` object (as returned)
- any error message fields if `success` is false

If this endpoint returns HTTP 500, treat as an immediate escalation condition.

---

## 6. Step 4: Verification

### Goal
Verify stuck transfers reduced after scheduler run.

### Wait

```bash
sleep 120
```

Then re-run payout diagnostics:

```bash
curl -sS -X GET "$API_BASE_URL/api/admin/diagnostics/payouts?stuck_minutes=30" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Success criteria
- `stuck_transfers.length` decreased to 0, or materially decreased relative to Step 2
- `summary.retryable` decreased or stayed stable while `stuck_transfers` decreases

### Failure indicators
- `stuck_transfers.length` unchanged after the scheduler run and 120 second wait
- Scheduler run endpoint returned `success: false`
- Admin endpoints return 500 or 503

If failure indicators occur, proceed to Step 5 with status `partial` or `failed` and escalate.

---

## 7. Step 5: Complete audit record

### Purpose
Close the audit trail for this runbook execution.

### Command (completed)

Capture scheduler result, then complete with safe JSON construction:

```bash
SCHEDULER_RESULT=$(curl -sS -X POST "$API_BASE_URL/api/admin/diagnostics/run-payout-scheduler" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}")

curl -sS -X POST "$API_BASE_URL/api/admin/runbooks/complete" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg exec_id "<execution-id-from-step-1>" \
    --argjson scheduler "$SCHEDULER_RESULT" \
    '{
      execution_id: $exec_id,
      status: "completed",
      result_json: {
        scheduler_triggered: true,
        scheduler_response: $scheduler,
        verification: {
          timestamp: (now | todateiso8601),
          stuck_threshold_minutes: 30,
          stuck_transfers_remaining: 0
        }
      },
      system_state_after: {
        timestamp: (now | todateiso8601),
        stuck_transfers_remaining: 0
      }
    }')"
```

### Command (partial)

```bash
SCHEDULER_RESULT=$(curl -sS -X POST "$API_BASE_URL/api/admin/diagnostics/run-payout-scheduler" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}")

curl -sS -X POST "$API_BASE_URL/api/admin/runbooks/complete" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg exec_id "<execution-id-from-step-1>" \
    --argjson scheduler "$SCHEDULER_RESULT" \
    '{
      execution_id: $exec_id,
      status: "partial",
      error_reason: "stuck_transfers_not_clearing_after_scheduler_run",
      result_json: {
        scheduler_triggered: true,
        scheduler_response: $scheduler,
        verification: {
          timestamp: (now | todateiso8601),
          stuck_threshold_minutes: 30,
          stuck_transfers_remaining: 3
        }
      },
      system_state_after: {
        timestamp: (now | todateiso8601),
        stuck_transfers_remaining: 3,
        next_action: "escalate"
      }
    }')"
```

### Expected response
- `success: true`
- `timestamp`

---

## 8. Escalation conditions

Escalate immediately if any of the following are true:

1. `POST /api/admin/diagnostics/run-payout-scheduler` returns HTTP 500 or `success: false`
2. After 120 seconds, `stuck_transfers.length` is unchanged from Step 2
3. Admin endpoints return HTTP 500 or 503
4. Transfers show `attempt_count >= max_attempts` and remain stuck (cannot be recovered by retrying)

### Escalation payload to provide to engineering
- `execution_id`
- Full JSON from:
  - Step 2 diagnostics response
  - Step 3 scheduler run response
  - Step 4 diagnostics response

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02-16 | Initial release |
