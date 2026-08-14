#!/usr/bin/env bash
# Battle-proven test regression gate.
#
# The test suite is this project's single source of truth. A release must never
# silently drop or rename tests that shipped with a previous release: upstream
# merges and refactors have done exactly that in the past, and a green suite
# proves nothing if the assertions that used to protect a behavior are gone.
#
# This gate diffs the test-name inventory (every it()/test() title) between the
# last release tag (or an explicit base ref) and HEAD. Every test present at the
# base but absent at HEAD must be listed - with a reason - in
# docs/test-retirements.md. Anything unexplained blocks the release.
#
# Usage:
#   bash scripts/test-inventory-gate.sh            # base = last reachable tag
#   bash scripts/test-inventory-gate.sh v2.4.10    # explicit base ref
#
# Exit codes: 0 = clean (or all disappearances justified), 1 = unexplained
# disappearances, 2 = usage/environment error.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BASE_REF="${1:-$(git describe --tags --abbrev=0 HEAD 2>/dev/null || true)}"
if [[ -z "$BASE_REF" ]]; then
    echo "test-inventory-gate: no base tag found and none given" >&2
    exit 2
fi

RETIREMENTS_FILE="docs/test-retirements.md"

inventory() {
    # POSIX ERE only (git grep): no \s, no lazy quantifiers.
    git grep -h -oE "(it|test)\('[^']+'" "$1" -- '*.test.ts' '*.test.tsx' 2>/dev/null \
        | sed -E "s/^(it|test)\('//; s/'\$//" | sort -u
}

BASE_LIST=$(inventory "$BASE_REF")
HEAD_LIST=$(inventory HEAD)

MISSING=$(comm -23 <(printf '%s\n' "$BASE_LIST") <(printf '%s\n' "$HEAD_LIST"))
BASE_COUNT=$(printf '%s\n' "$BASE_LIST" | grep -c . || true)
HEAD_COUNT=$(printf '%s\n' "$HEAD_LIST" | grep -c . || true)

echo "test-inventory-gate: base=$BASE_REF ($BASE_COUNT tests) HEAD ($HEAD_COUNT tests)"

if [[ -z "$MISSING" ]]; then
    echo "OK: no tests from $BASE_REF are missing at HEAD"
    exit 0
fi

UNEXPLAINED=0
while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    if [[ -f "$RETIREMENTS_FILE" ]] && grep -qF "$name" "$RETIREMENTS_FILE"; then
        echo "justified: $name"
    else
        echo "UNEXPLAINED: $name"
        UNEXPLAINED=1
    fi
done <<< "$MISSING"

if [[ "$UNEXPLAINED" -eq 1 ]]; then
    echo "" >&2
    echo "BLOCKED: tests that shipped with $BASE_REF are gone and not justified." >&2
    echo "Either restore them, or add each name with a reason to $RETIREMENTS_FILE" >&2
    echo "(the justification is part of the release diff and gets reviewed)." >&2
    exit 1
fi

echo "OK: all disappearances are justified in $RETIREMENTS_FILE"
exit 0
