#!/usr/bin/env bash
# Prints the last ccstatusline-usage release tag reachable from a commit.
#
# Plain `git describe --tags` is NOT safe in this fork: `git fetch upstream`
# auto-follows upstream's vX.Y.Z tags into the local tag namespace, and after an
# upstream merge those tags are reachable (via the merge's second parent) and
# often closer than our own. `git describe` then returns an upstream tag, and
# anything built on it - the test-inventory base, the release reset target -
# silently points at upstream's tree instead of our last release.
#
# This resolver walks the first-parent line only (fork history; upstream tags
# sit on second parents) and refuses any tag whose package.json is not the fork
# package.
#
# Usage:
#   bash scripts/last-release-tag.sh [<rev>]              # newest fork tag on <rev>'s first-parent line (default HEAD)
#   bash scripts/last-release-tag.sh --published [<rev>]  # tag of the version currently live on npm
#
# Exit codes: 0 = tag printed, 2 = no valid fork tag found / npm lookup failed.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

FORK_PKG="ccstatusline-usage"
MODE="first-parent"
if [[ "${1:-}" == "--published" ]]; then
    MODE="published"
    shift
fi
REV="${1:-HEAD}"

die() {
    echo "last-release-tag: $*" >&2
    exit 2
}

is_fork_tag() {
    # Capture first: `git show | grep -q` under pipefail fails on SIGPIPE.
    local pkg
    pkg=$(git show "$1:package.json" 2>/dev/null || true)
    grep -qE "\"name\": *\"$FORK_PKG\"" <<< "$pkg"
}

if [[ "$MODE" == "published" ]]; then
    VERSION=$(npm view "$FORK_PKG" version 2>/dev/null || true)
    [[ -n "$VERSION" ]] || die "npm lookup for $FORK_PKG failed"
    TAG="v$VERSION"
    git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
        || die "npm version $VERSION has no local tag $TAG (run: git fetch origin --tags)"
else
    TAG=$(git describe --tags --abbrev=0 --first-parent --match 'v[0-9]*' "$REV" 2>/dev/null || true)
    [[ -n "$TAG" ]] || die "no vX.Y.Z tag on the first-parent line of $REV"
fi

git merge-base --is-ancestor "$TAG" "$REV" || die "$TAG is not an ancestor of $REV"
is_fork_tag "$TAG" || die "$TAG is not a $FORK_PKG release (package.json name differs) - upstream tag leak?"

echo "$TAG"
