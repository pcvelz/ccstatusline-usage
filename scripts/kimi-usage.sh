#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.kimi.env"

# Source the token if available
if [[ -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE"
fi

KIMI_USAGE_URL="https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages"

# Minimal output when no token or API failure
minimal_output() {
    cat <<'EOF'
{"provider":"kimi","modelPattern":"kimi"}
EOF
}

# Try the official Kimi billing API first.
fetch_api_usage() {
    if [[ -z "${KIMI_AUTH_TOKEN:-}" ]]; then
        return 1
    fi

    if ! command -v jq >/dev/null 2>&1; then
        return 1
    fi

    local response
    response=$(curl -s -m 5 -X POST "$KIMI_USAGE_URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${KIMI_AUTH_TOKEN}" \
        -d '{}' || true)

    if [[ -z "$response" ]] || ! echo "$response" | jq -e '.usages' >/dev/null 2>&1; then
        return 1
    fi

    # Extract monthly (FEATURE_CODING) and weekly (10080-minute window) details
    local monthly weekly
    monthly=$(echo "$response" | jq '[.usages[]? | select(.scope == "FEATURE_CODING") | {used: .detail.used, limit: .detail.limit, resetTime: .detail.resetTime}] | first // {}')
    weekly=$(echo "$response" | jq '[.usages[]? | select(.scope == "FEATURE_CODING") | .limits[]? | select(.window.duration == 10080 and .window.timeUnit == "TIME_UNIT_MINUTE") | {used: .detail.used, limit: .detail.limit, resetTime: .detail.resetTime}] | first // {}')

    echo "{\"monthly\":$monthly,\"weekly\":$weekly}" | jq '{
        provider: "kimi",
        modelPattern: "kimi",
        monthlyUsage: (if .monthly.used != null and .monthly.limit != null and .monthly.limit != 0 then (((.monthly.used / .monthly.limit) * 10000) | round / 100) else null end),
        monthlyResetAt: (.monthly.resetTime // null),
        weeklyUsage: (if .weekly.used != null and .weekly.limit != null and .weekly.limit != 0 then (((.weekly.used / .weekly.limit) * 10000) | round / 100) else null end),
        weeklyResetAt: (.weekly.resetTime // null)
    } | with_entries(select(.value != null))'
}

# Fallback: scrape usage from the open https://www.kimi.com/code/console page
# via the local Chromium CDP server (port 9222).
fetch_cdp_usage() {
    local cdp_script="${REPO_ROOT}/scripts/kimi-usage-cdp.py"
    if [[ ! -f "$cdp_script" ]]; then
        return 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        return 1
    fi
    python3 "$cdp_script" 2>/dev/null
}

# Merge API and CDP results, preferring API values when present.
merge_results() {
    local api_json="$1"
    local cdp_json="$2"

    printf '%s\n%s\n' "$api_json" "$cdp_json" | jq -s '
        .[0] as $api | .[1] as $cdp |
        {
            provider: "kimi",
            modelPattern: "kimi"
        }
        + (if $api.weeklyUsage != null then {weeklyUsage: $api.weeklyUsage} else if $cdp.weeklyUsage != null then {weeklyUsage: $cdp.weeklyUsage} else {} end end)
        + (if $api.weeklyResetAt != null then {weeklyResetAt: $api.weeklyResetAt} else if $cdp.weeklyResetAt != null then {weeklyResetAt: $cdp.weeklyResetAt} else {} end end)
        + (if $api.monthlyUsage != null then {monthlyUsage: $api.monthlyUsage} else {} end)
        + (if $api.monthlyResetAt != null then {monthlyResetAt: $api.monthlyResetAt} else {} end)
        + (if $api.sessionUsage != null then {sessionUsage: $api.sessionUsage} else if $cdp.sessionUsage != null then {sessionUsage: $cdp.sessionUsage} else {} end end)
        + (if $api.sessionResetAt != null then {sessionResetAt: $api.sessionResetAt} else if $cdp.sessionResetAt != null then {sessionResetAt: $cdp.sessionResetAt} else {} end end)
    '
}

main() {
    local api_json cdp_json
    api_json='{}'
    cdp_json='{}'

    api_json=$(fetch_api_usage || echo '{}')

    # If the API returned no usage percentages, fall back to scraping the page.
    if [[ -z "${api_json:-}" ]] || echo "$api_json" | jq -e '.weeklyUsage == null and .monthlyUsage == null and .sessionUsage == null' >/dev/null 2>&1; then
        cdp_json=$(fetch_cdp_usage || echo '{}')
    fi

    local merged
    merged=$(merge_results "$api_json" "$cdp_json")

    # If we still have no usage data, return the minimal placeholder.
    if echo "$merged" | jq -e '.weeklyUsage == null and .monthlyUsage == null and .sessionUsage == null' >/dev/null 2>&1; then
        minimal_output
    else
        echo "$merged"
    fi
}

main
