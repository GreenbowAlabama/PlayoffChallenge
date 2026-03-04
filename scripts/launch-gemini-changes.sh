#!/usr/bin/env bash
set -euo pipefail

ENTRYPOINT="/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_ENTRYPOINT.md"
RULES="/Users/iancarter/Documents/workspace/playoff-challenge/docs/ai/AI_WORKER_RULES.md"

echo ""
echo "==============================================="
echo "67 ENTERPRISES — GEMINI WORKER (CHANGES)"
echo "==============================================="
echo ""

echo "Loading AI context..."

PROMPT=$(cat <<PROMPT
You are a Gemini implementation worker for the 67-enterprises codebase.

Before performing any work you must read these files:

$ENTRYPOINT
$RULES

Follow the execution protocol defined in those files.

Do not scan the repository.
Do not construct paths.
Use only absolute paths defined in AI_ENTRYPOINT.md.

Follow this process strictly:

1. Read authoritative files
2. Write unit tests
3. Implement changes
4. Run tests
5. If tests fail, fix implementation and repeat
6. If tests pass, return summary and results
PROMPT
)

gemini chat "$PROMPT"

