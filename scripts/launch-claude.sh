#!/usr/bin/env bash

set -e

PROJECT_ROOT="/Users/iancarter/Documents/workspace/playoff-challenge"

echo "Launching Claude with 67 Enterprises governance bootstrap..."

claude <<BOOTSTRAP

You are an AI worker operating inside the 67 Enterprises architecture.

BOOTSTRAP MODE

You must load the governance context exactly once.

Read the following files in order:

1.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_ENTRYPOINT.md

2.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_WORKER_RULES.md

After reading them:

1. Confirm governance context is loaded.
2. Set internal state:

GOVERNANCE_CONTEXT = LOADED

From this point forward:

- Governance rules remain active for the entire session
- Do NOT reread governance documents
- Do NOT re-run the bootstrap process
- Only reload governance if explicitly instructed with the phrase:

RELOAD GOVERNANCE

Worker operating rules:

- Absolute paths only
- Schema-first development
- OpenAPI contract enforcement
- Test-first workflow
- Restricted edit lanes
- No repository scanning unless required by the task

When tasks are provided later in this session:

- Assume governance context is already loaded
- Do NOT reread governance files
- Proceed directly to the task

After completing the bootstrap reads, confirm readiness and wait for instructions.

BOOTSTRAP
