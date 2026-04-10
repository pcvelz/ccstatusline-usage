import {
    describe,
    expect,
    it
} from 'vitest';

import type { OffHoursConfig } from '../../types/Settings';
import {
    activeHoursPerWeek,
    computeAdjustedExpectedPercent,
    formatHHMM,
    isOffHoursActive,
    MS_PER_DAY,
    MS_PER_HOUR,
    offMsInRange,
    offWindowDurationMinutes,
    parseHHMM
} from '../off-hours';

// Test dates are constructed via `new Date(y, m, d, h, min)` (local-time
// constructor) so these tests are timezone-agnostic. The off-hours math
// operates in local time, and constructing inputs in local time keeps the
// math consistent regardless of where CI runs.

const HOUR = MS_PER_HOUR;
const DAY = MS_PER_DAY;

const OFF_NIGHT: OffHoursConfig = {
    enabled: true,
    startMinutes: 22 * 60, // 22:00
    endMinutes: 7 * 60     // 07:00 next day
};

const OFF_MORNING: OffHoursConfig = {
    enabled: true,
    startMinutes: 2 * 60,  // 02:00
    endMinutes: 10 * 60    // 10:00 same day
};

describe('isOffHoursActive', () => {
    it('returns false when undefined', () => {
        expect(isOffHoursActive(undefined)).toBe(false);
    });

    it('returns false when disabled', () => {
        expect(isOffHoursActive({ ...OFF_NIGHT, enabled: false })).toBe(false);
    });

    it('returns false when start === end (empty window)', () => {
        expect(isOffHoursActive({ enabled: true, startMinutes: 60, endMinutes: 60 })).toBe(false);
    });

    it('returns true for a valid window', () => {
        expect(isOffHoursActive(OFF_NIGHT)).toBe(true);
    });
});

describe('offWindowDurationMinutes', () => {
    it('returns duration for same-day window', () => {
        expect(offWindowDurationMinutes(2 * 60, 10 * 60)).toBe(8 * 60);
    });

    it('returns duration for wrap-past-midnight window', () => {
        expect(offWindowDurationMinutes(22 * 60, 7 * 60)).toBe(9 * 60);
    });

    it('returns 0 when start === end', () => {
        expect(offWindowDurationMinutes(60, 60)).toBe(0);
    });

    it('returns near-full-day for tiny window', () => {
        expect(offWindowDurationMinutes(0, 1439)).toBe(1439);
        expect(offWindowDurationMinutes(1439, 0)).toBe(1);
    });
});

describe('offMsInRange — same-day window', () => {
    it('counts zero when range is entirely outside the off window', () => {
        // Range: 2026-03-01 12:00 → 14:00, window 02:00 → 10:00 → no overlap
        const start = new Date(2026, 2, 1, 12, 0).getTime();
        const end = new Date(2026, 2, 1, 14, 0).getTime();
        expect(offMsInRange(start, end, OFF_MORNING.startMinutes, OFF_MORNING.endMinutes)).toBe(0);
    });

    it('counts the full off window when range fully contains it', () => {
        // Range: 2026-03-01 00:00 → 12:00, window 02:00 → 10:00 = 8h
        const start = new Date(2026, 2, 1, 0, 0).getTime();
        const end = new Date(2026, 2, 1, 12, 0).getTime();
        expect(offMsInRange(start, end, OFF_MORNING.startMinutes, OFF_MORNING.endMinutes)).toBe(8 * HOUR);
    });

    it('counts partial overlap at the left edge', () => {
        // Range: 01:00 → 05:00, window 02:00 → 10:00 → overlap 02:00..05:00 = 3h
        const start = new Date(2026, 2, 1, 1, 0).getTime();
        const end = new Date(2026, 2, 1, 5, 0).getTime();
        expect(offMsInRange(start, end, OFF_MORNING.startMinutes, OFF_MORNING.endMinutes)).toBe(3 * HOUR);
    });

    it('counts partial overlap at the right edge', () => {
        // Range: 08:00 → 14:00, window 02:00 → 10:00 → overlap 08:00..10:00 = 2h
        const start = new Date(2026, 2, 1, 8, 0).getTime();
        const end = new Date(2026, 2, 1, 14, 0).getTime();
        expect(offMsInRange(start, end, OFF_MORNING.startMinutes, OFF_MORNING.endMinutes)).toBe(2 * HOUR);
    });
});

describe('offMsInRange — wrap-midnight window', () => {
    it('counts the portion before midnight only', () => {
        // Range: 21:00 → 23:30, window 22:00 → 07:00 → overlap 22:00..23:30 = 1.5h
        const start = new Date(2026, 2, 1, 21, 0).getTime();
        const end = new Date(2026, 2, 1, 23, 30).getTime();
        expect(offMsInRange(start, end, OFF_NIGHT.startMinutes, OFF_NIGHT.endMinutes)).toBe(1.5 * HOUR);
    });

    it('counts the portion after midnight only', () => {
        // Range: 03:00 → 05:00, window 22:00 prev day → 07:00 → overlap 03:00..05:00 = 2h
        const start = new Date(2026, 2, 2, 3, 0).getTime();
        const end = new Date(2026, 2, 2, 5, 0).getTime();
        expect(offMsInRange(start, end, OFF_NIGHT.startMinutes, OFF_NIGHT.endMinutes)).toBe(2 * HOUR);
    });

    it('counts a window split across midnight', () => {
        // Range: 21:00 Mar 1 → 08:00 Mar 2, window 22:00 → 07:00
        // Overlap = (22:00..24:00) + (00:00..07:00) = 2 + 7 = 9h
        const start = new Date(2026, 2, 1, 21, 0).getTime();
        const end = new Date(2026, 2, 2, 8, 0).getTime();
        expect(offMsInRange(start, end, OFF_NIGHT.startMinutes, OFF_NIGHT.endMinutes)).toBe(9 * HOUR);
    });

    it('counts 9h per full day across a multi-day range', () => {
        // Range: Mar 1 07:00 → Mar 4 07:00 (3 full days), window 22:00 → 07:00 = 9h/day
        const start = new Date(2026, 2, 1, 7, 0).getTime();
        const end = new Date(2026, 2, 4, 7, 0).getTime();
        expect(offMsInRange(start, end, OFF_NIGHT.startMinutes, OFF_NIGHT.endMinutes)).toBe(3 * 9 * HOUR);
    });
});

describe('offMsInRange — edge cases', () => {
    it('returns 0 when startMs >= endMs', () => {
        const t = new Date(2026, 2, 1, 12, 0).getTime();
        expect(offMsInRange(t, t, 60, 120)).toBe(0);
        expect(offMsInRange(t + 1000, t, 60, 120)).toBe(0);
    });

    it('returns 0 when window is empty (start === end)', () => {
        const start = new Date(2026, 2, 1, 0, 0).getTime();
        const end = new Date(2026, 2, 3, 0, 0).getTime();
        expect(offMsInRange(start, end, 60, 60)).toBe(0);
    });
});

describe('computeAdjustedExpectedPercent — disabled / missing off-hours', () => {
    it('returns raw percentage when offHours is undefined', () => {
        const windowStart = new Date(2026, 2, 1, 0, 0).getTime();
        const windowEnd = windowStart + 7 * DAY;
        const now = windowStart + 3 * DAY; // day 3/7 → ~42.86%
        expect(computeAdjustedExpectedPercent(windowStart, windowEnd, now, undefined))
            .toBeCloseTo((3 / 7) * 100, 5);
    });

    it('returns raw percentage when offHours is disabled', () => {
        const windowStart = new Date(2026, 2, 1, 0, 0).getTime();
        const windowEnd = windowStart + 7 * DAY;
        const now = windowStart + 3 * DAY;
        const disabled: OffHoursConfig = { ...OFF_NIGHT, enabled: false };
        expect(computeAdjustedExpectedPercent(windowStart, windowEnd, now, disabled))
            .toBeCloseTo((3 / 7) * 100, 5);
    });
});

describe('computeAdjustedExpectedPercent — stability during sleep', () => {
    it('holds expectedPercent steady across the off-hours window', () => {
        // Weekly window: Sun 07:00 local → next Sun 07:00 local.
        // Off-hours: 22:00 → 07:00.
        // At Wed 22:00 (going to sleep) and Thu 07:00 (waking up), the
        // adjusted expectedPercent should be identical: no active hours
        // elapsed during sleep means no drift.
        const windowStart = new Date(2026, 2, 1, 7, 0).getTime(); // Sun 07:00
        const windowEnd = windowStart + 7 * DAY;

        const wedNight = new Date(2026, 2, 4, 22, 0).getTime();
        const thuMorning = new Date(2026, 2, 5, 7, 0).getTime();

        const pctNight = computeAdjustedExpectedPercent(windowStart, windowEnd, wedNight, OFF_NIGHT);
        const pctMorning = computeAdjustedExpectedPercent(windowStart, windowEnd, thuMorning, OFF_NIGHT);

        expect(pctNight).toBeCloseTo(pctMorning, 5);
    });

    it('raw percentage DOES drift across the same sleep window (baseline check)', () => {
        // Sanity check: without off-hours, raw wall-clock DOES advance during sleep.
        const windowStart = new Date(2026, 2, 1, 7, 0).getTime();
        const windowEnd = windowStart + 7 * DAY;

        const wedNight = new Date(2026, 2, 4, 22, 0).getTime();
        const thuMorning = new Date(2026, 2, 5, 7, 0).getTime();

        const pctNight = computeAdjustedExpectedPercent(windowStart, windowEnd, wedNight, undefined);
        const pctMorning = computeAdjustedExpectedPercent(windowStart, windowEnd, thuMorning, undefined);

        // 9-hour drift across sleep
        expect(pctMorning - pctNight).toBeCloseTo((9 / (7 * 24)) * 100, 3);
    });

    it('adjusted expectedPercent matches raw when off-hours window has 0 duration', () => {
        const windowStart = new Date(2026, 2, 1, 0, 0).getTime();
        const windowEnd = windowStart + 7 * DAY;
        const now = windowStart + 3.5 * DAY;
        const empty: OffHoursConfig = { enabled: true, startMinutes: 600, endMinutes: 600 };
        expect(computeAdjustedExpectedPercent(windowStart, windowEnd, now, empty))
            .toBeCloseTo(50, 5);
    });
});

describe('computeAdjustedExpectedPercent — numerator/denominator scaling', () => {
    it('produces the expected active-hours ratio at the wall-clock midpoint', () => {
        // Window: Sun 00:00 → next Sun 00:00. Midpoint = Wed 12:00 (3.5d).
        // Off-hours 22:00 → 07:00 (9h/day). Total off in 7d window = 63h
        // (7h head of first day from prior-day wrap + 6×9h + 2h tail of last day).
        // Active total = 168 - 63 = 105h.
        //
        // At Wed 12:00 the first 3.5 days contain:
        //   3 full days × (15h active + 9h off) + (Wed 00-07 off + Wed 07-12 active)
        //   = 45h + 5h = 50h active, 27h + 7h = 34h off → 84h wall-clock ✓
        //
        // Adjusted expected % = 50 / 105 ≈ 47.619%. NOT 50% — the window
        // start mid-off-period creates a small asymmetry. This test pins
        // the behavior so we notice if the math regresses.
        const windowStart = new Date(2026, 2, 1, 0, 0).getTime();
        const windowEnd = windowStart + 7 * DAY;
        const now = windowStart + 3.5 * DAY;

        const raw = computeAdjustedExpectedPercent(windowStart, windowEnd, now, undefined);
        const adj = computeAdjustedExpectedPercent(windowStart, windowEnd, now, OFF_NIGHT);

        expect(raw).toBeCloseTo(50, 5);
        expect(adj).toBeCloseTo((50 / 105) * 100, 5);
    });

    it('clamps to 0% before window start', () => {
        const windowStart = new Date(2026, 2, 1, 0, 0).getTime();
        const windowEnd = windowStart + 7 * DAY;
        const before = windowStart - HOUR;
        expect(computeAdjustedExpectedPercent(windowStart, windowEnd, before, OFF_NIGHT)).toBe(0);
    });

    it('clamps to ~100% after window end', () => {
        const windowStart = new Date(2026, 2, 1, 0, 0).getTime();
        const windowEnd = windowStart + 7 * DAY;
        const after = windowEnd + HOUR;
        expect(computeAdjustedExpectedPercent(windowStart, windowEnd, after, OFF_NIGHT))
            .toBeCloseTo(100, 1);
    });

    it('returns 0 for a zero-length window', () => {
        const t = new Date(2026, 2, 1, 0, 0).getTime();
        expect(computeAdjustedExpectedPercent(t, t, t, OFF_NIGHT)).toBe(0);
        expect(computeAdjustedExpectedPercent(t + 1000, t, t, OFF_NIGHT)).toBe(0);
    });
});

describe('activeHoursPerWeek', () => {
    it('returns 168 when offHours is undefined or disabled', () => {
        expect(activeHoursPerWeek(undefined)).toBe(168);
        expect(activeHoursPerWeek({ ...OFF_NIGHT, enabled: false })).toBe(168);
    });

    it('returns 105 for 22:00 → 07:00 (9h off/day)', () => {
        expect(activeHoursPerWeek(OFF_NIGHT)).toBe(105);
    });

    it('returns 112 for 02:00 → 10:00 (8h off/day)', () => {
        expect(activeHoursPerWeek(OFF_MORNING)).toBe(112);
    });

    it('returns 168 when the window is empty (start === end)', () => {
        expect(activeHoursPerWeek({ enabled: true, startMinutes: 60, endMinutes: 60 })).toBe(168);
    });
});

describe('formatHHMM / parseHHMM', () => {
    it('formats zero as 00:00', () => {
        expect(formatHHMM(0)).toBe('00:00');
    });

    it('formats 22:30 correctly', () => {
        expect(formatHHMM(22 * 60 + 30)).toBe('22:30');
    });

    it('formats max (23:59)', () => {
        expect(formatHHMM(1439)).toBe('23:59');
    });

    it('parses "22:30" to 1350', () => {
        expect(parseHHMM('22:30')).toBe(22 * 60 + 30);
    });

    it('parses "7:00" (single-digit hour) to 420', () => {
        expect(parseHHMM('7:00')).toBe(420);
    });

    it('trims whitespace', () => {
        expect(parseHHMM('  22:30  ')).toBe(1350);
    });

    it('rejects malformed strings', () => {
        expect(parseHHMM('22')).toBeNull();
        expect(parseHHMM('22:5')).toBeNull();
        expect(parseHHMM('not-a-time')).toBeNull();
        expect(parseHHMM('25:00')).toBeNull();
        expect(parseHHMM('12:60')).toBeNull();
        expect(parseHHMM('')).toBeNull();
    });

    it('round-trips format → parse → format', () => {
        for (const mins of [0, 60, 120, 420, 720, 1320, 1439]) {
            const parsed = parseHHMM(formatHHMM(mins));
            expect(parsed).toBe(mins);
        }
    });
});