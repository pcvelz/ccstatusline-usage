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

if [[ -z "${KIMI_AUTH_TOKEN:-}" ]]; then
    minimal_output
    exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
    minimal_output
    exit 0
fi

RESPONSE=$(curl -s -m 5 -X POST "$KIMI_USAGE_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${KIMI_AUTH_TOKEN}" \
    -d '{}' || true)

if [[ -z "$RESPONSE" ]] || ! echo "$RESPONSE" | jq -e '.usages' >/dev/null 2>&1; then
    minimal_output
    exit 0
fi

# Extract monthly (FEATURE_CODING) and weekly (10080-minute window) details
MONTHLY=$(echo "$RESPONSE" | jq '[.usages[]? | select(.scope == "FEATURE_CODING") | {used: .detail.used, limit: .detail.limit, resetTime: .detail.resetTime}] | first // {}')
WEEKLY=$(echo "$RESPONSE" | jq '[.usages[]? | select(.scope == "FEATURE_CODING") | .limits[]? | select(.window.duration == 10080 and .window.timeUnit == "TIME_UNIT_MINUTE") | {used: .detail.used, limit: .detail.limit, resetTime: .detail.resetTime}] | first // {}')

# Build JSON, omitting null/empty fields
echo "{\"monthly\":$MONTHLY,\"weekly\":$WEEKLY}" | jq '{
    provider: "kimi",
    modelPattern: "kimi",
    monthlyUsage: (if .monthly.used != null and .monthly.limit != null and .monthly.limit != 0 then (((.monthly.used / .monthly.limit) * 10000) | round / 100) else null end),
    monthlyResetAt: (.monthly.resetTime // null),
    weeklyUsage: (if .weekly.used != null and .weekly.limit != null and .weekly.limit != 0 then (((.weekly.used / .weekly.limit) * 10000) | round / 100) else null end),
    weeklyResetAt: (.weekly.resetTime // null)
} | with_entries(select(.value != null))'
