import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
    describe,
    expect,
    it
} from 'vitest';

import { mergeCrossings } from '../weekly-calibration';
import {
    estimateWeeklyDetail,
    estimateWeeklyPercent,
    extractCrossings,
    fitRate,
    isUsageSample,
    latestLimitChange,
    parseSampleLines,
    type RateFit,
    type UsageSample,
    type WeeklyCrossing
} from '../weekly-estimate';

const MIN = 60_000;
const WEEK = '2026-10-17T13:00:00.000+00:00';
const WEEK2 = '2026-10-24T13:00:00.000+00:00';
const BLOCK_A = '2026-10-10T19:40:00.000+00:00';
const BLOCK_B = '2026-10-10T22:40:00.000+00:00';
const T0 = Date.parse('2026-10-10T18:00:00.000Z');

// ts in minutes after T0 (18:00 UTC)
function at(minutes: number): string {
    return new Date(T0 + minutes * MIN).toISOString();
}

function sample(session: number, weekly: number, sessionResetAt = BLOCK_A, weeklyResetAt = WEEK): UsageSample {
    return { ts: '', session, sessionResetAt, weekly, weeklyResetAt };
}

function row(ts: string, session: number, weekly: number, sessionResetAt = BLOCK_A, weeklyResetAt = WEEK): UsageSample {
    return { ts, session, sessionResetAt, weekly, weeklyResetAt };
}

function live(session: number, weekly: number, sessionResetAt = BLOCK_A, weeklyResetAt = WEEK): Omit<UsageSample, 'ts'> {
    return { session, sessionResetAt, weekly, weeklyResetAt };
}

// A stored calibration fit with the given rate (zero lag, so the rate is used as given)
function storedFit(rate: number): RateFit {
    return { rate, tau: 0, crossings: 2 };
}

// A crossing in the WEEK window; `ts` is its reading time
function crossing(level: number, cLo: number, cHi: number, stretch = 'S', ts = at(0)): WeeklyCrossing {
    return { stretch, weeklyResetAt: WEEK, at: ts, level, cLo, cHi };
}

describe('isUsageSample / parseSampleLines', () => {
    it('accepts a complete sample row', () => {
        expect(isUsageSample(row(at(0), 10, 3))).toBe(true);
    });

    it('accepts null session and weekly values', () => {
        expect(isUsageSample({ ts: at(0), session: null, sessionResetAt: null, weekly: null, weeklyResetAt: null })).toBe(true);
    });

    it('rejects error rows and rows with missing fields', () => {
        expect(isUsageSample({ ts: at(0), error: 'HTTP 429' })).toBe(false);
        expect(isUsageSample({ ts: at(0), session: 1 })).toBe(false);
        expect(isUsageSample(null)).toBe(false);
    });

    it('keeps only valid rows and skips corrupt lines', () => {
        const text = [
            JSON.stringify(row(at(0), 10, 3)),
            JSON.stringify({ ts: at(1), error: 'HTTP 429' }),
            '{"ts":',
            '',
            JSON.stringify(row(at(2), 12, 4))
        ].join('\n');
        expect(parseSampleLines(text)).toEqual([row(at(0), 10, 3), row(at(2), 12, 4)]);
    });
});

describe('extractCrossings', () => {
    it('emits one crossing per level with the cumulative session interval', () => {
        // Session cum 0, 10, 20, 30. Weekly 3 -> 4 between cum 0 and 10; 4 -> 5 between cum 20 and 30
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(20), 20, 4),
            row(at(30), 30, 5)
        ];
        expect(extractCrossings(samples)).toEqual([
            { stretch: at(0), weeklyResetAt: WEEK, at: at(10), level: 4, cLo: 0, cHi: 10 },
            { stretch: at(0), weeklyResetAt: WEEK, at: at(30), level: 5, cLo: 20, cHi: 30 }
        ]);
    });

    it('a two-level jump yields both levels over the same interval', () => {
        // Weekly 5 -> 7 inside one reading interval (cum 0 to 10): levels 6 and 7
        const samples = [row(at(0), 0, 5), row(at(10), 10, 7)];
        expect(extractCrossings(samples)).toEqual([
            { stretch: at(0), weeklyResetAt: WEEK, at: at(10), level: 6, cLo: 0, cHi: 10 },
            { stretch: at(0), weeklyResetAt: WEEK, at: at(10), level: 7, cLo: 0, cHi: 10 }
        ]);
    });

    it('a lossy reset starts a new stretch whose cumulative restarts at zero', () => {
        // Block A ends at 19:40 (at(100)); its last sample is at(20), 80 min early: lossy.
        // Stretch 1: level 4 between cum 0 and 10.
        // Stretch 2 (starts at(105), cum 0 at its first sample): block B reset to 0, then 20 -> cum 20 -> 40.
        // Level 5 between stretch-relative cum 0 and 20.
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(20), 20, 4),
            row(at(105), 0, 4, BLOCK_B),
            row(at(115), 20, 5, BLOCK_B)
        ];
        expect(extractCrossings(samples)).toEqual([
            { stretch: at(0), weeklyResetAt: WEEK, at: at(10), level: 4, cLo: 0, cHi: 10 },
            { stretch: at(105), weeklyResetAt: WEEK, at: at(115), level: 5, cLo: 0, cHi: 20 }
        ]);
    });

    it('a weekly drop inside one window starts a new stretch (limit change)', () => {
        // Same block throughout. Stretch 1: level 6 between cum 0 and 10.
        // The drop 6 -> 0 at at(30) restarts the stretch: cum 0 there, then session 22 -> 25 -> 28.
        // Level 1 between 0 and 3, level 2 between 3 and 6.
        const samples = [
            row(at(0), 0, 5),
            row(at(10), 10, 6),
            row(at(20), 20, 6),
            row(at(30), 22, 0),
            row(at(40), 25, 1),
            row(at(50), 28, 2)
        ];
        expect(extractCrossings(samples)).toEqual([
            { stretch: at(0), weeklyResetAt: WEEK, at: at(10), level: 6, cLo: 0, cHi: 10 },
            { stretch: at(30), weeklyResetAt: WEEK, at: at(40), level: 1, cLo: 0, cHi: 3 },
            { stretch: at(30), weeklyResetAt: WEEK, at: at(50), level: 2, cLo: 3, cHi: 6 }
        ]);
    });

    it('returns crossings from two weekly windows, ordered by at', () => {
        const window1 = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(20), 20, 4),
            row(at(30), 30, 5)
        ];
        const window2 = [
            row(at(200), 0, 1, BLOCK_B, WEEK2),
            row(at(210), 10, 2, BLOCK_B, WEEK2),
            row(at(220), 20, 2, BLOCK_B, WEEK2),
            row(at(230), 30, 3, BLOCK_B, WEEK2)
        ];
        const crossings = extractCrossings([...window2, ...window1]);
        expect(crossings.map(c => c.at)).toEqual([at(10), at(30), at(210), at(230)]);
        expect(crossings.map(c => c.weeklyResetAt)).toEqual([WEEK, WEEK, WEEK2, WEEK2]);
    });
});

describe('latestLimitChange', () => {
    it('returns the ts of the sample where the weekly value dropped inside one window', () => {
        const samples = [
            row(at(0), 0, 5),
            row(at(10), 10, 6),
            row(at(20), 20, 6),
            row(at(30), 22, 0),
            row(at(40), 25, 1)
        ];
        expect(latestLimitChange(samples)).toBe(at(30));
    });

    it('ignores a drop across different weekly windows (a normal weekly reset)', () => {
        const samples = [row(at(0), 0, 90, BLOCK_A, WEEK), row(at(10), 5, 0, BLOCK_A, WEEK2)];
        expect(latestLimitChange(samples)).toBeNull();
    });

    it('returns null when the weekly value never drops', () => {
        expect(latestLimitChange([row(at(0), 0, 3), row(at(10), 10, 4), row(at(20), 12, 4)])).toBeNull();
    });
});

describe('fitRate', () => {
    it('exact data gives rate 0.05 with tau near zero', () => {
        // Level 1 at cum 10, level 2 at 30, level 3 at 50: every pair spans 20 per level
        const fit = fitRate([crossing(1, 10, 10), crossing(2, 30, 30), crossing(3, 50, 50)]);
        expect(fit).not.toBeNull();
        expect(fit?.rate).toBeCloseTo(0.05, 6);
        expect(fit?.tau).toBeLessThan(1e-6);
        expect(fit?.crossings).toBe(3);
    });

    it('jittered data: the long span bounds the rate, and tau is positive', () => {
        // Levels 1..4 at cum 0, 22, 38, 45 (like the real 4 -> 5 -> 6 -> 7 steps).
        // Pair rates (levels / span): 1/22, 2/38, 3/45, 1/16, 2/23, 1/7. The shortest span
        // (3 -> 4, span 7) and the longest reach a common rate only once tau = 4:
        // lower bound 1/(7 + 2*4) = 1/15 = upper bound 2/(38 - 2*4). So tau = 4, rate = 1/15.
        const fit = fitRate([crossing(1, 0, 0), crossing(2, 22, 22), crossing(3, 38, 38), crossing(4, 45, 45)]);
        expect(fit).not.toBeNull();
        const tau = fit?.tau ?? 0;
        const rate = fit?.rate ?? 0;
        expect(tau).toBeGreaterThan(0);
        expect(tau).toBeCloseTo(4, 4);
        expect(rate).toBeCloseTo(1 / 15, 4);
        // Long-span bound (levels 1 -> 4, span 45) widened by tau
        expect(rate).toBeGreaterThanOrEqual(3 / (45 + 2 * tau));
        expect(rate).toBeLessThanOrEqual(3 / (45 - 2 * tau));
        // Between the shortest and longest pair rates
        expect(rate).toBeGreaterThan(1 / 22);
        expect(rate).toBeLessThan(1 / 7);
    });

    it('returns null with fewer than two crossings', () => {
        expect(fitRate([])).toBeNull();
        expect(fitRate([crossing(1, 0, 0)])).toBeNull();
    });

    it('returns null when the crossings sit in different stretches', () => {
        expect(fitRate([crossing(1, 0, 0, 'A'), crossing(2, 30, 30, 'B')])).toBeNull();
    });

    it('returns null for a two-level jump only, which bounds the rate from below but not above', () => {
        // Both levels inside cum 0..10: the spans give a lower bound (1/210 at tau 100) and no upper bound
        expect(fitRate([crossing(6, 0, 10), crossing(7, 0, 10)])).toBeNull();
    });
});

describe('estimateWeeklyPercent', () => {
    it('returns null without a weekly step to calibrate against', () => {
        const samples = [sample(10, 3), sample(12, 3)];
        expect(estimateWeeklyPercent(samples, live(20, 3))).toBeNull();
    });

    it('returns null when the session span is too small to trust the rate', () => {
        const samples = [sample(10, 3), sample(11, 4)];
        expect(estimateWeeklyPercent(samples, live(12, 4))).toBeNull();
    });

    it('uses the crossing midpoints with a stored rate', () => {
        // Crossings: level 4 in cum 0..10 (mid 5), level 5 in cum 20..30 (mid 25). Rate 0.05.
        // Offset = mean(4 - 0.05 * 5, 5 - 0.05 * 25) = 3.75. Live at cum 35: 3.75 + 1.75 = 5.5
        const samples = [sample(0, 3), sample(10, 4), sample(20, 4), sample(30, 5)];
        expect(estimateWeeklyPercent(samples, live(35, 5), storedFit(0.05))).toBeCloseTo(5.5, 5);
    });

    it('needs two real steps before it calibrates without a stored rate', () => {
        const samples = [sample(0, 3), sample(10, 4), sample(20, 4)];
        expect(estimateWeeklyPercent(samples, live(25, 4))).toBeNull();
    });

    it('caps the fraction below the next integer', () => {
        // Crossings: level 2 in cum 0..10, level 3 in cum 20..30. Window rate 1/15 (tau 0).
        // Live far past the last step: the fraction hits the 0.999 cap.
        const samples = [sample(0, 1), sample(10, 2), sample(20, 2), sample(30, 3)];
        const est = estimateWeeklyPercent(samples, live(500, 3));
        expect(est).toBeCloseTo(3.999, 5);
    });

    it('keeps accumulating across a five-hour reset', () => {
        // Block A ends at 30, block B restarts from 0 and reaches 30, then 20 more: cum 30, 30, 50, 60.
        // Level 2 at cum 30 exactly. Level 3 in cum 50..60 (mid 55) is the latest crossing. Stored rate 1/30.
        // Offset anchored on the latest crossing = 3 - 55/30 = 1.16667. Live at cum 75 (block B, session 45):
        // 1.16667 + 75/30 = 3.66667
        const samples = [
            sample(0, 1, BLOCK_A),
            sample(30, 1, BLOCK_A),
            sample(0, 2, BLOCK_B),
            sample(20, 2, BLOCK_B),
            sample(30, 3, BLOCK_B)
        ];
        expect(estimateWeeklyPercent(samples, live(45, 3, BLOCK_B), storedFit(1 / 30))).toBeCloseTo(3.66667, 4);
    });

    it('ignores samples from a previous weekly window', () => {
        const old = '2026-10-10T13:00:00.000+00:00';
        const samples = [sample(10, 9, BLOCK_A, old), sample(20, 9, BLOCK_A, old)];
        expect(estimateWeeklyPercent(samples, live(25, 1))).toBeNull();
    });
});

describe('estimateWeeklyDetail', () => {
    it('uses a stored rate when the live window has only one crossing', () => {
        // Level 4 in cum 0..10 (mid 5): offset = 4 - 0.05 * 5 = 3.75. Live at cum 15: 3.75 + 0.75 = 4.5
        const samples = [sample(0, 3), sample(10, 4)];
        const est = estimateWeeklyDetail(samples, live(15, 4), storedFit(0.05));
        expect(est?.value).toBeCloseTo(4.5, 5);
        expect(est?.rateSource).toBe('stored');
        expect(est?.rate).toBe(0.05);
    });

    it('returns null with one crossing and no stored rate', () => {
        const samples = [sample(0, 3), sample(10, 4)];
        expect(estimateWeeklyDetail(samples, live(15, 4), null)).toBeNull();
    });

    it('returns null when the live stretch has no crossing', () => {
        // Block A ends 80 min after the last block-A sample (lossy), so the live reading starts a
        // new stretch at block B with no weekly step in it
        const samples = [row(at(0), 0, 3), row(at(10), 10, 4)];
        expect(estimateWeeklyDetail(samples, live(5, 4, BLOCK_B), storedFit(0.05))).toBeNull();
    });

    it('ignores a stored rate that is not a positive finite number', () => {
        // Window rate 1/15 (tau 0). Latest crossing level 3 in cum 20..30 (mid 25):
        // offset = 3 - 25/15 = 1.33333. Live at cum 35: 1.33333 + 35/15 = 3.66667 (fraction 0.66667 after API 3)
        const samples = [sample(0, 1), sample(10, 2), sample(20, 2), sample(30, 3)];
        const est = estimateWeeklyDetail(samples, live(35, 3), storedFit(0));
        expect(est?.rateSource).toBe('window');
        expect(est?.rate).toBeCloseTo(1 / 15, 4);
        expect(est?.value).toBeCloseTo(3.66667, 4);
    });

    it('caps the stored-rate fraction below the next integer', () => {
        // Offset = mean(2 - 0.05 * 5, 3 - 0.05 * 15) = 2.0. Live at cum 500 hits the 0.999 cap
        const samples = [sample(0, 1), sample(10, 2), sample(20, 3)];
        const est = estimateWeeklyDetail(samples, live(500, 3), storedFit(0.05));
        expect(est?.value).toBeCloseTo(3.999, 5);
    });

    it('clamps the fraction at zero so the value never drops below the API weekly', () => {
        // Level 5 in cum 0..10 (mid 5), level 6 at cum 10 (live step). Stored rate 0.05.
        // Offset = mean(5 - 0.25, 6 - 0.5) = 5.125. Live cum 10: 5.125 + 0.5 - 6 = -0.375 -> clamped to 0
        const samples = [row(at(0), 0, 4), row(at(10), 10, 5)];
        const est = estimateWeeklyDetail(samples, live(10, 6), storedFit(0.05));
        expect(est?.value).toBe(6);
    });

    it('falls back to the live window rate and reports it as window', () => {
        // Window crossings: level 2 in cum 0..10, level 3 in cum 20..30. Rate 1/15 (tau 0).
        const samples = [sample(0, 1), sample(10, 2), sample(20, 2), sample(30, 3)];
        // Offset anchored on the latest crossing (level 3, cum 20..30, mid 25) = 3 - 25/15 = 1.33333.
        // Live at cum 35: 1.33333 + 35/15 = 3.66667
        const est = estimateWeeklyDetail(samples, live(35, 3), null);
        expect(est?.rateSource).toBe('window');
        expect(est?.rate).toBeCloseTo(1 / 15, 4);
        expect(est?.value).toBeCloseTo(3.66667, 4);
    });

    it('prefers the stored rate over the window rate', () => {
        // Stored 0.05: offset 1.75, live at cum 30: 1.75 + 1.5 - 3 = 0.25 -> 3.25.
        // The window rate 1/15 would give 3.5.
        const samples = [sample(0, 1), sample(10, 2), sample(20, 2), sample(30, 3)];
        const est = estimateWeeklyDetail(samples, live(30, 3), storedFit(0.05));
        expect(est?.rateSource).toBe('stored');
        expect(est?.value).toBeCloseTo(3.25, 5);
    });

    it('ignores pre-change points for the window fit after a limit change', () => {
        // Old limit: rate 0.1 (weekly 3 -> 4 -> 5 every 10 session %). Then the weekly value drops
        // to 0 inside the same window and block, and the new limit steps every 3 session %.
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(20), 20, 4),
            row(at(30), 30, 5),
            row(at(40), 30, 0),
            row(at(50), 33, 1),
            row(at(60), 36, 2),
            row(at(70), 39, 3)
        ];
        const est = estimateWeeklyDetail(samples, live(41, 3), null);
        expect(est?.rateSource).toBe('window');
        expect(est?.rate).toBeGreaterThan(0.25);
    });

    it('does not treat a live weekly that lags the last sample as a limit change', () => {
        // Steady crossings (weekly 3 -> 4 -> 5), but the live reading still says 4 (cache behind the sampler)
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(20), 20, 4),
            row(at(30), 30, 5)
        ];
        const est = estimateWeeklyDetail(samples, live(32, 4), null);
        expect(est).not.toBeNull();
        expect(est?.value).toBeGreaterThanOrEqual(4);
        expect(est?.value).toBeLessThan(5);
    });

    it('anchors on the latest crossing, not the stretch mean', () => {
        // One stretch. Levels 4..9 step at cum 0, 18, 34, 45, 54 and 61..62 (level 9 is the last,
        // cLo 61, cHi 62, mid 61.5). Stored rate 0.0806 (real 2026-10-11 data).
        // Offset anchored on the latest crossing = 9 - 0.0806 * 61.5 = 4.04310.
        // Live at cum 65: 4.04310 + 0.0806 * 65 = 9.28210, i.e. 9 + 0.0806 * (65 - 61.5).
        // A mean over all six crossings would sit lower and clamp to 9.0 here.
        const samples = [
            row(at(0), 0, 3),
            row(at(1), 0, 4),
            row(at(2), 18, 4),
            row(at(3), 18, 5),
            row(at(4), 34, 5),
            row(at(5), 34, 6),
            row(at(6), 45, 6),
            row(at(7), 45, 7),
            row(at(8), 54, 7),
            row(at(9), 54, 8),
            row(at(10), 61, 8),
            row(at(11), 62, 9)
        ];
        const fit: RateFit = { rate: 0.0806, tau: 6.6, crossings: 6 };
        const est = estimateWeeklyDetail(samples, live(65, 9), fit);
        expect(est?.rateSource).toBe('stored');
        expect(est?.value).toBeCloseTo(9 + 0.0806 * (65 - 61.5), 3);
        expect(est?.value).toBeGreaterThan(9);
    });
});

const FIXTURE = fileURLToPath(new URL('./fixtures/usage-samples-2026-10-11.jsonl', import.meta.url));

// The live reading that stands for the sample at index i
function liveOf(s: UsageSample): Omit<UsageSample, 'ts'> {
    return { session: s.session, sessionResetAt: s.sessionResetAt, weekly: s.weekly, weeklyResetAt: s.weeklyResetAt };
}

describe('real sample fixture (weekly reset 2026-10-17T13:00)', () => {
    const samples = parseSampleLines(readFileSync(FIXTURE, 'utf8'));

    it('extracts crossings for levels 4, 5, 6 and 7', () => {
        const levels = extractCrossings(samples).map(c => c.level);
        expect(levels).toEqual(expect.arrayContaining([4, 5, 6, 7]));
    });

    it('fits a finite rate between 1/25 and 1/5 with tau >= 0', () => {
        const fit = fitRate(extractCrossings(samples));
        expect(fit).not.toBeNull();
        expect(Number.isFinite(fit?.rate)).toBe(true);
        expect(fit?.rate).toBeGreaterThan(1 / 25);
        expect(fit?.rate).toBeLessThan(1 / 5);
        expect(fit?.tau).toBeGreaterThanOrEqual(0);
    });

    it('estimates just before the 6 -> 7 step at >= 6 and < 7', () => {
        // Replay: the last reading before weekly became 7 is the live reading; history is everything before it
        const step = samples.findIndex(s => s.weekly === 7);
        expect(step).toBeGreaterThan(0);
        const last = samples[step - 1];
        expect(last).toBeDefined();
        if (last === undefined)
            return;
        const est = estimateWeeklyPercent(samples.slice(0, step - 1), liveOf(last), null);
        expect(est).not.toBeNull();
        expect(est).toBeGreaterThanOrEqual(6);
        expect(est).toBeLessThan(7);
    });
});

const FIXTURE_LIMIT_CHANGE = fileURLToPath(new URL('./fixtures/usage-samples-2026-10-21.jsonl', import.meta.url));

// Max 5 -> Max 20 switch on 2026-10-21: the weekly value dropped 99 -> 0 with the same reset time.
// The fixture covers 05:00-10:58 on 2026-10-21.
describe('real sample fixture (plan change 2026-10-21)', () => {
    const load = (): UsageSample[] => parseSampleLines(readFileSync(FIXTURE_LIMIT_CHANGE, 'utf8'));
    const now = new Date('2026-10-21T11:00:00.000Z');

    it('finds the limit change at the 08:57:23 sample', () => {
        const samples = load();
        expect(latestLimitChange(samples)?.startsWith('2026-10-21T08:57:23')).toBe(true);
    });

    it('rebases the fit onto the Max 20 rate, where the unrebased fit stays on the Max 5 rate', () => {
        const samples = load();
        const crossings = extractCrossings(samples);
        const rebased = mergeCrossings(null, crossings, now, latestLimitChange(samples));
        const mixed = mergeCrossings(null, crossings, now);
        expect(rebased.fit?.rate).toBeGreaterThan(0.25);
        // Measured on this fixture: rebased 0.333, unrebased 0.143
        expect(mixed.fit?.rate).toBeLessThan((rebased.fit?.rate ?? 0) / 1.5);
    });
});
