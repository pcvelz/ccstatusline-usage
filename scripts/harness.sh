#!/bin/bash
# harness.sh - empirical ccstatusline vs llama-swap slot check
#
# Usage: bash scripts/harness.sh <tmux-session-or-pane> [--seconds N] [--interval S]
#
# For N seconds (default 20) it captures the ccstatusline block from the tmux
# pane every S seconds (default 2) and, in the same tick, reads llama-swap's
# /api/events inflight snapshot joined to /api/slots for the pane's session.
# Each row prints both sides and MATCH / MISMATCH; the summary lists the slot
# phases that were actually observed (PARKED, PREFILL, DECODE, NONE).
#
# Exit 0 = every tick matched, 1 = at least one mismatch, 2 = bad usage.
# The rows are the evidence: quote them, do not paraphrase them.
#
# Env: LLAMA_SWAP_BASE (default http://127.0.0.1:8001)

set -uo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <tmux-session-or-pane> [--seconds N] [--interval S]" >&2
  exit 2
fi

TARGET="$1"
shift

if ! tmux has-session -t "$TARGET" 2>/dev/null && ! tmux display -p -t "$TARGET" '' >/dev/null 2>&1; then
  echo "ERROR: tmux target '$TARGET' not found" >&2
  exit 2
fi

HARNESS_TMUX="$TARGET" exec python3 "$(dirname "$0")/harness-poll.py" "$@"
