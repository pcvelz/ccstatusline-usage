/**
 * Tests for the 3-tier display size behavior (mobile / medium / full).
 *
 * Thresholds (from ApiUsage.tsx / Model.ts / WeeklyPace.ts):
 *   mobile  : terminalWidth < 134
 *   medium  : 134 ≤ terminalWidth < 178
 *   full    : terminalWidth ≥ 178
 */

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
import {
    ContextBarWidget,
    SessionUsageWidget,
    WeeklyUsageWidget
} from '../ApiUsage';
import { ClaudeSessionIdWidget } from '../ClaudeSessionId';
import { ModelWidget } from '../Model';
import { WeeklyPaceWidget } from '../WeeklyPace';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(terminalWidth: number, extra: Partial<RenderContext> = {}): RenderContext {
    return { terminalWidth, ...extra };
}

function makeWindow(elapsedPercent: number): UsageWindowMetrics {
    const durationMs = 7 * 24 * 60 * 60 * 1000;
    const elapsedMs = (elapsedPercent / 100) * durationMs;
    return {
        sessionDurationMs: durationMs,
        elapsedMs,
        remainingMs: durationMs - elapsedMs,
        elapsedPercent,
        remainingPercent: 100 - elapsedPercent
    };
}

// No-op kept for documentation; data is now injected via ctx() usageData field.
function setupApiDataMock(_data: Record<string, unknown>): void {
    // ApiUsage widgets now read from context.usageData — no fs mocking needed.
}

const BASE_ITEM: WidgetItem = { id: 'test', type: 'test' };
const PENDULUM_ITEM: WidgetItem = { id: 'pace', type: 'weekly-pace', metadata: { display: 'pendulum' } };

// ---------------------------------------------------------------------------
// 1. ApiUsage — SessionUsageWidget bar width tiers
// ---------------------------------------------------------------------------

const SESSION_USAGE_DATA = { usageData: { sessionUsage: 50, weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } };

describe('ApiUsage SessionUsageWidget — display size tiers', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        setupApiDataMock({ sessionUsage: 50, weeklyUsage: 50 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mobile (width=60): uses short label "S:" and 4-wide bar (6 chars with brackets)', () => {
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(60, SESSION_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^S:/);
        // Bar enclosed in brackets with exactly 4 fill chars: [ + 4 chars + ]
        expect(result).toMatch(/\[[█░]{4}\]/);
    });

    it('medium (width=150): uses full label "Session:" and 8-wide bar (10 chars with brackets)', () => {
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(150, SESSION_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^Session:/);
        expect(result).toMatch(/\[[█░]{8}\]/);
    });

    it('full (width=200): uses full label "Session:" and 16-wide bar (18 chars with brackets)', () => {
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(200, SESSION_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^Session:/);
        expect(result).toMatch(/\[[█░]{16}\]/);
    });

    it('boundary: width=133 is still mobile', () => {
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(133, SESSION_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).toMatch(/^S:/);
        expect(result).toMatch(/\[[█░]{4}\]/);
    });

    it('boundary: width=134 switches to medium', () => {
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(134, SESSION_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).toMatch(/^Session:/);
        expect(result).toMatch(/\[[█░]{8}\]/);
    });

    it('boundary: width=177 is still medium', () => {
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(177, SESSION_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).toMatch(/^Session:/);
        expect(result).toMatch(/\[[█░]{8}\]/);
    });

    it('boundary: width=178 switches to full', () => {
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(178, SESSION_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).toMatch(/^Session:/);
        expect(result).toMatch(/\[[█░]{16}\]/);
    });
});

// ---------------------------------------------------------------------------
// 2. ApiUsage — WeeklyUsageWidget bar width tiers
// ---------------------------------------------------------------------------

const WEEKLY_USAGE_DATA = { usageData: { sessionUsage: 50, weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } };

describe('ApiUsage WeeklyUsageWidget — display size tiers', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        setupApiDataMock({ sessionUsage: 50, weeklyUsage: 50 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mobile (width=60): uses short label "W:" and 4-wide bar', () => {
        const widget = new WeeklyUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(60, WEEKLY_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^W:/);
        expect(result).toMatch(/\[[█░]{4}\]/);
    });

    it('medium (width=150): uses full label "Weekly:" and 8-wide bar', () => {
        const widget = new WeeklyUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(150, WEEKLY_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^Weekly:/);
        expect(result).toMatch(/\[[█░]{8}\]/);
    });

    it('full (width=200): uses full label "Weekly:" and 16-wide bar', () => {
        const widget = new WeeklyUsageWidget();
        const result = widget.render(BASE_ITEM, ctx(200, WEEKLY_USAGE_DATA), DEFAULT_SETTINGS);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^Weekly:/);
        expect(result).toMatch(/\[[█░]{16}\]/);
    });
});

// ---------------------------------------------------------------------------
// 3. ApiUsage — ContextBarWidget bar width tiers
// ---------------------------------------------------------------------------

const CONTEXT_WINDOW_DATA = {
    context_window: {
        context_window_size: 200000,
        current_usage: {
            input_tokens: 50000,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
        }
    }
};

describe('ApiUsage ContextBarWidget — display size tiers', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mobile (width=60): uses short label "C:" and 4-wide bar, no percentage suffix', () => {
        const widget = new ContextBarWidget();
        const result = widget.render(
            BASE_ITEM,
            ctx(60, { data: CONTEXT_WINDOW_DATA }),
            DEFAULT_SETTINGS
        );
        expect(result).not.toBeNull();
        expect(result).toMatch(/^C:/);
        expect(result).toMatch(/\[[█░]{4}\]/);
        // No "(25%)" suffix in mobile
        expect(result).not.toMatch(/\(\d+%\)/);
    });

    it('medium (width=150): uses full label "Context:" and 8-wide bar with percentage suffix', () => {
        const widget = new ContextBarWidget();
        const result = widget.render(
            BASE_ITEM,
            ctx(150, { data: CONTEXT_WINDOW_DATA }),
            DEFAULT_SETTINGS
        );
        expect(result).not.toBeNull();
        expect(result).toMatch(/^Context:/);
        expect(result).toMatch(/\[[█░]{8}\]/);
        expect(result).toMatch(/\(\d+%\)/);
    });

    it('full (width=200): uses full label "Context:" and 16-wide bar with percentage suffix', () => {
        const widget = new ContextBarWidget();
        const result = widget.render(
            BASE_ITEM,
            ctx(200, { data: CONTEXT_WINDOW_DATA }),
            DEFAULT_SETTINGS
        );
        expect(result).not.toBeNull();
        expect(result).toMatch(/^Context:/);
        expect(result).toMatch(/\[[█░]{16}\]/);
        expect(result).toMatch(/\(\d+%\)/);
    });

    it('returns null when no context_window data is present', () => {
        const widget = new ContextBarWidget();
        const result = widget.render(BASE_ITEM, ctx(200), DEFAULT_SETTINGS);
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 4. WeeklyPaceWidget — pendulum halfWidth tiers
// ---------------------------------------------------------------------------

describe('WeeklyPaceWidget — pendulum bar display size tiers', () => {
    let mockResolveWeeklyUsageWindow: { mockReturnValue: (value: UsageWindowMetrics | null) => void };

    beforeEach(() => {
        vi.restoreAllMocks();
        mockResolveWeeklyUsageWindow = vi.spyOn(usage, 'resolveWeeklyUsageWindow');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mobile (width=60): falls back to text mode even with pendulum item', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const widget = new WeeklyPaceWidget();
        const result = widget.render(
            PENDULUM_ITEM,
            ctx(60, { usageData: { weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } }),
            DEFAULT_SETTINGS
        );
        expect(result).not.toBeNull();
        // No bar brackets expected — text-mode output
        expect(result).not.toMatch(/\[░/);
        // Should contain a day label like D4/7
        expect(result).toMatch(/D\d\/7/);
    });

    it('medium (width=150): pendulum bar with halfWidth=4 → 9 chars inside brackets', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const widget = new WeeklyPaceWidget();
        const result = widget.render(
            PENDULUM_ITEM,
            ctx(150, { usageData: { weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } }),
            DEFAULT_SETTINGS
        );
        expect(result).not.toBeNull();
        // Bar format: halfWidth=4 → 4 left + "|" + 4 right = 9 inner chars
        expect(result).toMatch(/\[[░█|]{9}\]/);
    });

    it('full (width=200): pendulum bar with halfWidth=7 → 15 chars inside brackets', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const widget = new WeeklyPaceWidget();
        const result = widget.render(
            PENDULUM_ITEM,
            ctx(200, { usageData: { weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } }),
            DEFAULT_SETTINGS
        );
        expect(result).not.toBeNull();
        // halfWidth=7 → 7 left + "|" + 7 right = 15 inner chars
        expect(result).toMatch(/\[[░█|]{15}\]/);
    });

    it('boundary: width=133 (mobile) → no pendulum bar', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const widget = new WeeklyPaceWidget();
        const result = widget.render(
            PENDULUM_ITEM,
            ctx(133, { usageData: { weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } }),
            DEFAULT_SETTINGS
        );
        expect(result).not.toMatch(/\[░/);
    });

    it('boundary: width=134 (medium) → pendulum bar with halfWidth=4', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const widget = new WeeklyPaceWidget();
        const result = widget.render(
            PENDULUM_ITEM,
            ctx(134, { usageData: { weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } }),
            DEFAULT_SETTINGS
        );
        expect(result).toMatch(/\[[░█|]{9}\]/);
    });

    it('boundary: width=177 (medium) → pendulum bar with halfWidth=4', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const widget = new WeeklyPaceWidget();
        const result = widget.render(
            PENDULUM_ITEM,
            ctx(177, { usageData: { weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } }),
            DEFAULT_SETTINGS
        );
        expect(result).toMatch(/\[[░█|]{9}\]/);
    });

    it('boundary: width=178 (full) → pendulum bar with halfWidth=7', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const widget = new WeeklyPaceWidget();
        const result = widget.render(
            PENDULUM_ITEM,
            ctx(178, { usageData: { weeklyUsage: 50 }, data: { model: { id: 'claude-sonnet-4-6' } } }),
            DEFAULT_SETTINGS
        );
        expect(result).toMatch(/\[[░█|]{15}\]/);
    });
});

// ---------------------------------------------------------------------------
// 5. ModelWidget — compact in mobile AND medium, full only at ≥178
// ---------------------------------------------------------------------------

describe('ModelWidget — display size tiers', () => {
    const MODEL_DATA = { model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' } };
    const MODEL_CTX = (terminalWidth: number): RenderContext => ctx(terminalWidth, { data: MODEL_DATA });

    it('mobile (width=60): compact format "M: s4.6"', () => {
        const widget = new ModelWidget();
        const result = widget.render(BASE_ITEM, MODEL_CTX(60), DEFAULT_SETTINGS);
        expect(result).toBe('M: s4.6');
    });

    it('medium (width=150): compact format "M: s4.6"', () => {
        const widget = new ModelWidget();
        const result = widget.render(BASE_ITEM, MODEL_CTX(150), DEFAULT_SETTINGS);
        expect(result).toBe('M: s4.6');
    });

    it('full (width=200): full format "Model: Sonnet 4.6"', () => {
        const widget = new ModelWidget();
        const result = widget.render(BASE_ITEM, MODEL_CTX(200), DEFAULT_SETTINGS);
        expect(result).toBe('Model: Sonnet 4.6');
    });

    it('boundary: width=177 (medium) → compact', () => {
        const widget = new ModelWidget();
        const result = widget.render(BASE_ITEM, MODEL_CTX(177), DEFAULT_SETTINGS);
        expect(result).toMatch(/^M:/);
    });

    it('boundary: width=178 (full) → full label', () => {
        const widget = new ModelWidget();
        const result = widget.render(BASE_ITEM, MODEL_CTX(178), DEFAULT_SETTINGS);
        expect(result).toMatch(/^Model:/);
    });
});

// ---------------------------------------------------------------------------
// 6. ClaudeSessionIdWidget — compact in mobile AND medium
// ---------------------------------------------------------------------------

describe('ClaudeSessionIdWidget — display size tiers', () => {
    const SESSION_ID = 'abcdef12-3456-7890-abcd-ef1234567890';

    const SESSION_CTX = (terminalWidth: number): RenderContext => ctx(terminalWidth, { data: { session_id: SESSION_ID } });

    it('mobile (width=60): compact "S: <8chars>"', () => {
        const widget = new ClaudeSessionIdWidget();
        const result = widget.render(BASE_ITEM, SESSION_CTX(60), DEFAULT_SETTINGS);
        expect(result).toBe(`S: ${SESSION_ID.slice(0, 8)}`);
    });

    it('medium (width=150): compact "S: <8chars>"', () => {
        const widget = new ClaudeSessionIdWidget();
        const result = widget.render(BASE_ITEM, SESSION_CTX(150), DEFAULT_SETTINGS);
        expect(result).toBe(`S: ${SESSION_ID.slice(0, 8)}`);
    });

    it('full (width=200): full "Session ID: <full-uuid>"', () => {
        const widget = new ClaudeSessionIdWidget();
        const result = widget.render(BASE_ITEM, SESSION_CTX(200), DEFAULT_SETTINGS);
        expect(result).toBe(`Session ID: ${SESSION_ID}`);
    });

    it('boundary: width=177 (medium) → compact', () => {
        const widget = new ClaudeSessionIdWidget();
        const result = widget.render(BASE_ITEM, SESSION_CTX(177), DEFAULT_SETTINGS);
        expect(result).toMatch(/^S:/);
    });

    it('boundary: width=178 (full) → full label', () => {
        const widget = new ClaudeSessionIdWidget();
        const result = widget.render(BASE_ITEM, SESSION_CTX(178), DEFAULT_SETTINGS);
        expect(result).toMatch(/^Session ID:/);
    });
});
