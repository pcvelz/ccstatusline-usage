import {
    describe,
    expect,
    it
} from 'vitest';

import {
    estimateWeeklyDetail,
    estimateWeeklyPercent,
    extractObservations,
    isUsageSample,
    parseSampleLines,
    type UsageSample
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

describe('extractObservations', () => {
    it('emits a rate for a clean two-step interval', () => {
        // Steps at session 10 (3 -> 4) and session 30 (4 -> 5): one step pair, span 20
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(20), 20, 4),
            row(at(30), 30, 5)
        ];
        const observations = extractObservations(samples);
        expect(observations).toHaveLength(1);
        expect(observations[0]).toMatchObject({
            at: at(30),
            weeklyResetAt: WEEK,
            fromWeekly: 4,
            toWeekly: 5,
            sessionSpan: 20
        });
        expect(observations[0]?.rate).toBeCloseTo(1 / 20, 10);
    });

    it('emits nothing when a lossy reset sits inside the interval', () => {
        // The last block-A sample is 80 min before block A ends, so the tail was never seen
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(20), 30, 4),
            row(at(105), 0, 4, BLOCK_B),
            row(at(115), 20, 5, BLOCK_B)
        ];
        expect(extractObservations(samples)).toEqual([]);
    });

    it('includes an interval whose reset is not lossy and accumulates span across it', () => {
        // Last block-A sample is 3 min before block A ends: not lossy. Session 15 + reset (0) + 10 = 25
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 10, 4),
            row(at(97), 25, 4),
            row(at(102), 0, 4, BLOCK_B),
            row(at(115), 10, 5, BLOCK_B)
        ];
        const observations = extractObservations(samples);
        expect(observations).toHaveLength(1);
        expect(observations[0]).toMatchObject({ at: at(115), fromWeekly: 4, toWeekly: 5, sessionSpan: 25 });
        expect(observations[0]?.rate).toBeCloseTo(1 / 25, 10);
    });

    it('returns observations from two weekly windows, ordered by at', () => {
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
        const observations = extractObservations([...window2, ...window1]);
        expect(observations.map(o => o.at)).toEqual([at(30), at(230)]);
        expect(observations.map(o => o.weeklyResetAt)).toEqual([WEEK, WEEK2]);
    });

    it('emits nothing when the session span is below the minimum', () => {
        const samples = [
            row(at(0), 0, 3),
            row(at(10), 2, 4),
            row(at(20), 4, 5)
        ];
        expect(extractObservations(samples)).toEqual([]);
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

    it('interpolates between integer weekly steps using session progress', () => {
        // Steps at cum 10 (3 -> 4) and cum 30 (4 -> 5). Rate = 1 / 20. Live at cum 35:
        // 5 + (35 - 30) / 20 = 5.25
        const samples = [sample(0, 3), sample(10, 4), sample(20, 4), sample(30, 5)];
        expect(estimateWeeklyPercent(samples, live(35, 5))).toBeCloseTo(5.25, 5);
    });

    it('needs two real steps before it calibrates without a stored rate', () => {
        const samples = [sample(0, 3), sample(10, 4), sample(20, 4)];
        expect(estimateWeeklyPercent(samples, live(25, 4))).toBeNull();
    });

    it('caps the fraction below the next integer', () => {
        // Steps at cum 0 -> 10 (1 -> 2) and cum 20 (2 -> 3); rate 1/10. Live far past the step.
        const samples = [sample(0, 1), sample(10, 2), sample(20, 3)];
        const est = estimateWeeklyPercent(samples, live(500, 3));
        expect(est).toBeGreaterThanOrEqual(3);
        expect(est).toBeLessThan(4);
    });

    it('keeps accumulating across a five-hour reset', () => {
        // Block A ends at 30, block B restarts from 0 and reaches 20: cum = 50
        // Step 1 -> 2 at cum 30 (block A ends at 30, block B starts). Step 2 -> 3 at cum 60.
        // Rate 1/30. Live at cum 75: 3 + 15 / 30 = 3.5
        const samples = [
            sample(0, 1, BLOCK_A),
            sample(30, 1, BLOCK_A),
            sample(0, 2, BLOCK_B),
            sample(20, 2, BLOCK_B),
            sample(30, 3, BLOCK_B)
        ];
        expect(estimateWeeklyPercent(samples, live(45, 3, BLOCK_B))).toBeCloseTo(3.5, 5);
    });

    it('ignores samples from a previous weekly window', () => {
        const old = '2026-10-10T13:00:00.000+00:00';
        const samples = [sample(10, 9, BLOCK_A, old), sample(20, 9, BLOCK_A, old)];
        expect(estimateWeeklyPercent(samples, live(25, 1))).toBeNull();
    });
});

describe('estimateWeeklyDetail', () => {
    it('uses a stored rate when the live window has only one step', () => {
        // Step at cum 10 (3 -> 4), live at cum 15: 4 + 0.05 * 5 = 4.25
        const samples = [sample(0, 3), sample(10, 4)];
        const est = estimateWeeklyDetail(samples, live(15, 4), 0.05);
        expect(est?.value).toBeCloseTo(4.25, 5);
        expect(est?.rateSource).toBe('stored');
        expect(est?.rate).toBe(0.05);
    });

    it('returns null with one step, no stored rate and no observation', () => {
        const samples = [sample(0, 3), sample(10, 4)];
        expect(estimateWeeklyDetail(samples, live(15, 4), null)).toBeNull();
    });

    it('ignores a stored rate that is not a positive finite number', () => {
        const samples = [sample(0, 1), sample(10, 2), sample(20, 3)];
        const est = estimateWeeklyDetail(samples, live(22, 3), 0);
        expect(est?.rateSource).toBe('window');
        expect(est?.rate).toBeCloseTo(0.1, 10);
    });

    it('caps the stored-rate fraction below the next integer', () => {
        // Anchor at cum 20 (step 2 -> 3). Stored rate 0.05 * 480 = 24, capped at 0.999
        const samples = [sample(0, 1), sample(10, 2), sample(20, 3)];
        const est = estimateWeeklyDetail(samples, live(500, 3), 0.05);
        expect(est?.value).toBeCloseTo(3.999, 5);
    });

    it('falls back to the live window rate and reports it as window', () => {
        // Pair (cum 10, cum 20) gives rate 1/10; live at cum 22: 3 + 0.2 = 3.2
        const samples = [sample(0, 1), sample(10, 2), sample(20, 3)];
        const est = estimateWeeklyDetail(samples, live(22, 3), null);
        expect(est?.rateSource).toBe('window');
        expect(est?.rate).toBeCloseTo(0.1, 10);
        expect(est?.value).toBeCloseTo(3.2, 5);
    });

    it('prefers the stored rate over the window rate', () => {
        // Stored 0.2 * 2 session % since the anchor = 3.4
        const samples = [sample(0, 1), sample(10, 2), sample(20, 3)];
        const est = estimateWeeklyDetail(samples, live(22, 3), 0.2);
        expect(est?.rateSource).toBe('stored');
        expect(est?.value).toBeCloseTo(3.4, 5);
    });
});
