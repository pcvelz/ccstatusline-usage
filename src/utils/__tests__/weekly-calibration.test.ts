import {
    existsSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    currentRate,
    mergeObservations,
    pruneSamples,
    readCalibration,
    writeCalibration
} from '../weekly-calibration';
import type { StepObservation } from '../weekly-estimate';

const MIN = 60_000;
const WEEK = '2026-10-17T13:00:00.000+00:00';
const START = Date.parse('2026-10-10T00:00:00.000Z');

// Observation i, one minute apart, with the given rate
function obs(i: number, rate: number): StepObservation {
    return {
        at: new Date(START + i * MIN).toISOString(),
        weeklyResetAt: WEEK,
        fromWeekly: 3,
        toWeekly: 4,
        sessionSpan: 1 / rate,
        rate
    };
}

function range(from: number, to: number, rate: number): StepObservation[] {
    const out: StepObservation[] = [];
    for (let i = from; i < to; i++)
        out.push(obs(i, rate));
    return out;
}

const NOW = new Date('2026-10-10T12:00:00.000Z');

describe('mergeObservations', () => {
    it('dedupes by at with the existing observation winning, and sorts', () => {
        const first = mergeObservations(null, [obs(1, 0.05)], NOW);
        const merged = mergeObservations(first, [obs(1, 0.09), obs(0, 0.05)], NOW);
        expect(merged.observations.map(o => o.at)).toEqual([obs(0, 0).at, obs(1, 0).at]);
        expect(merged.observations[1]?.rate).toBe(0.05);
    });

    it('keeps only the last 50 observations', () => {
        const merged = mergeObservations(null, range(0, 60, 0.05), NOW);
        expect(merged.observations).toHaveLength(50);
        expect(merged.observations[0]?.at).toBe(obs(10, 0).at);
        expect(merged.observations[49]?.at).toBe(obs(59, 0).at);
        expect(merged.version).toBe(1);
        expect(merged.updatedAt).toBe(NOW.toISOString());
    });
});

describe('currentRate', () => {
    it('is null for a missing store or fewer than two observations', () => {
        expect(currentRate(null)).toBeNull();
        expect(currentRate(mergeObservations(null, [obs(0, 0.05)], NOW))).toBeNull();
    });

    it('is the median of the last five rates', () => {
        // Older outliers (0.10) must fall outside the window. The tail does not drift, so no change point.
        const rates = [0.10, 0.10, 0.05, 0.04, 0.06, 0.05, 0.04];
        const store = mergeObservations(null, rates.map((r, i) => obs(i, r)), NOW);
        // Last five: 0.05, 0.04, 0.06, 0.05, 0.04 -> median 0.05
        expect(currentRate(store)).toBeCloseTo(0.05, 10);
    });

    it('averages the two middle rates for an even count', () => {
        const store = mergeObservations(null, [obs(0, 0.02), obs(1, 0.04)], NOW);
        expect(currentRate(store)).toBeCloseTo(0.03, 10);
    });
});

describe('change point', () => {
    // Base rate 0.05, then a real limit change to 0.03 (40% below base).
    // Note: 0.04 is only 20% below 0.05, so it cannot trigger the 25% rule.
    const base = range(0, 5, 0.05);
    const recent = range(5, 8, 0.03);

    it('rebases when the last three rates all deviate more than 25% the same way', () => {
        const store = mergeObservations(null, [...base, ...recent], NOW);
        expect(store.observations).toHaveLength(3);
        expect(currentRate(store)).toBeCloseTo(0.03, 10);
        expect(store.rebasedAt).toBe(NOW.toISOString());
        expect(store.rebaseCutoff).toBe(obs(5, 0).at);
    });

    it('does not resurrect dropped observations when the full list is merged again', () => {
        const rebased = mergeObservations(null, [...base, ...recent], NOW);
        const later = new Date('2026-10-10T13:00:00.000Z');
        const again = mergeObservations(rebased, [...base, ...recent], later);
        expect(again.observations.map(o => o.at)).toEqual(recent.map(o => o.at));
        expect(again.rebasedAt).toBe(NOW.toISOString());
    });

    it('does not rebase when only two of the last three deviate', () => {
        const store = mergeObservations(null, [...base, obs(5, 0.03), obs(6, 0.03), obs(7, 0.05)], NOW);
        expect(store.rebasedAt).toBeNull();
        expect(store.observations).toHaveLength(8);
    });

    it('does not rebase when the deviations go in mixed directions', () => {
        const store = mergeObservations(null, [...base, obs(5, 0.03), obs(6, 0.07), obs(7, 0.03)], NOW);
        expect(store.rebasedAt).toBeNull();
        expect(store.observations).toHaveLength(8);
    });
});

describe('readCalibration / writeCalibration', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'weekly-calibration-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('returns null for a missing file', () => {
        expect(readCalibration(join(dir, 'missing.json'))).toBeNull();
    });

    it('returns null for a corrupt file', () => {
        const file = join(dir, 'corrupt.json');
        writeFileSync(file, '{"version":');
        expect(readCalibration(file)).toBeNull();
    });

    it('returns null for an unknown schema version', () => {
        const file = join(dir, 'v2.json');
        writeFileSync(file, JSON.stringify({ version: 2, observations: [], rebasedAt: null, rebaseCutoff: null, updatedAt: NOW.toISOString() }));
        expect(readCalibration(file)).toBeNull();
    });

    it('round-trips a store and leaves no tmp file behind', () => {
        const file = join(dir, 'weekly-calibration.json');
        const store = mergeObservations(null, [obs(0, 0.05), obs(1, 0.06)], NOW);
        writeCalibration(store, file);
        expect(readCalibration(file)).toEqual(store);
        expect(existsSync(`${file}.tmp`)).toBe(false);
    });

    it('creates a missing directory', () => {
        const file = join(dir, 'nested', 'deeper', 'weekly-calibration.json');
        writeCalibration(mergeObservations(null, [obs(0, 0.05)], NOW), file);
        expect(readCalibration(file)?.observations).toHaveLength(1);
    });
});

describe('pruneSamples', () => {
    const now = new Date('2026-10-11T12:00:00.000Z');
    const recent = JSON.stringify({ ts: '2026-10-11T11:00:00.000Z', session: 1, sessionResetAt: null, weekly: 2, weeklyResetAt: WEEK });
    const old = JSON.stringify({ ts: '2026-09-01T11:00:00.000Z', session: 1, sessionResetAt: null, weekly: 2, weeklyResetAt: WEEK });
    const errorRow = JSON.stringify({ ts: '2026-10-11T11:30:00.000Z', error: 'HTTP 429' });

    it('drops rows older than the retention window and corrupt lines', () => {
        const text = [old, recent, '{"ts":', JSON.stringify({ ts: 'not-a-date' }), errorRow].join('\n') + '\n';
        expect(pruneSamples(text, now)).toBe(`${recent}\n${errorRow}\n`);
    });

    it('returns an empty string when nothing survives', () => {
        expect(pruneSamples(`${old}\n`, now)).toBe('');
    });
});
