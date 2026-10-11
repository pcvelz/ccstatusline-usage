import {
    closeSync,
    fstatSync,
    openSync,
    readSync
} from 'fs';
import { join } from 'path';

import {
    CACHE_DIR,
    readRateLimitSnapshot
} from './rate-limit-snapshot';
import {
    currentRate,
    readCalibration
} from './weekly-calibration';

// One usage sample per sampler tick (scripts/usage-sampler.ts). `session` is the five-hour %
// and `weekly` the integer weekly %, both from the API. Only the live point uses the
// fractional five-hour % from the rate_limits snapshot.
export interface UsageSample {
    ts: string;
    session: number | null;
    sessionResetAt: string | null;
    weekly: number | null;
    weeklyResetAt: string | null;
}

// One calibrated weekly step pair: the session usage between two consecutive weekly steps
// and the weekly % it bought. Persisted by weekly-calibration.ts.
export interface StepObservation {
    at: string;
    weeklyResetAt: string;
    fromWeekly: number;
    toWeekly: number;
    sessionSpan: number;
    rate: number;
}

export interface WeeklyEstimate {
    value: number;
    // Weekly % per session % (the calibrated rate)
    rate: number;
    rateSource: 'stored' | 'window';
}

export const USAGE_SAMPLE_FILE = join(CACHE_DIR, 'usage-samples.jsonl');

// A snapshot older than this no longer describes the live session
const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
// Session % that must elapse between two steps before their rate is trusted
const MIN_SESSION_SPAN = 5;
// A reset whose previous sample was taken more than this before its block ended missed usage
const LOSSY_RESET_MS = 6 * 60 * 1000;
// Tail of the sample file read per render (~3 days of 2-min samples)
const SAMPLE_TAIL_BYTES = 512 * 1024;

interface Point {
    ts: string;
    weekly: number;
    session: number;
    weeklyResetAt: string;
    sessionResetKey: number | null;
    // True when this sample starts a new five-hour block (session reset since the previous point)
    reset: boolean;
    // True when that reset followed a sample taken too long before its block ended
    lossy: boolean;
}

// Reset timestamps jitter by a fraction of a second between fetches (the same
// boundary arrives as 13:00:00.429 and 12:59:59.569), so keys are rounded to the minute.
function timeKey(iso: string | null): number | null {
    if (iso === null)
        return null;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : Math.round(ms / 60_000);
}

function isNullableNumber(value: unknown): value is number | null {
    return value === null || typeof value === 'number';
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

// Error rows ({ ts, error }) and rows with missing or mistyped fields are rejected
export function isUsageSample(row: unknown): row is UsageSample {
    if (typeof row !== 'object' || row === null || 'error' in row)
        return false;
    const r = row as Record<string, unknown>;
    return typeof r.ts === 'string'
        && isNullableNumber(r.session)
        && isNullableString(r.sessionResetAt)
        && isNullableNumber(r.weekly)
        && isNullableString(r.weeklyResetAt);
}

// A torn or corrupt line parses to null, which fails isUsageSample
function parseLine(line: string): unknown {
    try {
        return JSON.parse(line);
    } catch {
        return null;
    }
}

export function parseSampleLines(text: string): UsageSample[] {
    const samples: UsageSample[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim())
            continue;
        const row = parseLine(line);
        if (isUsageSample(row))
            samples.push(row);
    }
    return samples;
}

// Element at i. Callers only pass indices inside the array, so a miss is a logic error.
function at<T>(items: readonly T[], i: number): T {
    const item = items[i];
    if (item === undefined)
        throw new Error(`weekly-estimate: index ${i} outside array of length ${items.length}`);
    return item;
}

// Valid points of one weekly window, in order. A reset is a change of the five-hour block's
// reset time. A lower session value inside the same block is noise from another pane's
// snapshot, not a reset.
function toPoints(samples: UsageSample[]): Point[] {
    const points: Point[] = [];
    let prev: UsageSample | undefined;
    for (const s of samples) {
        if (s.session === null || s.weekly === null || s.weeklyResetAt === null)
            continue;
        const sessionResetKey = timeKey(s.sessionResetAt);
        const reset = prev !== undefined && timeKey(prev.sessionResetAt) !== sessionResetKey;
        // Unparseable timestamps make the comparison false, so they are never lossy
        const lossy = prev !== undefined && reset && prev.sessionResetAt !== null
            && Date.parse(prev.sessionResetAt) - Date.parse(prev.ts) > LOSSY_RESET_MS;
        points.push({ ts: s.ts, weekly: s.weekly, session: s.session, weeklyResetAt: s.weeklyResetAt, sessionResetKey, reset, lossy });
        prev = s;
    }
    return points;
}

// Indices where the weekly value changed since the previous point
function stepIndices(points: Point[]): number[] {
    const steps: number[] = [];
    for (let i = 1; i < points.length; i++) {
        if (at(points, i).weekly !== at(points, i - 1).weekly)
            steps.push(i);
    }
    return steps;
}

// Cumulative session % across the window. A reset point contributes its whole
// session value: the block restarted from ~0.
function cumulate(points: Point[]): number[] {
    const cum: number[] = [0];
    for (let i = 1; i < points.length; i++) {
        const p = at(points, i);
        const prev = at(points, i - 1);
        const delta = p.reset ? p.session : Math.max(0, p.session - prev.session);
        cum.push(at(cum, i - 1) + delta);
    }
    return cum;
}

// One observation per pair of consecutive steps. A pair is skipped when a lossy reset sits
// between its steps (usage was never sampled) or when too little session usage separates them.
function observationsFromPoints(points: Point[], cum: number[]): StepObservation[] {
    const steps = stepIndices(points);
    const observations: StepObservation[] = [];
    for (let k = 1; k < steps.length; k++) {
        const prevStep = at(steps, k - 1);
        const step = at(steps, k);
        if (points.slice(prevStep + 1, step + 1).some(p => p.lossy))
            continue;
        const from = at(points, prevStep);
        const to = at(points, step);
        const sessionSpan = at(cum, step) - at(cum, prevStep);
        if (sessionSpan < MIN_SESSION_SPAN || to.weekly <= from.weekly)
            continue;
        observations.push({
            at: to.ts,
            weeklyResetAt: to.weeklyResetAt,
            fromWeekly: from.weekly,
            toWeekly: to.weekly,
            sessionSpan,
            rate: (to.weekly - from.weekly) / sessionSpan
        });
    }
    return observations;
}

// Observations from every weekly window in the samples, ordered by at
export function extractObservations(samples: UsageSample[]): StepObservation[] {
    const windows = new Map<number, UsageSample[]>();
    for (const s of samples) {
        const key = timeKey(s.weeklyResetAt);
        if (key === null)
            continue;
        const group = windows.get(key) ?? [];
        group.push(s);
        windows.set(key, group);
    }
    const observations: StepObservation[] = [];
    for (const group of windows.values()) {
        const points = toPoints(group);
        observations.push(...observationsFromPoints(points, cumulate(points)));
    }
    return observations.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function isUsableRate(rate: number | null): rate is number {
    return rate !== null && Number.isFinite(rate) && rate > 0;
}

// Estimator. Returns the weekly % with its fractional part, or null when the window
// has no integer step yet or no rate is available (stored or measured in this window).
//
// Model: the weekly API value is the floor of a true value that grows with the
// cumulative five-hour session %. The rate is the stored calibrated rate when there is one,
// otherwise the last observation in the live window. Between integer steps the value
// advances by rate * (session % since the last step), capped below the next integer.
export function estimateWeeklyDetail(
    samples: UsageSample[],
    live: Omit<UsageSample, 'ts'>,
    storedRate: number | null = null
): WeeklyEstimate | null {
    const liveKey = timeKey(live.weeklyResetAt);
    const window = [...samples, { ts: '', ...live }].filter(s => timeKey(s.weeklyResetAt) === liveKey);
    const points = toPoints(window);
    const cum = cumulate(points);

    // The estimate advances from the last integer step in the live window
    const anchor = stepIndices(points).at(-1);
    if (anchor === undefined)
        return null;

    const useStored = isUsableRate(storedRate);
    const windowRate = observationsFromPoints(points, cum).at(-1)?.rate ?? null;
    const rate = useStored ? storedRate : windowRate;
    if (rate === null)
        return null;

    const last = at(points, points.length - 1);
    const sinceAnchor = at(cum, cum.length - 1) - at(cum, anchor);
    return {
        value: last.weekly + Math.min(rate * sinceAnchor, 0.999),
        rate,
        rateSource: useStored ? 'stored' : 'window'
    };
}

export function estimateWeeklyPercent(samples: UsageSample[], live: Omit<UsageSample, 'ts'>, storedRate: number | null = null): number | null {
    return estimateWeeklyDetail(samples, live, storedRate)?.value ?? null;
}

function readSampleTail(): UsageSample[] {
    try {
        const fd = openSync(USAGE_SAMPLE_FILE, 'r');
        try {
            const size = fstatSync(fd).size;
            const length = Math.min(size, SAMPLE_TAIL_BYTES);
            const buf = Buffer.alloc(length);
            readSync(fd, buf, 0, length, size - length);
            // A partial first line (the tail starts mid-row) is dropped
            const text = buf.toString('utf8').split('\n').slice(size > length ? 1 : 0).join('\n');
            return parseSampleLines(text);
        } finally {
            closeSync(fd);
        }
    } catch {
        return [];
    }
}

// Render-path entry point. Returns null (show the integer) when the live
// snapshot is missing or stale, or when the sample history is too thin.
export function readWeeklyEstimate(weekly: number, now: Date = new Date()): number | null {
    const snapshot = readRateLimitSnapshot();
    if (snapshot?.fiveHourPercent === null || snapshot === null)
        return null;
    if (now.getTime() - Date.parse(snapshot.capturedAt) > SNAPSHOT_MAX_AGE_MS)
        return null;

    // The reset time comes from the sample history, not the payload: the payload's
    // seven_day reset can differ from the API's, which would split the window.
    const samples = readSampleTail();
    const weeklyResetAt = samples.at(-1)?.weeklyResetAt ?? null;
    if (weeklyResetAt === null)
        return null;

    return estimateWeeklyPercent(samples, {
        session: snapshot.fiveHourPercent,
        sessionResetAt: snapshot.fiveHourResetsAt,
        weekly,
        weeklyResetAt
    }, currentRate(readCalibration()));
}
