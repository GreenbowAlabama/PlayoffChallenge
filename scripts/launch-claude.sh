#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo
echo "🔒 Governance Reminder"
echo "Before coding, run:"
echo
echo "Read /docs"
echo "Read /docs/governance"
echo "Summarize constraints in 10 lines or less."
echo "Do not write code yet."
echo

claude
