#!/bin/bash
# capture-status.sh — Extract ccstatusline status lines from tmux panes
# Usage: bash capture-status.sh <session-name> [1|2|all]
#
# Strategy: grab the last 8 lines of the pane, find the 2-line block
# where line 1 starts with "M:" and line 2 is a widget line (not blank/separator/prompt).
# This avoids picking up chat messages from scrollback.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <tmux-session> [1|2|all]" >&2
  exit 1
fi

SESSION="$1"
LINE_NUM="${2:-all}"

STATUS=$(tmux capture-pane -t "$SESSION" -p | tail -8 | awk '
  /^  M:/ { found=1; mline=$0; next }
  found && !/^$/ && !/^─/ && !/^❯/ {
    print mline
    print $0
    exit
  }
  /^  M:/ && found { mline=$0 }
')

if [ -z "$STATUS" ]; then
  echo "ERROR: No ccstatusline status line found in session '$SESSION'" >&2
  exit 1
fi

LINE_COUNT=$(echo "$STATUS" | wc -l | tr -d ' ')

case "$LINE_NUM" in
  1)
    echo "$STATUS" | head -n 1
    ;;
  2)
    if [ "$LINE_COUNT" -ge 2 ]; then
      echo "$STATUS" | tail -n 1
    else
      echo "(no second line)"
    fi
    ;;
  all|*)
    echo "$STATUS"
    ;;
esac
