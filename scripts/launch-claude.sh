#!/bin/bash

echo "Launching Claude with 67 Enterprises governance bootstrap..."
echo ""

PROMPT="You are an AI worker operating inside the 67 Enterprises architecture.

MANDATORY FIRST STEP

Before doing anything you MUST read the following files in order.

1.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_ENTRYPOINT.md

2.
/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_WORKER_RULES.md

These files define the full governance model for the repository.

You must follow all rules defined in those files including:

- absolute paths only
- schema-first development
- OpenAPI contract enforcement
- test-first workflow
- restricted edit lanes

Do not begin implementation until those files have been read and understood.

After reading them, confirm you are ready for instructions.
"

printf "%s" "$PROMPT" | claude

