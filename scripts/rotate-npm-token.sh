#!/usr/bin/env bash
# npm granular access token rotation (shell: npm_rotate, from the repo .zshrc)
#
# npm has no rotation API for granular tokens, so issuing one stays manual:
#   npmjs.com -> avatar -> Access Tokens -> Generate New Token -> Granular Access Token
#   (read/write on ccstatusline-usage, "bypass 2FA" on, pick an expiry)
#
# This script then:
# 1. Reads the new token securely (never echoed, never in argv or history)
# 2. Replaces the registry auth line in ~/.npmrc (other lines untouched, mode 600)
# 3. Verifies with `npm whoami` and checks read-write on the package
# 4. Restores the previous ~/.npmrc if verification fails
#
# An expired token makes `npm publish` fail with "404 '<pkg>@<version>' is not
# in this registry" - that message means auth, not a missing package.
#
# Usage: npm_rotate [package]      (default package: ccstatusline-usage)
# Exit 0 on success, non-zero on failure with ~/.npmrc restored.

set -uo pipefail

REGISTRY_KEY="//registry.npmjs.org/:_authToken"

main() {
    local rc_file="$HOME/.npmrc"
    local pkg="${1:-ccstatusline-usage}"
    local backup_dir new_token user tmp

    backup_dir=$(mktemp -d) || return 1
    trap "rm -rf '$backup_dir'" EXIT
    [[ -f "$rc_file" ]] && cp -p "$rc_file" "$backup_dir/npmrc.bak"

    echo "Issue a granular token first: npmjs.com -> Access Tokens -> Generate New Token -> Granular."
    echo "Tick 'Bypass two-factor authentication', or every publish fails with EOTP (npm whoami still passes)."
    printf 'Paste the new npm token (input hidden): '
    IFS= read -rs new_token < /dev/tty
    echo
    new_token="${new_token//[[:space:]]/}"
    if [[ ! "$new_token" =~ ^npm_[A-Za-z0-9]{20,}$ ]]; then
        echo "Error: that doesn't look like an npm token (expected npm_...). Nothing changed." >&2
        return 1
    fi

    # Rewrite ~/.npmrc without the old registry auth line, then append the new
    # one. printf is a shell builtin, so the token never appears in argv.
    tmp=$(mktemp "$HOME/.npmrc.XXXXXX") || return 1
    chmod 600 "$tmp"
    if [[ -f "$rc_file" ]]; then
        grep -vF "${REGISTRY_KEY}=" "$rc_file" > "$tmp" || true
    fi
    printf '%s=%s\n' "$REGISTRY_KEY" "$new_token" >> "$tmp"
    mv "$tmp" "$rc_file"
    chmod 600 "$rc_file"
    unset new_token

    if ! user=$(npm whoami 2>/dev/null); then
        echo "Error: npm whoami failed with the new token - restoring the previous ~/.npmrc." >&2
        restore "$backup_dir" "$rc_file"
        return 1
    fi
    echo "OK: authenticated as $user"

    if npm access list collaborators "$pkg" --json 2>/dev/null | grep -q "\"$user\": *\"read-write\""; then
        echo "OK: $user has read-write on $pkg"
    else
        echo "WARN: could not confirm read-write on $pkg for $user. Check the token's package scope." >&2
    fi
}

restore() {
    local backup_dir="$1" rc_file="$2"
    if [[ -f "$backup_dir/npmrc.bak" ]]; then
        cp -p "$backup_dir/npmrc.bak" "$rc_file"
    else
        rm -f "$rc_file"
    fi
}

main "$@"
