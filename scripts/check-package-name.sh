#!/usr/bin/env bash
# Flags upstream package-name references in tracked code.
#
# The fork publishes ccstatusline-usage. Upstream code that names the package
# `ccstatusline` - npm registry URLs, node_modules paths, global install or
# uninstall argv, pkg@version specifiers - silently targets upstream's package
# instead of ours. ed3ce5b shipped three such sites past the old `ccstatusline[@]`-
# only check, so this gate matches every form, not just the pkg@version one.
# The pattern does not match the binary name, ~/.cache or ~/.config paths,
# ccstatusline-usage, or prose.
#
# Usage:
#   bash scripts/check-package-name.sh [REV]       # scan tracked files at REV (default HEAD)
#   bash scripts/check-package-name.sh --worktree  # scan the working tree instead
#
# Exit codes: 0 = no hits, 1 = upstream package name found, 2 = usage/git error.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PATTERN="ccstatusline[@]|(npmjs\\.(org|com)/(package/)?|node_modules[/\\\\]|(install|add|remove|uninstall|rm) (-g |--global )|-g[\"', ]+)ccstatusline([^-A-Za-z0-9_.]|\$)"
PATHS=(. ':!**/__tests__/**' ':!*.test.*' ':!scripts/check-package-name.sh')

RC=0
if [[ "${1:-}" == "--worktree" ]]; then
    HITS=$(git grep -nEI "$PATTERN" -- "${PATHS[@]}") || RC=$?
else
    REV="${1:-HEAD}"
    HITS=$(git grep -nEI "$PATTERN" "$REV" -- "${PATHS[@]}") || RC=$?
fi

if (( RC > 1 )); then
    echo "check-package-name: git grep failed (exit $RC)" >&2
    exit 2
fi

if [[ -z "$HITS" ]]; then
    echo "OK: no upstream package-name references"
    exit 0
fi

echo "BLOCKED: upstream package name used where the fork's package is meant:"
sed 's/^/    /' <<< "$HITS"
exit 1
