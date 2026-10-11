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
    mergeCrossings,
    pruneSamples,
    readCalibration,
    writeCalibration
} from '../weekly-calibration';
import {
    fitRate,
    type WeeklyCrossing
} from '../weekly-estimate';

const MIN = 60_000;
const WEEK = '2026-10-17T13:00:00.000+00:00';
const START = Date.parse('2026-10-10T00:00:00.000Z');
const NOW = new Date('2026-10-10T12:00:00.000Z');

// Crossing at `minute` after START; cum positions are relative to the stretch 'S'
function crossing(level: number, cLo: number, cHi: number, minute = level, weeklyResetAt = WEEK): WeeklyCrossing {
    return { stretch: 'S', weeklyResetAt, at: new Date(START + minute * MIN).toISOString(), level, cLo, cHi };
}

describe('mergeCrossings', () => {
    it('an incoming crossing replaces a stored one with the same week and level', () => {
        const stored = mergeCrossings(null, [crossing(3, 0, 10, 1), crossing(2, 0, 5, 0)], NOW);
        const merged = mergeCrossings(stored, [crossing(3, 5, 15, 1)], NOW);
        expect(merged.crossings).toEqual([crossing(2, 0, 5, 0), crossing(3, 5, 15, 1)]);
    });

    it('keeps stored crossings that the incoming set no longer covers (pruned samples)', () => {
        const stored = mergeCrossings(null, [crossing(2, 0, 5, 0), crossing(3, 5, 10, 1)], NOW);
        const merged = mergeCrossings(stored, [], NOW);
        expect(merged.crossings).toEqual(stored.crossings);
    });

    it('matches a week by its reset minute, so a jittered reset time replaces the same crossing', () => {
        const stored = mergeCrossings(null, [crossing(3, 0, 10, 1)], NOW);
        const merged = mergeCrossings(stored, [crossing(3, 5, 15, 1, '2026-10-17T13:00:00.429+00:00')], NOW);
        expect(merged.crossings).toHaveLength(1);
        expect(merged.crossings[0]?.cLo).toBe(5);
    });

    it('caps the history at 200 crossings and fits the last 40', () => {
        // Level i+1 at cum 10 * (i+1) in one stretch: every pair spans 10 per level, so the rate is 0.1
        const incoming = Array.from({ length: 250 }, (_, i) => crossing(i + 1, 10 * (i + 1), 10 * (i + 1), i));
        const merged = mergeCrossings(null, incoming, NOW);
        expect(merged.crossings).toHaveLength(200);
        expect(merged.crossings[0]?.level).toBe(51);
        expect(merged.crossings.at(-1)?.level).toBe(250);
        expect(merged.fit).toEqual(fitRate(incoming.slice(-40)));
        expect(merged.fit?.crossings).toBe(40);
        expect(merged.fit?.rate).toBeCloseTo(0.1, 6);
    });

    it('stamps version 2 and updatedAt', () => {
        const merged = mergeCrossings(null, [], NOW);
        expect(merged).toEqual({ version: 2, crossings: [], fit: null, updatedAt: NOW.toISOString() });
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
        const file = join(dir, 'v3.json');
        writeFileSync(file, JSON.stringify({ version: 3, crossings: [], fit: null, updatedAt: NOW.toISOString() }));
        expect(readCalibration(file)).toBeNull();
    });

    it('returns null for a v1 observation store', () => {
        const file = join(dir, 'v1.json');
        writeFileSync(file, JSON.stringify({ version: 1, observations: [] }));
        expect(readCalibration(file)).toBeNull();
    });

    it('round-trips a store and leaves no tmp file behind', () => {
        const file = join(dir, 'weekly-calibration.json');
        // Two exact crossings in one stretch give a fit (rate 1/30), so the fit field round-trips too
        const store = mergeCrossings(null, [crossing(2, 30, 30, 1), crossing(3, 60, 60, 2)], NOW);
        expect(store.fit).not.toBeNull();
        writeCalibration(store, file);
        expect(readCalibration(file)).toEqual(store);
        expect(existsSync(`${file}.tmp`)).toBe(false);
    });

    it('creates a missing directory', () => {
        const file = join(dir, 'nested', 'deeper', 'weekly-calibration.json');
        writeCalibration(mergeCrossings(null, [crossing(1, 0, 0)], NOW), file);
        expect(readCalibration(file)?.crossings).toHaveLength(1);
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
