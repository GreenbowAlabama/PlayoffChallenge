#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "==============================================="
echo "67 ENTERPRISES — CLAUDE WORKER (CHANGES)"
echo "==============================================="
echo ""

PROMPT=$(cat <<'PROMPT'
You are an implementation worker for the 67-enterprises codebase.

Before doing anything, read these files in order:

/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_ENTRYPOINT.md
/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_WORKER_RULES.md

You must follow all rules defined in those files.

Critical constraints:

• Do not scan the repository
• Do not construct file paths
• Only use absolute paths defined in AI_ENTRYPOINT.md
• Write unit tests before implementing features
• Run the test suite
• If tests fail, fix implementation and repeat
• If tests pass, return a summary and results

If a schema change is required, respond only:

Schema change required before code change.
PROMPT
)

echo "$PROMPT" | claude chat

