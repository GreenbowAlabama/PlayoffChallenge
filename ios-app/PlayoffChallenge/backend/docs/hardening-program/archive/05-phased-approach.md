PHASE 5A — Schema & Contracts Only

Goal:
Lock the data model and invariants.

Deliverables:
	•	payout_transfers table
	•	payout_jobs table
	•	all uniqueness constraints
	•	immutability enforcement
	•	DB snapshot updated
	•	Iteration 05 md updated to reflect final schema

NO Stripe calls.
NO job runner.
NO orchestration.

Closure Ritual:
	•	All schema tests pass
	•	Schema snapshot committed
	•	DECISION-LOG updated
	•	You write “Iteration 05A CLOSED” in commit message

This gives you a clean, hard boundary.
Your nervous system can relax because invariants are locked.

⸻

PHASE 5B — Pure Orchestration (No External Side Effects)

Goal:
Schedule payout jobs from settlement.

Deliverables:
	•	schedulePayoutJob
	•	idempotent settlement hook
	•	payout_transfer rows created
	•	job rows created

Stripe adapter still stubbed.
No external money movement.

Closure Ritual:
	•	Concurrency test with 10 settlement_complete events
	•	Exactly 1 payout_job created
	•	Correct payout_transfer rows
	•	All idempotency tests pass

Commit:
“Iteration 05B CLOSED — deterministic orchestration”

You now feel accomplishment because the system moves forward without money risk.

⸻

PHASE 5C — Stripe Adapter + Execution Idempotency

Goal:
Implement Stripe transfer path with full idempotency guarantees.

Deliverables:
	•	StripePayoutAdapter
	•	executePayout
	•	idempotency keys enforced
	•	retry rules correct
	•	ledger entries created

Closure Ritual:
	•	Double execution produces single Stripe transfer
	•	Replay of worker produces zero new transfers
	•	Failure scenario correctly marks failed and logs ledger entry

Commit:
“Iteration 05C CLOSED — money movement idempotent”

At this point, payments technically work.

But we still have not introduced background workers.

⸻

PHASE 5D — Durable Job System + Autonomy

Goal:
Replace any naive scheduler with production-grade queue.

Deliverables:
	•	BullMQ (or equivalent)
	•	settlement event enqueues job
	•	worker processes safely
	•	restart safe
	•	retry safe

Closure Ritual:
	•	Kill worker mid-run
	•	Restart
	•	Job resumes correctly
	•	No duplicate transfers

Commit:
“Iteration 05D CLOSED — autonomous payout engine”
