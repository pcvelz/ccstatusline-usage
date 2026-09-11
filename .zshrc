# ccstatusline-usage shell entry points - sourced by the user's shell config.
# Paths resolve relative to this file, so the repo can live anywhere.

_CCSTATUSLINE_USAGE_ROOT="${${(%):-%x}:A:h}"

# ── npm token rotation ──────────────────────────────────────────────────────
# After issuing a new granular token at npmjs.com -> Access Tokens, write it to
# ~/.npmrc and verify it can publish. Optional arg: package (default ours).
npm_rotate() {
    bash "$_CCSTATUSLINE_USAGE_ROOT/scripts/rotate-npm-token.sh" "$@"
}
# ────────────────────────────────────────────────────────────────────────────
