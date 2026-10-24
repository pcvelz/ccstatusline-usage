import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    SessionUsageWidget,
    WeeklyUsageWidget,
    truncateToDecimals
} from '../ApiUsage';

const BASE_ITEM: WidgetItem = { id: 'test', type: 'test' };

function makeContext(weeklyUsage: number): RenderContext {
    return {
        usageData: { weeklyUsage, sessionUsage: 12 },
        terminalWidth: 200,
        isPreview: false,
        data: { model: { id: 'claude-sonnet-4-6' } }
    };
}

// weeklyEstimate is off here so the render path never reads the estimator's files.
function renderWeekly(weeklyUsage: number, overrides: Partial<Settings>): string | null {
    const settings: Settings = { ...DEFAULT_SETTINGS, weeklyEstimate: false, ...overrides };
    return new WeeklyUsageWidget().render(BASE_ITEM, makeContext(weeklyUsage), settings);
}

describe('truncateToDecimals', () => {
    it('truncates instead of rounding', () => {
        expect(truncateToDecimals(5.996, 2)).toBe(5.99);
        expect(truncateToDecimals(5.96, 1)).toBe(5.9);
        expect(truncateToDecimals(5.999, 1)).toBe(5.9);
    });

    it('survives float error (0.29 * 100 = 28.999...)', () => {
        expect(truncateToDecimals(0.29, 2)).toBe(0.29);
        expect(truncateToDecimals(5.29, 2)).toBe(5.29);
        expect(truncateToDecimals(1.1, 1)).toBe(1.1);
    });
});

describe('WeeklyUsageWidget decimals (estimate off)', () => {
    it('defaults to 1 decimal', () => {
        expect(DEFAULT_SETTINGS.weeklyEstimateDecimals).toBe(1);
        expect(renderWeekly(5, {})).toMatch(/ 5\.0%$/);
    });

    it('prints the integer with 1 decimal at N=1', () => {
        expect(renderWeekly(5, { weeklyEstimateDecimals: 1 })).toMatch(/ 5\.0%$/);
    });

    it('prints the integer with 2 decimals at N=2', () => {
        expect(renderWeekly(5, { weeklyEstimateDecimals: 2 })).toMatch(/ 5\.00%$/);
    });

    it('leaves the Session widget at 1 decimal regardless of the setting', () => {
        const settings: Settings = { ...DEFAULT_SETTINGS, weeklyEstimateDecimals: 2 };
        const out = new SessionUsageWidget().render(BASE_ITEM, makeContext(5), settings);

        expect(out).toMatch(/ 12\.0%$/);
    });
});
