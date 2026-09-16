# Harness — Tmux Status Line Capture

This directory contains utility scripts for extracting and analyzing ccstatusline output from running tmux sessions.

## Quick Start

```bash
# Capture both lines from a session
bash scripts/capture-status.sh <session-name>

# Capture only the model line (M:, S:, R:)
bash scripts/capture-status.sh <session-name> 1

# Capture only the context/slot/state line
bash scripts/capture-status.sh <session-name> 2
```

## Scripts

### `capture-status.sh`

Extracts the ccstatusline status block from a tmux pane.

**How it works:**
1. Runs `tmux capture-pane -t <session>` to grab the visible content
2. Takes the last 8 lines (where the prompt + status line live)
3. Uses awk to find the first line matching `^  M:` (Model widget) followed by a non-blank, non-separator, non-prompt line
4. Outputs the 2-line status block

**Output format:**
```
  M: <model> | S: <session-id> | R: <resource>
  Context: [<bar>] <used>/<total> (<pct>%) | State: <state>
```

Line 2 may vary — it can show `Slot:`, `Throughput:`, or other widgets depending on the session's configuration.

### Usage in automation

For programmatic access, parse line 1 for model/session/resource and line 2 for context/slot metrics:

```bash
# Extract just the session ID (8-char hex after "S:")
ID=$(bash scripts/capture-status.sh master-template 1 | grep -o 'S: [a-f0-9]\{8\}' | awk '{print $2}')

# Extract context percentage
PCT=$(bash scripts/capture-status.sh master-template 2 | grep -o '([0-9]%)\)' | tr -d '()')

# Extract model name
MODEL=$(bash scripts/capture-status.sh master-template 1 | sed 's/  M: //;s/ |.*//')
```

## Limitations

- Requires `tmux` to be running with the target session active
- The `M:` pattern assumes the Model widget is present and renders first — true for all default ccstatusline configurations
- Does not parse Powerline arrow separators or custom widget output formats
