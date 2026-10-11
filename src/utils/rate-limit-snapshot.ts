import {
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { StatusJSON } from '../types/StatusJSON';

// Last rate_limits block Claude Code sent to the status line. Its used_percentage
// for five_hour is fractional (e.g. 23.4), unlike the integer API value, so the
// render path persists it here for the usage sampler (scripts/usage-sampler.ts)
// to read. The sampler runs from launchd and never sees the status JSON itself.
export const CACHE_DIR = join(homedir(), '.cache', 'ccstatusline');
export const RATE_LIMIT_SNAPSHOT_FILE = join(CACHE_DIR, 'rate-limits.json');

export interface RateLimitSnapshot {
    capturedAt: string;
    fiveHourPercent: number | null;
    fiveHourResetsAt: string | null;
    sevenDayPercent: number | null;
    sevenDayResetsAt: string | null;
}

function epochSecondsToIso(seconds: number | null | undefined): string | null {
    return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

// Best-effort: a failed write must never break the status line.
export function saveRateLimitSnapshot(rateLimits: StatusJSON['rate_limits'], now: Date = new Date()): void {
    const fiveHour = rateLimits?.five_hour;
    const sevenDay = rateLimits?.seven_day;
    if (!fiveHour && !sevenDay)
        return;

    // A payload that omits five_hour (seen mid-session) must not erase the last good
    // five-hour value, or the estimator loses its session input.
    const previous = readRateLimitSnapshot();
    const snapshot: RateLimitSnapshot = {
        capturedAt: now.toISOString(),
        fiveHourPercent: fiveHour?.used_percentage ?? previous?.fiveHourPercent ?? null,
        fiveHourResetsAt: fiveHour ? epochSecondsToIso(fiveHour.resets_at) : previous?.fiveHourResetsAt ?? null,
        sevenDayPercent: sevenDay?.used_percentage ?? null,
        sevenDayResetsAt: epochSecondsToIso(sevenDay?.resets_at)
    };

    try {
        mkdirSync(CACHE_DIR, { recursive: true });
        // Write-then-rename so the sampler never reads a half-written file
        const tmp = `${RATE_LIMIT_SNAPSHOT_FILE}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(snapshot));
        renameSync(tmp, RATE_LIMIT_SNAPSHOT_FILE);
    } catch {
        // Ignore cache write errors
    }
}

export function readRateLimitSnapshot(): RateLimitSnapshot | null {
    try {
        return JSON.parse(readFileSync(RATE_LIMIT_SNAPSHOT_FILE, 'utf8')) as RateLimitSnapshot;
    } catch {
        return null;
    }
}
