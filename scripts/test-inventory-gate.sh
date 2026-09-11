#!/usr/bin/env bash
# Battle-proven test regression gate.
#
# The test suite is this project's single source of truth. A release must never
# silently drop or rename tests that shipped with a previous release: upstream
# merges and refactors have done exactly that in the past, and a green suite
# proves nothing if the assertions that used to protect a behavior are gone.
#
# This gate diffs the test inventory between the last release tag (or an
# explicit base ref) and a target ref (default HEAD). Two things block:
#
#   1. A test (file + title) present at the base but absent at the target whose
#      title is not listed as `title` (backticked) in docs/test-retirements.md.
#   2. A test file whose expect() count went DOWN, unless the file path is
#      listed as `path` (backticked) in the ledger with a reason. This catches
#      assertions deleted from a test that kept its title.
#
# Titles are collected from it()/test() in any quote style (including
# .skip/.only/.concurrent modifiers) and from it.each(...)('template') titles,
# single-line or closing a multi-line table (`])('$name ...'`).
#
# The ledger is read from the target ref, so the justification must be part of
# the commit being verified (not just sitting in the working tree).
#
# Usage:
#   bash scripts/test-inventory-gate.sh                   # base = last fork release tag, target = HEAD
#   bash scripts/test-inventory-gate.sh v2.4.10           # explicit base ref
#   bash scripts/test-inventory-gate.sh v2.4.10 <rev>     # explicit base and target
#
# Exit codes: 0 = clean (or all disappearances justified), 1 = unexplained
# disappearances, 2 = usage/environment error.
set -euo pipefail
export LC_ALL=C   # sort, comm and join must agree on collation

cd "$(git rev-parse --show-toplevel)"

TARGET_REF="${2:-HEAD}"
if [[ -n "${1:-}" ]]; then
    BASE_REF="$1"
else
    # Never `git describe --tags` here: it can resolve to an upstream tag after a
    # merge. last-release-tag.sh only accepts fork release tags.
    BASE_REF=$(bash scripts/last-release-tag.sh "$TARGET_REF") || exit 2
fi
git rev-parse -q --verify "$BASE_REF^{commit}" >/dev/null || { echo "test-inventory-gate: unknown base ref $BASE_REF" >&2; exit 2; }
git rev-parse -q --verify "$TARGET_REF^{commit}" >/dev/null || { echo "test-inventory-gate: unknown target ref $TARGET_REF" >&2; exit 2; }

RETIREMENTS_FILE="docs/test-retirements.md"
LEDGER=$(git show "$TARGET_REF:$RETIREMENTS_FILE" 2>/dev/null || true)

# git grep -o prints "<rev>:<path>:<match>". Quoted title in any of the three
# quote styles; the title itself cannot contain its own quote character.
QUOTED="('[^']+'|\"[^\"]+\"|\`[^\`]+\`)"
TITLE_PATTERN="(^|[^A-Za-z0-9_\$.])(it|test)(\\.[a-z]+)*\\($QUOTED|\\.each\\([^)]*\\)\\($QUOTED|^[[:space:]]*[]}]\\)\\($QUOTED"

strip_rev() {
    awk -v p="$1:" 'index($0, p) == 1 { $0 = substr($0, length(p) + 1) } { print }'
}

inventory() {
    # Emits "<path>\t<title>" per test.
    git grep -I -oE "$TITLE_PATTERN" "$1" -- '*.test.ts' '*.test.tsx' 2>/dev/null \
        | strip_rev "$1" \
        | awk '{
            i = index($0, ":"); path = substr($0, 1, i - 1); m = substr($0, i + 1)
            sub(/^.*\([\047"`]/, "", m); sub(/[\047"`]$/, "", m)
            print path "\t" m
        }' \
        | sort -u
}

expect_counts() {
    # Emits "<path>\t<expect() count>" per test file, sorted on the path for join.
    git grep -c 'expect(' "$1" -- '*.test.ts' '*.test.tsx' 2>/dev/null \
        | strip_rev "$1" \
        | awk '{ i = index($0, ":"); print substr($0, 1, i - 1) "\t" substr($0, i + 1) }' \
        | sort -t $'\t' -k1,1
}

in_ledger() {
    [[ -n "$LEDGER" ]] && grep -qF -- "\`$1\`" <<< "$LEDGER"
}

BASE_LIST=$(inventory "$BASE_REF")
TARGET_LIST=$(inventory "$TARGET_REF")
MISSING=$(comm -23 <(printf '%s\n' "$BASE_LIST") <(printf '%s\n' "$TARGET_LIST"))
BASE_COUNT=$(printf '%s\n' "$BASE_LIST" | grep -c . || true)
TARGET_COUNT=$(printf '%s\n' "$TARGET_LIST" | grep -c . || true)

echo "test-inventory-gate: base=$BASE_REF ($BASE_COUNT tests) target=$TARGET_REF ($TARGET_COUNT tests)"

UNEXPLAINED=0
while IFS=$'\t' read -r path name; do
    [[ -z "$name" ]] && continue
    if in_ledger "$name"; then
        echo "justified: $path :: $name"
    else
        echo "UNEXPLAINED: $path :: $name"
        UNEXPLAINED=1
    fi
done <<< "$MISSING"

REDUCED=$(join -t $'\t' <(expect_counts "$BASE_REF") <(expect_counts "$TARGET_REF") | awk -F'\t' '$3 < $2')
while IFS=$'\t' read -r path before after; do
    [[ -z "$path" ]] && continue
    if in_ledger "$path"; then
        echo "justified: $path :: expect() count $before -> $after"
    else
        echo "UNEXPLAINED: $path :: expect() count $before -> $after (assertions removed from surviving tests)"
        UNEXPLAINED=1
    fi
done <<< "$REDUCED"

if [[ "$UNEXPLAINED" -eq 1 ]]; then
    echo "" >&2
    echo "BLOCKED: coverage that shipped with $BASE_REF is gone and not justified." >&2
    echo "For each UNEXPLAINED line: restore the test/assertions (default), or add a" >&2
    echo "backticked entry - \`title\` or \`path\` - with a per-test reason to" >&2
    echo "$RETIREMENTS_FILE and include it in the commit being verified." >&2
    exit 1
fi

if [[ -z "$MISSING" && -z "$REDUCED" ]]; then
    echo "OK: no tests or assertions from $BASE_REF are missing at $TARGET_REF"
else
    echo "OK: all disappearances are justified in $RETIREMENTS_FILE"
fi
exit 0
