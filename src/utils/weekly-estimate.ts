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
import { readCalibration } from './weekly-calibration';

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

// Model. Both percentages divide the same weighted usage by a limit, so within one week
// the true weekly value grows linearly with the cumulative five-hour session %:
//
//     W = offset + rate * C,   rate = five-hour limit / weekly limit
//
// The API reports floor(W). Each weekly level crossed is therefore known only to lie
// between two session readings, and the weekly counter trails the session counter by a
// varying amount. The rate is fitted to those crossing intervals with a lag allowance
// (see fitRate); the decimal shown is the fit evaluated at the current session usage.

// One weekly level crossed: the true weekly value reached `level` while the cumulative
// session % of its stretch was between cLo (the reading before the step) and cHi (the
// reading at the step). cLo/cHi are relative to the stretch's first sample, so crossings of
// one stretch share an offset and crossings of different stretches never mix.
export interface WeeklyCrossing {
    stretch: string;
    weeklyResetAt: string;
    at: string;
    level: number;
    cLo: number;
    cHi: number;
}

export interface RateFit {
    // Weekly % per session % (the five-hour limit over the weekly limit)
    rate: number;
    // Smallest lag, in session %, that makes every crossing agree on one rate. It absorbs
    // whole-percent rounding and the weekly counter trailing the session counter, and is
    // the estimate's error bar: the decimal is good to about rate * tau.
    tau: number;
    crossings: number;
}

export interface WeeklyEstimate {
    value: number;
    rate: number;
    tau: number;
    rateSource: 'stored' | 'window';
}

export const USAGE_SAMPLE_FILE = join(CACHE_DIR, 'usage-samples.jsonl');

// A snapshot older than this no longer describes the live session
const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
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
    // True when the weekly value is lower than the previous point's inside the same window:
    // the plan or limit changed, so the old rate and offset no longer apply
    limitChange: boolean;
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
    let prevWeekly: number | undefined;
    for (const s of samples) {
        if (s.session === null || s.weekly === null || s.weeklyResetAt === null)
            continue;
        const sessionResetKey = timeKey(s.sessionResetAt);
        const reset = prev !== undefined && timeKey(prev.sessionResetAt) !== sessionResetKey;
        // Unparseable timestamps make the comparison false, so they are never lossy
        const lossy = prev !== undefined && reset && prev.sessionResetAt !== null
            && Date.parse(prev.sessionResetAt) - Date.parse(prev.ts) > LOSSY_RESET_MS;
        const limitChange = prevWeekly !== undefined && s.weekly < prevWeekly;
        points.push({ ts: s.ts, weekly: s.weekly, session: s.session, weeklyResetAt: s.weeklyResetAt, sessionResetKey, reset, lossy, limitChange });
        prev = s;
        prevWeekly = s.weekly;
    }
    return points;
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

// Index ranges of a weekly window with no lossy reset or limit change inside. Cumulative
// session differences are only trustworthy within one stretch, and a limit change moves
// both the rate and the offset.
function stretches(points: Point[]): { start: number; end: number }[] {
    if (points.length === 0)
        return [];
    const result: { start: number; end: number }[] = [];
    let start = 0;
    for (let i = 1; i < points.length; i++) {
        const p = at(points, i);
        if (p.lossy || p.limitChange) {
            result.push({ start, end: i - 1 });
            start = i;
        }
    }
    result.push({ start, end: points.length - 1 });
    return result;
}

// Every level crossed in one stretch. A reading that jumps two levels (5 -> 7) crossed
// both inside the same reading interval.
function stretchCrossings(points: Point[], cum: number[], start: number, end: number): WeeklyCrossing[] {
    const stretch = at(points, start).ts;
    const base = at(cum, start);
    const crossings: WeeklyCrossing[] = [];
    for (let i = start + 1; i <= end; i++) {
        const prev = at(points, i - 1);
        const p = at(points, i);
        for (let level = prev.weekly + 1; level <= p.weekly; level++) {
            crossings.push({
                stretch,
                weeklyResetAt: p.weeklyResetAt,
                at: p.ts,
                level,
                cLo: at(cum, i - 1) - base,
                cHi: at(cum, i) - base
            });
        }
    }
    return crossings;
}

function crossingsFromPoints(points: Point[]): WeeklyCrossing[] {
    const cum = cumulate(points);
    return stretches(points).flatMap(s => stretchCrossings(points, cum, s.start, s.end));
}

// Samples grouped by weekly window (reset time rounded to the minute)
function groupByWindow(samples: UsageSample[]): Map<number, UsageSample[]> {
    const windows = new Map<number, UsageSample[]>();
    for (const s of samples) {
        const key = timeKey(s.weeklyResetAt);
        if (key === null)
            continue;
        const group = windows.get(key) ?? [];
        group.push(s);
        windows.set(key, group);
    }
    return windows;
}

// Crossings from every weekly window in the samples, ordered by at
export function extractCrossings(samples: UsageSample[]): WeeklyCrossing[] {
    const crossings: WeeklyCrossing[] = [];
    for (const group of groupByWindow(samples).values())
        crossings.push(...crossingsFromPoints(toPoints(group)));
    return crossings.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ts of the most recent limit change (a weekly drop inside one weekly window), or null.
// A drop across windows is a normal weekly reset and does not count.
export function latestLimitChange(samples: UsageSample[]): string | null {
    let latest: string | null = null;
    for (const group of groupByWindow(samples).values()) {
        for (const p of toPoints(group)) {
            if (p.limitChange && (latest === null || Date.parse(p.ts) > Date.parse(latest)))
                latest = p.ts;
        }
    }
    return latest;
}

// The rate range that every pair of same-stretch crossings allows when each crossing may
// sit up to tau session % outside its reading interval. Empty (lo > hi) when tau is too
// small for the data; lo is 0 when no pair exists.
function rateRange(crossings: WeeklyCrossing[], tau: number): { lo: number; hi: number } {
    let lo = 0;
    let hi = Infinity;
    for (let i = 0; i < crossings.length; i++) {
        const a = at(crossings, i);
        for (let j = i + 1; j < crossings.length; j++) {
            const b = at(crossings, j);
            if (a.stretch !== b.stretch || a.level === b.level)
                continue;
            const [low, high] = a.level < b.level ? [a, b] : [b, a];
            const levels = high.level - low.level;
            const spanMax = high.cHi - low.cLo + 2 * tau;
            const spanMin = high.cLo - low.cHi - 2 * tau;
            if (spanMax <= 0)
                return { lo: 1, hi: 0 };
            lo = Math.max(lo, levels / spanMax);
            if (spanMin > 0)
                hi = Math.min(hi, levels / spanMin);
        }
    }
    return { lo, hi };
}

// Upper bound of the lag search, in session %. Feasibility only grows with tau, so the
// bisection below finds the smallest feasible tau to within MAX_TAU / 2^TAU_STEPS.
const MAX_TAU = 100;
const TAU_STEPS = 40;

// Minimax fit: the smallest tau at which one rate explains every crossing, and that rate.
// Long spans pin the rate; step-to-step jitter only raises tau. Null when no pair of
// crossings in one stretch bounds the rate from both sides.
export function fitRate(crossings: WeeklyCrossing[]): RateFit | null {
    if (rateRange(crossings, MAX_TAU).lo <= 0)
        return null;
    let lowTau = 0;
    let highTau = MAX_TAU;
    for (let k = 0; k < TAU_STEPS; k++) {
        const mid = (lowTau + highTau) / 2;
        const range = rateRange(crossings, mid);
        if (range.lo <= range.hi)
            highTau = mid;
        else
            lowTau = mid;
    }
    const range = rateRange(crossings, highTau);
    // No pair spans enough session usage to cap the rate (e.g. only a two-level jump)
    if (!Number.isFinite(range.hi))
        return null;
    return { rate: (range.lo + range.hi) / 2, tau: highTau, crossings: crossings.length };
}

function isUsableFit(fit: RateFit | null): fit is RateFit {
    return fit !== null && Number.isFinite(fit.rate) && fit.rate > 0;
}

// A sample with the session, weekly and weekly reset values all present
type WindowSample = UsageSample & { session: number; weekly: number; weeklyResetAt: string };

function isWindowSample(s: UsageSample): s is WindowSample {
    return s.session !== null && s.weekly !== null && s.weeklyResetAt !== null;
}

// A weekly reset puts the true weekly value at exactly 0. When the previous window's last
// sample was taken just before that reset, the new window starts from a level-0 crossing whose
// interval is the session usage between those two readings.
function weeklyResetAnchor(samples: UsageSample[], liveKey: number | null, first: Point): WeeklyCrossing | null {
    const valid = samples.filter(isWindowSample);
    const index = valid.findIndex(s => timeKey(s.weeklyResetAt) === liveKey);
    const prev = index > 0 ? valid[index - 1] : undefined;
    if (prev === undefined)
        return null;
    // NaN from an unparseable timestamp fails the comparison, so it yields no anchor
    const lead = Date.parse(prev.weeklyResetAt) - Date.parse(prev.ts);
    if (first.weekly !== 0 || !(lead <= LOSSY_RESET_MS))
        return null;
    const delta = timeKey(prev.sessionResetAt) !== first.sessionResetKey
        ? first.session
        : Math.max(0, first.session - prev.session);
    return { stretch: first.ts, weeklyResetAt: first.weeklyResetAt, at: first.ts, level: 0, cLo: -delta, cHi: 0 };
}

// Estimator. Returns the weekly % with its fractional part, or null when the live stretch
// has no crossing yet or no rate is available (stored, or fitted on the live window).
//
// The value advances from the live stretch's latest crossing at the fitted rate. When the
// live window has no crossing yet, the weekly reset itself anchors the first stretch (see
// weeklyResetAnchor). The rate is never fitted on that anchor. The result is clamped to
// [API value, API value + 0.999]: the whole digit is always the API's.
export function estimateWeeklyDetail(
    samples: UsageSample[],
    live: Omit<UsageSample, 'ts'>,
    stored: RateFit | null = null
): WeeklyEstimate | null {
    const liveKey = timeKey(live.weeklyResetAt);
    const withLive = [...samples, { ts: '', ...live }];
    const window = withLive.filter(s => timeKey(s.weeklyResetAt) === liveKey);
    const allPoints = toPoints(window);
    // The live weekly comes from the usage cache and can lag the sampler by a step; limit
    // changes are recognised from sampled history only
    const liveIndex = allPoints.length - 1;
    const liveTail = allPoints[liveIndex];
    if (liveTail !== undefined)
        allPoints[liveIndex] = { ...liveTail, limitChange: false };
    // After a limit change only the points from the latest one on describe the current limit.
    // Plain loop: findLastIndex is not available on Node 14.
    let changeIndex = 0;
    for (let i = allPoints.length - 1; i > 0; i--) {
        if (at(allPoints, i).limitChange) {
            changeIndex = i;
            break;
        }
    }
    const points = allPoints.slice(changeIndex);
    const liveStretch = stretches(points).at(-1);
    if (liveStretch === undefined)
        return null;

    const cum = cumulate(points);
    const crossings = stretchCrossings(points, cum, liveStretch.start, liveStretch.end);
    // Only a window that starts at its first sample, with no limit change, can use the reset anchor
    const resetAnchor = crossings.length === 0 && changeIndex === 0 && liveStretch.start === 0
        ? weeklyResetAnchor(withLive, liveKey, at(points, 0))
        : null;
    if (crossings.length === 0 && resetAnchor === null)
        return null;

    const useStored = isUsableFit(stored);
    const fit = useStored ? stored : fitRate(crossingsFromPoints(points));
    if (!isUsableFit(fit))
        return null;

    // Anchored on the most recent crossing, at the middle of its reading interval. The rate
    // drifts with the model mix, so a mean over older crossings lags behind the latest step.
    const anchor = resetAnchor ?? at(crossings, crossings.length - 1);
    const offset = anchor.level - fit.rate * (anchor.cLo + anchor.cHi) / 2;
    const last = at(points, points.length - 1);
    const now = at(cum, cum.length - 1) - at(cum, liveStretch.start);
    const fraction = Math.min(Math.max(offset + fit.rate * now - last.weekly, 0), 0.999);
    return {
        value: last.weekly + fraction,
        rate: fit.rate,
        tau: fit.tau,
        rateSource: useStored ? 'stored' : 'window'
    };
}

export function estimateWeeklyPercent(samples: UsageSample[], live: Omit<UsageSample, 'ts'>, stored: RateFit | null = null): number | null {
    return estimateWeeklyDetail(samples, live, stored)?.value ?? null;
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
    }, readCalibration()?.fit ?? null);
}
