#!/bin/sh
# Wait until the machine is quiet enough for the test suite, measured, not
# guessed. Several suites (Ink TUI input, subprocess probes, 5s-timeout
# fetch tests) are timing-sensitive: under heavy load they fail at random,
# which reads as a code failure and invites blind retries.
#
# Compares the 1-minute load average with the CPU count. Waits while load is
# above the limit; gives up after the max wait with a LOAD (not a test) error.
#
#   CCSL_TEST_MAX_LOAD      load limit (default: number of CPUs)
#   CCSL_TEST_LOAD_WAIT_S   max seconds to wait (default: 1800)
#   CCSL_TEST_SKIP_LOAD=1   skip the check (CI runners, deliberate override)
#
# Exit 0 = quiet enough, run the tests. Exit 3 = still too busy after waiting.

[ "${CCSL_TEST_SKIP_LOAD:-}" = "1" ] && exit 0
[ -n "${CI:-}" ] && exit 0

cpus=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
limit=${CCSL_TEST_MAX_LOAD:-$cpus}
max_wait=${CCSL_TEST_LOAD_WAIT_S:-1800}
label=${1:-tests}

load1() {
    if [ -r /proc/loadavg ]; then
        cut -d' ' -f1 /proc/loadavg
    else
        sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}'
    fi
}

above() { awk -v l="$1" -v m="$2" 'BEGIN { exit !(l > m) }'; }

waited=0
load=$(load1)
if above "$load" "$limit"; then
    echo "[load] $label: load $load > limit $limit ($cpus CPUs) - waiting for the machine to quiet down (max ${max_wait}s)" >&2
fi
while above "$load" "$limit"; do
    if [ "$waited" -ge "$max_wait" ]; then
        echo "[load] BLOCKED: load still $load > $limit after ${max_wait}s. Not running $label: results would be timing noise, not a code verdict." >&2
        echo "[load] Retry later, or override with CCSL_TEST_MAX_LOAD=<n> / CCSL_TEST_SKIP_LOAD=1." >&2
        exit 3
    fi
    sleep 15
    waited=$((waited + 15))
    load=$(load1)
done
[ "$waited" -gt 0 ] && echo "[load] $label: load $load <= $limit after ${waited}s - running." >&2
exit 0
