import {
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync
} from 'fs';
import {
    dirname,
    join
} from 'path';

import { CACHE_DIR } from './rate-limit-snapshot';
import type { StepObservation } from './weekly-estimate';

// Derived store of step observations. Written only by scripts/usage-sampler.ts; the render
// path reads it. Deleting it is safe: the sampler rebuilds it from the sample file.
export const CALIBRATION_FILE = join(CACHE_DIR, 'weekly-calibration.json');

export interface CalibrationStore {
    version: 1;
    observations: StepObservation[];
    // When a limit change was detected (the visible trace of a rebase), else null
    rebasedAt: string | null;
    // Incoming observations at or before this time are ignored, so pre-rebase ones stay dropped
    rebaseCutoff: string | null;
    updatedAt: string;
}

const MAX_OBSERVATIONS = 50;
// Rate median and change-point test look at the most recent observations
const RATE_WINDOW = 5;
const RECENT_COUNT = 3;
const MIN_BASE_COUNT = 3;
const CHANGE_THRESHOLD = 0.25;
const SAMPLE_MAX_AGE_DAYS = 14;

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const upper = sorted[mid] ?? 0;
    if (sorted.length % 2 === 1)
        return upper;
    return ((sorted[mid - 1] ?? 0) + upper) / 2;
}

// Returns the surviving (recent) observations when the last three rates all deviate from the
// base median by more than the threshold in the same direction, else null. A mixed-direction
// deviation is noise, not a limit change.
function changePoint(observations: StepObservation[]): StepObservation[] | null {
    if (observations.length < RECENT_COUNT + MIN_BASE_COUNT)
        return null;
    const base = observations.slice(0, -RECENT_COUNT);
    const recent = observations.slice(-RECENT_COUNT);
    const baseMedian = median(base.slice(-RATE_WINDOW).map(o => o.rate));
    const allUp = recent.every(o => o.rate > baseMedian * (1 + CHANGE_THRESHOLD));
    const allDown = recent.every(o => o.rate < baseMedian * (1 - CHANGE_THRESHOLD));
    return allUp || allDown ? recent : null;
}

// Union of the stored and incoming observations (stored wins on a duplicate `at`), sorted,
// with a change-point check and the last MAX_OBSERVATIONS kept.
export function mergeObservations(store: CalibrationStore | null, incoming: StepObservation[], now: Date): CalibrationStore {
    // Observations dropped by a rebase reappear in every re-extraction, so they are cut off here
    const cutoff = store?.rebaseCutoff ? Date.parse(store.rebaseCutoff) : -Infinity;
    const byAt = new Map<string, StepObservation>();
    for (const o of [...(store?.observations ?? []), ...incoming.filter(o => Date.parse(o.at) > cutoff)]) {
        if (!byAt.has(o.at))
            byAt.set(o.at, o);
    }

    let observations = [...byAt.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let rebasedAt = store?.rebasedAt ?? null;
    let rebaseCutoff = store?.rebaseCutoff ?? null;
    const survivors = changePoint(observations);
    if (survivors !== null) {
        observations = survivors;
        rebasedAt = now.toISOString();
        rebaseCutoff = survivors[0]?.at ?? rebaseCutoff;
    }

    return {
        version: 1,
        observations: observations.slice(-MAX_OBSERVATIONS),
        rebasedAt,
        rebaseCutoff,
        updatedAt: now.toISOString()
    };
}

// Median of the last five step rates. Needs two observations: one rate is not a calibration.
export function currentRate(store: CalibrationStore | null): number | null {
    if (store === null || store.observations.length < 2)
        return null;
    return median(store.observations.slice(-RATE_WINDOW).map(o => o.rate));
}

// Missing, corrupt, or unknown-version files read as no store
export function readCalibration(file = CALIBRATION_FILE): CalibrationStore | null {
    try {
        const store = JSON.parse(readFileSync(file, 'utf8')) as Partial<CalibrationStore>;
        return store.version === 1 && Array.isArray(store.observations) ? store as CalibrationStore : null;
    } catch {
        return null;
    }
}

export function writeCalibration(store: CalibrationStore, file = CALIBRATION_FILE): void {
    mkdirSync(dirname(file), { recursive: true });
    // Write-then-rename: status lines read this file concurrently
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(store));
    renameSync(tmp, file);
}

// Timestamp of one sample line, or NaN when the line is corrupt or has no usable ts
function lineTime(line: string): number {
    try {
        const row = JSON.parse(line) as { ts?: unknown };
        return typeof row.ts === 'string' ? Date.parse(row.ts) : NaN;
    } catch {
        return NaN;
    }
}

// Keeps the lines newer than maxAgeDays. Corrupt lines and lines without a valid ts are dropped.
export function pruneSamples(text: string, now: Date, maxAgeDays = SAMPLE_MAX_AGE_DAYS): string {
    const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
    const kept = text.split('\n').filter(line => line.trim() && lineTime(line) >= cutoff);
    return kept.length === 0 ? '' : `${kept.join('\n')}\n`;
}
