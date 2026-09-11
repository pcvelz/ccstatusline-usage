#!/usr/bin/env bash
# Mechanical gate for upstream-merge commits (release.md Step 1 and Step 4b).
#
# Turns the upstream-merge rules in release.md into a PASS/FAIL list, so the
# result doesn't depend on how carefully the merging agent read the checklist.
# A merge may contain only three things: upstream's changes, conflict
# resolutions, and compatibility fixes that are named in the commit body.
#
# Usage:
#   bash scripts/verify-upstream-merge.sh [<rev>]
#       Verify an existing merge commit (default HEAD).
#   bash scripts/verify-upstream-merge.sh --staged "<subject>" [<body-file>]
#       Verify an in-progress merge BEFORE committing it. Builds a throwaway
#       commit object from the index (git commit-tree, no ref is moved) with the
#       subject/body you are about to commit, then checks that object. Run it
#       again after every fix. The commit you make afterwards must use the same
#       subject and body.
#
# Exit codes: 0 = all checks pass, 1 = at least one FAIL, 2 = usage/environment error.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

FORK_PKG="ccstatusline-usage"
UPSTREAM_REF="${UPSTREAM_REF:-upstream/main}"
FAILS=0

# Read a blob into a variable before grepping it: `git show | grep -q` under
# pipefail reports "not found" when grep exits early and git show gets SIGPIPE.
blob() { git show "$1:$2" 2>/dev/null; }

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
detail() { echo "        $*"; }
die() { echo "verify-upstream-merge: $*" >&2; exit 2; }

git rev-parse -q --verify "$UPSTREAM_REF^{commit}" >/dev/null \
    || die "$UPSTREAM_REF not found (git remote add upstream https://github.com/sirmalloc/ccstatusline.git && git fetch upstream)"

# ---------------------------------------------------------------- target commit
if [[ "${1:-}" == "--staged" ]]; then
    SUBJECT="${2:-}"
    [[ -n "$SUBJECT" ]] || die "--staged needs the commit subject you are about to use"
    BODY=""
    if [[ -n "${3:-}" ]]; then
        [[ -f "$3" ]] || die "body file $3 not found"
        BODY=$(cat "$3")
    fi
    git rev-parse -q --verify MERGE_HEAD >/dev/null || die "no merge in progress (MERGE_HEAD missing)"
    UNMERGED=$(git diff --name-only --diff-filter=U)
    if [[ -n "$UNMERGED" ]]; then
        echo "FAIL  unresolved conflicts - resolve and 'git add <file>' each one:"
        sed 's/^/        /' <<< "$UNMERGED"
        exit 1
    fi
    UNSTAGED=$(git diff --name-only)
    if [[ -n "$UNSTAGED" ]]; then
        # What gets verified must be exactly what gets committed.
        echo "FAIL  unstaged edits exist - 'git add <file>' each one you intend to commit, or 'git restore <file>':"
        sed 's/^/        /' <<< "$UNSTAGED"
        exit 1
    fi
    TREE=$(git write-tree) || die "git write-tree failed"
    REV=$(printf '%s\n\n%s\n' "$SUBJECT" "$BODY" | git commit-tree "$TREE" -p HEAD -p MERGE_HEAD) \
        || die "git commit-tree failed"
    echo "verify-upstream-merge: staged merge (throwaway commit ${REV:0:12}, no ref moved)"
else
    REV=$(git rev-parse -q --verify "${1:-HEAD}^{commit}") || die "unknown rev ${1:-HEAD}"
    echo "verify-upstream-merge: commit ${REV:0:12}"
fi

# ---------------------------------------------------------------- 1. shape
PARENTS=$(git rev-list --parents -n 1 "$REV" | wc -w | tr -d ' ')
if [[ "$PARENTS" -ne 3 ]]; then
    fail "commit is not a two-parent merge (has $((PARENTS - 1)) parent(s))"
    echo "verify-upstream-merge: $FAILS check(s) failed"
    exit 1
fi
P1=$(git rev-parse "$REV^1")
P2=$(git rev-parse "$REV^2")
if git merge-base --is-ancestor "$P2" "$UPSTREAM_REF"; then
    pass "second parent ${P2:0:12} is upstream history"
else
    fail "second parent ${P2:0:12} is not in $UPSTREAM_REF - only merge upstream/main, never a local branch"
fi
P1_PKG=$(blob "$P1" package.json)
if grep -qE "\"name\": *\"$FORK_PKG\"" <<< "$P1_PKG"; then
    pass "first parent ${P1:0:12} is fork history"
else
    fail "first parent ${P1:0:12} is not $FORK_PKG - run the merge from main: 'git merge upstream/main'"
fi

# ---------------------------------------------------------------- 2. message
MSG=$(git log -1 --format=%B "$REV")
SUBJ=$(git log -1 --format=%s "$REV")
MERGE_BASE=$(git merge-base "$P1" "$P2")
N=$(git rev-list --count "$MERGE_BASE..$P2")
if [[ "$SUBJ" == "chore: merge upstream ($N commits)" || ( "$N" -eq 1 && "$SUBJ" == "chore: merge upstream (1 commit)" ) ]]; then
    pass "subject is 'chore: merge upstream ($N commits)'"
else
    fail "subject must be exactly 'chore: merge upstream ($N commits)' (git rev-list --count \$(git merge-base HEAD upstream/main)..upstream/main), got: $SUBJ"
fi
if grep -qE '\bv?[0-9]+\.[0-9]+\.[0-9]+\b' <<< "$MSG"; then
    fail "commit message contains a version number - versions belong in the release commit only"
    grep -nE '\bv?[0-9]+\.[0-9]+\.[0-9]+\b' <<< "$MSG" | sed 's/^/        /'
else
    pass "no version number in the commit message"
fi

# ---------------------------------------------------------------- 3. package.json
pkg_field() {
    git show "$1:package.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(String(JSON.parse(s)[process.argv[1]]??""))})' "$2"
}
NAME=$(pkg_field "$REV" name)
V_MERGE=$(pkg_field "$REV" version)
V_FORK=$(pkg_field "$P1" version)
[[ "$NAME" == "$FORK_PKG" ]] && pass "package.json name is $FORK_PKG" \
    || fail "package.json name is '$NAME' - keep \"name\": \"$FORK_PKG\" when resolving the conflict"
[[ "$V_MERGE" == "$V_FORK" ]] && pass "package.json version unchanged ($V_FORK)" \
    || fail "package.json version changed $V_FORK -> $V_MERGE - keep the fork's version; bumping happens in the release commit"

# ---------------------------------------------------------------- 4. conflict markers
CHANGED=()
while IFS= read -r path; do
    [[ -n "$path" ]] && CHANGED+=("$path")
done < <(git diff --name-only "$P1" "$REV")
MARKERS=""
if [[ ${#CHANGED[@]} -gt 0 ]]; then
    MARKERS=$(git grep -nIE '^(<<<<<<<|>>>>>>>)( |$)|^\|\|\|\|\|\|\| |^=======$' "$REV" -- "${CHANGED[@]}" 2>/dev/null || true)
fi
if [[ -n "$MARKERS" ]]; then
    fail "conflict markers left in the tree:"
    sed 's/^/        /' <<< "$MARKERS"
else
    pass "no conflict markers in changed files"
fi

# ---------------------------------------------------------------- 5. fork deletions
DELETED_LIST=$(git show "$REV:.fork-keep-deleted" 2>/dev/null | grep -vE '^[[:space:]]*(#|$)' || true)
RESURRECTED=""
while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    git cat-file -e "$REV:$path" 2>/dev/null && RESURRECTED+="$path"$'\n'
done <<< "$DELETED_LIST"
if [[ -n "$RESURRECTED" ]]; then
    fail "files listed in .fork-keep-deleted came back - run 'bash scripts/apply-fork-deletions.sh':"
    printf '%s' "$RESURRECTED" | sed 's/^/        /'
else
    pass ".fork-keep-deleted files stay deleted"
fi

# ---------------------------------------------------------------- 6. fork invariants
INV_FAIL=0
while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    path="${line%% *}"
    literal="${line#* }"
    if ! git cat-file -e "$REV:$path" 2>/dev/null; then
        [[ $INV_FAIL -eq 0 ]] && fail "fork customizations missing (.fork-invariants):"
        INV_FAIL=1
        detail "$path: file is gone"
    elif ! grep -qF -- "$literal" <<< "$(blob "$REV" "$path")"; then
        [[ $INV_FAIL -eq 0 ]] && fail "fork customizations missing (.fork-invariants):"
        INV_FAIL=1
        detail "$path: missing '$literal'"
    fi
done < <(git show "$REV:.fork-invariants" 2>/dev/null || git show "$P1:.fork-invariants" 2>/dev/null)
[[ $INV_FAIL -eq 0 ]] && pass "all .fork-invariants present"

# ---------------------------------------------------------------- 7. README history
LOST_ENTRIES=""
README_MERGE=$(blob "$REV" README.md)
while IFS= read -r heading; do
    [[ -z "$heading" ]] && continue
    grep -qxF -- "$heading" <<< "$README_MERGE" || LOST_ENTRIES+="$heading"$'\n'
done < <(blob "$P1" README.md | grep -E '^### \[v[0-9]')
if [[ -n "$LOST_ENTRIES" ]]; then
    fail "README 'Recent Updates' entries from the fork were removed or rewritten:"
    printf '%s' "$LOST_ENTRIES" | sed 's/^/        /'
else
    pass "all fork release entries in README survive"
fi

# ---------------------------------------------------------------- 8. added files
BODY_TEXT=$(git log -1 --format=%b "$REV")
named_in_body() { grep -qF -- "$1" <<< "$BODY_TEXT"; }
ALWAYS_OK="docs/test-retirements.md"
FOREIGN=""
while IFS= read -r path; do
    [[ -z "$path" || "$path" == "$ALWAYS_OK" ]] && continue
    git cat-file -e "$P2:$path" 2>/dev/null && continue
    named_in_body "$path" || FOREIGN+="$path"$'\n'
done < <(git diff --diff-filter=A --name-only "$P1" "$REV")
if [[ -n "$FOREIGN" ]]; then
    fail "files added by the merge that did not come from upstream (blanket 'git add'?). Remove them, or name each one in the commit body with the reason:"
    printf '%s' "$FOREIGN" | sed 's/^/        /'
else
    pass "every added file came from upstream"
fi

# ---------------------------------------------------------------- 9. edits outside conflicts
# --remerge-diff shows how the committed tree differs from git's own automatic
# merge. Conflicted files are expected to differ. A cleanly merged file that
# differs was edited by hand and must be explained.
REMERGE=$(git show --remerge-diff --format= "$REV")
REMERGE_FILES=$(sed -nE 's|^diff --git a/(.*) b/.*$|\1|p' <<< "$REMERGE" | sort -u)
CONFLICTED=$( { sed -nE 's/^remerge CONFLICT .*Merge conflict in (.*)$/\1/p' <<< "$REMERGE"
                sed -nE 's/^remerge CONFLICT \([^)]*\): ([^ ]+) .*$/\1/p' <<< "$REMERGE"; } | sort -u)
UNEXPLAINED_EDITS=""
while IFS= read -r path; do
    [[ -z "$path" || "$path" == "$ALWAYS_OK" ]] && continue
    grep -qxF -- "$path" <<< "$CONFLICTED" && continue
    grep -qxF -- "$path" <<< "$DELETED_LIST" && continue
    named_in_body "$path" || UNEXPLAINED_EDITS+="$path"$'\n'
done <<< "$REMERGE_FILES"
if [[ -n "$UNEXPLAINED_EDITS" ]]; then
    fail "hand edits to files that merged cleanly, not named in the commit body. Name each with its reason (e.g. 'src/utils/hooks.ts: fork-rename'), or revert the edit:"
    printf '%s' "$UNEXPLAINED_EDITS" | sed 's/^/        /'
else
    pass "hand edits are limited to conflicts, fork deletions, or files named in the body"
fi

# ---------------------------------------------------------------- 10. un-renamed package refs
# /fork-rename rewrites the upstream npm specifier (ccstatusline + "@version")
# to ccstatusline-usage + "@version". Every tracked file counts (upstream put
# one in remotion/ that a narrower scan missed). Tests may keep upstream strings
# on purpose (negative matches). The pattern uses [@] so this script doesn't
# match itself.
UNRENAMED=$(git grep -nE 'ccstatusline[@]' "$REV" -- . ':!**/__tests__/**' 2>/dev/null || true)
if [[ -n "$UNRENAMED" ]]; then
    fail "un-renamed upstream package specifier - run /fork-rename, then fix what it missed by hand:"
    sed 's/^/        /' <<< "$UNRENAMED"
else
    pass "no un-renamed upstream package specifier outside tests"
fi

# ---------------------------------------------------------------- 13. links to deleted files
# Upstream README/doc changes often link to docs the fork deletes
# (.fork-keep-deleted). Taking upstream's side of such a hunk leaves dead links.
DEAD_LINKS=""
while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    hits=$(git grep -nF -- "$path" "$REV" -- ':!.fork-keep-deleted' 2>/dev/null || true)
    [[ -n "$hits" ]] && DEAD_LINKS+="$hits"$'\n'
done <<< "$DELETED_LIST"
if [[ -n "$DEAD_LINKS" ]]; then
    fail "references to files the fork deletes (.fork-keep-deleted) - point them at the README section or remove them:"
    printf '%s' "$DEAD_LINKS" | sed 's/^/        /'
else
    pass "no references to .fork-keep-deleted files"
fi

# ---------------------------------------------------------------- 14. harness untouched
# The merge is graded by these files; a merge that edits them grades itself.
# If a gate is wrong, STOP and report it - harness fixes go in their own commit.
HARNESS_EDITS=$(git diff --name-only "$P1" "$REV" -- \
    scripts/verify-upstream-merge.sh scripts/test-inventory-gate.sh scripts/last-release-tag.sh \
    scripts/apply-fork-deletions.sh .fork-invariants .githooks)
if [[ -n "$HARNESS_EDITS" ]]; then
    fail "the merge edits the harness that grades it - revert these (git checkout HEAD -- <file>), report the gate problem instead:"
    sed 's/^/        /' <<< "$HARNESS_EDITS"
else
    pass "merge leaves the gate scripts, .fork-invariants and .githooks untouched"
fi

# ---------------------------------------------------------------- 11. test inventory
BASE_TAG=$(bash scripts/last-release-tag.sh "$P1" 2>&1)
if [[ $? -ne 0 ]]; then
    fail "cannot resolve the last release tag: $BASE_TAG"
else
    GATE_OUT=$(bash scripts/test-inventory-gate.sh "$BASE_TAG" "$REV" 2>&1)
    if [[ $? -eq 0 ]]; then
        pass "test inventory vs $BASE_TAG ($(head -1 <<< "$GATE_OUT" | sed -E 's/^test-inventory-gate: //'))"
    else
        fail "test inventory vs $BASE_TAG - tests or assertions disappeared without a ledger entry:"
        grep -E '^UNEXPLAINED' <<< "$GATE_OUT" | sed 's/^/        /'
    fi
fi

# ---------------------------------------------------------------- 12. local git config
TAGOPT=$(git config --get remote.upstream.tagOpt || true)
if [[ "$TAGOPT" == "--no-tags" ]]; then
    pass "remote.upstream.tagOpt is --no-tags"
else
    fail "upstream tags are fetched into the local tag namespace - run: git config remote.upstream.tagOpt --no-tags"
fi

echo ""
if [[ $FAILS -gt 0 ]]; then
    echo "verify-upstream-merge: $FAILS check(s) FAILED - fix each FAIL, then re-run. Do not push until this exits 0."
    exit 1
fi
echo "verify-upstream-merge: all checks passed"
echo "Still required (not mechanical): /fix-lint, /bun-tests, pipe-verify, Step 2b/2c judgment."
exit 0
