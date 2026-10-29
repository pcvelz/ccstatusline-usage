import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import * as usage from '../../utils/usage';
import type { UsageWindowMetrics } from '../../utils/usage-types';
import { WeeklyFableUsageWidget } from '../WeeklyFableUsage';

import { runUsagePercentWidgetSuite } from './helpers/usage-widget-suites';

let mockGetUsageErrorMessage: { mockReturnValue: (value: string) => void };
const usageErrorMessageMock = {
    mockReturnValue(value: string): void {
        mockGetUsageErrorMessage.mockReturnValue(value);
    }
};

const halfElapsedWindow: UsageWindowMetrics = {
    sessionDurationMs: 604800000,
    elapsedMs: 302400000,
    remainingMs: 302400000,
    elapsedPercent: 50,
    remainingPercent: 50
};

function render(widget: WeeklyFableUsageWidget, item: WidgetItem, context: RenderContext = {}): string | null {
    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('WeeklyFableUsageWidget', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockGetUsageErrorMessage = vi.spyOn(usage, 'getUsageErrorMessage');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the time cursor in short bar modes', () => {
        const widget = new WeeklyFableUsageWidget();
        const context: RenderContext = { usageData: { weeklyFableUsage: 20 } };

        vi.spyOn(usage, 'resolveWeeklyFableUsageWindow').mockReturnValue(halfElapsedWindow);

        expect(render(widget, {
            id: 'weekly-fable',
            type: 'weekly-fable-usage',
            metadata: { cursor: 'true', display: 'slider' }
        }, context)).toBe('Fable: ▓▓░░░│░░░░ 20.0%');
        expect(render(widget, {
            id: 'weekly-fable',
            type: 'weekly-fable-usage',
            metadata: { cursor: 'true', display: 'slider-only' }
        }, context)).toBe('Fable: ▓▓░░░│░░░░');
    });

    it('returns null when the per-model usage is missing from the API response', () => {
        const widget = new WeeklyFableUsageWidget();
        expect(render(widget, { id: 'weekly-fable', type: 'weekly-fable-usage' }, { usageData: {} })).toBeNull();
    });

    it('returns null for non-Anthropic usage providers (Kimi has no Fable quota)', () => {
        const widget = new WeeklyFableUsageWidget();
        const context: RenderContext = { usageData: { provider: 'kimi', sessionUsage: 85, weeklyUsage: 55 } };
        expect(render(widget, { id: 'weekly-fable', type: 'weekly-fable-usage' }, context)).toBeNull();
    });

    it('returns null for the opencode usage provider', () => {
        const widget = new WeeklyFableUsageWidget();
        const context: RenderContext = { usageData: { provider: 'opencode', sessionUsage: 10 } };
        expect(render(widget, { id: 'weekly-fable', type: 'weekly-fable-usage' }, context)).toBeNull();
    });

    it('still renders the zero-usage fallback when no provider is set', () => {
        const widget = new WeeklyFableUsageWidget();
        const context: RenderContext = { usageData: { sessionUsage: 85, weeklyUsage: 55 } };
        expect(render(widget, { id: 'weekly-fable', type: 'weekly-fable-usage' }, context)).toBe('Fable: 0.0%');
    });

    runUsagePercentWidgetSuite({
        baseItem: { id: 'weekly-fable', type: 'weekly-fable-usage' },
        createWidget: () => new WeeklyFableUsageWidget(),
        errorMessageMock: usageErrorMessageMock,
        expectedInvertedTime: 'Fable: 57.9%',
        expectedMobileTime: 'F: 42.1%',
        expectedModifierText: '(long bar, remaining)',
        expectedPreviewInvertedTime: 'Fable: 87.0%',
        expectedProgress: 'Fable: [███████████████████░░░░░░░░░░░░░] 57.9%',
        expectedRawProgress: '[███████░░░░░░░░░] 42.1%',
        expectedRawInvertedTime: '57.9%',
        expectedRawTime: '42.1%',
        expectedTime: 'Fable: 42.1%',
        expectedWholePercentTime: 'Fable: 42%',
        modifierItem: {
            id: 'weekly-fable',
            type: 'weekly-fable-usage',
            metadata: { display: 'progress', invert: 'true' }
        },
        progressItem: {
            id: 'weekly-fable',
            type: 'weekly-fable-usage',
            metadata: { display: 'progress', invert: 'true' }
        },
        rawProgressItem: {
            id: 'weekly-fable',
            type: 'weekly-fable-usage',
            rawValue: true,
            metadata: { display: 'progress-short' }
        },
        rawTimeItem: {
            id: 'weekly-fable',
            type: 'weekly-fable-usage',
            rawValue: true
        },
        render,
        usageField: 'weeklyFableUsage',
        usageValue: 42.06
    });
});
