import {
    describe,
    expect,
    it
} from 'vitest';

import {
    SEVEN_DAY_WINDOW_MS,
    getWeeklyPaceSource
} from '../usage-types';
import {
    getUsageErrorMessage,
    makePendulumBar,
    resolveWeeklyPaceResetAt,
    resolveWeeklyPaceWindow
} from '../usage-windows';

describe('getUsageErrorMessage', () => {
    it('returns the rate-limited label', () => {
        expect(getUsageErrorMessage('rate-limited')).toBe('[Rate limited]');
    });
});
describe('makePendulumBar', () => {
    it('shows empty bar with center marker at delta=0', () => {
        expect(makePendulumBar(0)).toBe('[░░░░░░░|░░░░░░░]');
    });

    it('fills right side for positive delta', () => {
        expect(makePendulumBar(50)).toBe('[░░░░░░░|████░░░]');
    });

    it('fills left side for negative delta', () => {
        expect(makePendulumBar(-50)).toBe('[░░░████|░░░░░░░]');
    });

    it('fills full right side at delta=100', () => {
        expect(makePendulumBar(100)).toBe('[░░░░░░░|███████]');
    });

    it('fills full left side at delta=-100', () => {
        expect(makePendulumBar(-100)).toBe('[███████|░░░░░░░]');
    });

    it('clamps delta above 100', () => {
        expect(makePendulumBar(200)).toBe(makePendulumBar(100));
    });

    it('clamps delta below -100', () => {
        expect(makePendulumBar(-200)).toBe(makePendulumBar(-100));
    });

    it('supports custom halfWidth', () => {
        expect(makePendulumBar(50, 4)).toBe('[░░░░|██░░]');
    });

    it('supports custom halfWidth with negative delta', () => {
        expect(makePendulumBar(-50, 4)).toBe('[░░██|░░░░]');
    });
});

describe('weekly pace windows', () => {
    const OVERALL = getWeeklyPaceSource('weekly');
    const FABLE = getWeeklyPaceSource('fable');
    const WEEKLY_RESET = '2026-08-27T16:00:00.000Z';
    const FABLE_RESET = '2026-08-25T16:00:00.000Z';

    it('reads the overall reset for the overall source', () => {
        expect(resolveWeeklyPaceResetAt({ weeklyResetAt: WEEKLY_RESET }, OVERALL)).toBe(WEEKLY_RESET);
    });

    it('prefers the model bucket reset for a per-model source', () => {
        const data = { weeklyResetAt: WEEKLY_RESET, weeklyFableResetAt: FABLE_RESET };
        expect(resolveWeeklyPaceResetAt(data, FABLE)).toBe(FABLE_RESET);
    });

    it('falls back to the overall reset when the model bucket has none', () => {
        expect(resolveWeeklyPaceResetAt({ weeklyResetAt: WEEKLY_RESET }, FABLE)).toBe(WEEKLY_RESET);
    });

    it('returns undefined when neither reset is present', () => {
        expect(resolveWeeklyPaceResetAt({}, FABLE)).toBeUndefined();
    });

    it('builds a window from the model bucket reset', () => {
        const resetAtMs = Date.parse(FABLE_RESET);
        const nowMs = resetAtMs - (SEVEN_DAY_WINDOW_MS / 2);
        const window = resolveWeeklyPaceWindow({ weeklyFableResetAt: FABLE_RESET }, FABLE, nowMs);
        expect(window?.elapsedPercent).toBe(50);
    });

    it('builds the window from the fallback reset when the bucket has none', () => {
        const resetAtMs = Date.parse(WEEKLY_RESET);
        const nowMs = resetAtMs - (SEVEN_DAY_WINDOW_MS / 4);
        const window = resolveWeeklyPaceWindow({ weeklyResetAt: WEEKLY_RESET }, FABLE, nowMs);
        expect(window?.elapsedPercent).toBe(75);
    });

    it('returns null when no reset is available', () => {
        expect(resolveWeeklyPaceWindow({}, FABLE)).toBeNull();
    });
});
