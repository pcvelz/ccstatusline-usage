import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import type {
    OffHoursConfig,
    Settings
} from '../../types/Settings';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import * as usage from '../../utils/usage';
import type { UsageWindowMetrics } from '../../utils/usage-types';
import { SEVEN_DAY_WINDOW_MS } from '../../utils/usage-types';
import { WeeklyPaceWidget } from '../WeeklyPace';

const BASE_ITEM: WidgetItem = { id: 'pace', type: 'weekly-pace' };
const PENDULUM_ITEM: WidgetItem = { ...BASE_ITEM, metadata: { display: 'pendulum' } };
const SHOW_PERCENT_ITEM: WidgetItem = { ...BASE_ITEM, metadata: { showPercent: 'true' } };

function render(context: RenderContext = {}, item: WidgetItem = BASE_ITEM): string | null {
    return new WeeklyPaceWidget().render(item, context, DEFAULT_SETTINGS);
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

describe('WeeklyPaceWidget', () => {
    let mockResolveWeeklyUsageWindow: { mockReturnValue: (value: UsageWindowMetrics | null) => void };
    let mockGetUsageErrorMessage: { mockReturnValue: (value: string) => void };

    beforeEach(() => {
        vi.restoreAllMocks();
        mockResolveWeeklyUsageWindow = vi.spyOn(usage, 'resolveWeeklyUsageWindow');
        mockGetUsageErrorMessage = vi.spyOn(usage, 'getUsageErrorMessage');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // --- Metadata ---

    it('has category Usage', () => {
        expect(new WeeklyPaceWidget().getCategory()).toBe('Usage');
    });

    it('supports raw value', () => {
        expect(new WeeklyPaceWidget().supportsRawValue()).toBe(true);
    });

    // --- Preview ---

    it('returns preview string in text mode', () => {
        expect(render({ isPreview: true })).toBe('D4/7: On Pace');
    });

    it('returns pendulum bar preview in pendulum mode', () => {
        const result = render({ isPreview: true }, PENDULUM_ITEM);
        expect(result).toBe('Pace: [░░░░░░░|█░░░░░░] D4/7 +10%');
    });

    it('omits label in pendulum preview when rawValue is true', () => {
        const rawItem: WidgetItem = { ...PENDULUM_ITEM, rawValue: true };
        const result = render({ isPreview: true }, rawItem);
        expect(result).toBe('[░░░░░░░|█░░░░░░] D4/7 +10%');
    });

    // --- Null / error guards ---

    it('returns null when usageData is missing', () => {
        expect(render({})).toBeNull();
    });

    it('returns null when usageData is null', () => {
        expect(render({ usageData: null })).toBeNull();
    });

    it('returns error message when usageData has error', () => {
        mockGetUsageErrorMessage.mockReturnValue('[Timeout]');
        expect(render({ usageData: { error: 'timeout' } })).toBe('[Timeout]');
    });

    it('returns null when weeklyUsage is undefined', () => {
        expect(render({ usageData: {} })).toBeNull();
    });

    it('returns null when weekly window cannot be resolved', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(null);
        expect(render({ usageData: { weeklyUsage: 50 } })).toBeNull();
    });

    // --- Day calculation ---

    it('shows D1 at the start of the window', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(0));
        expect(render({ usageData: { weeklyUsage: 0 } })).toMatch(/^D1\/7:/);
    });

    it('shows D4 at ~50% elapsed', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 50 } })).toMatch(/^D4\/7:/);
    });

    it('shows D7 at 100% elapsed', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(100));
        expect(render({ usageData: { weeklyUsage: 100 } })).toMatch(/^D7\/7:/);
    });

    it('shows D7 at 99% elapsed', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(99));
        expect(render({ usageData: { weeklyUsage: 99 } })).toMatch(/^D7\/7:/);
    });

    // --- Pace labels ---

    it('shows On Pace when delta is within ±5%', () => {
        // Day 4/7 ≈ 57.1% elapsed, usage at 60% → delta ≈ +2.9%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(57.14));
        expect(render({ usageData: { weeklyUsage: 60 } })).toBe('D4/7: On Pace');
    });

    it('shows Warm when delta is +6 to +15%', () => {
        // 30% elapsed, 40% usage → delta = +10%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(30));
        expect(render({ usageData: { weeklyUsage: 40 } })).toBe('D3/7: Warm +10%');
    });

    it('shows Overcooking when delta exceeds +15%', () => {
        // Day 2/7 ≈ 28.6% elapsed, usage at 50% → delta ≈ +21.4%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(28.57));
        expect(render({ usageData: { weeklyUsage: 50 } })).toBe('D2/7: Overcooking +21%');
    });

    it('shows Cool when delta is -6 to -15%', () => {
        // 50% elapsed, 40% usage → delta = -10%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 40 } })).toBe('D4/7: Cool -10%');
    });

    it('shows Underusing when delta is below -15%', () => {
        // 85.7% elapsed (day 6/7), usage at 40% → delta ≈ -45.7%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(85.71));
        expect(render({ usageData: { weeklyUsage: 40 } })).toBe('D6/7: Underusing -46%');
    });

    // --- Boundary thresholds ---

    it('shows On Pace at exactly +5% delta', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 55 } })).toBe('D4/7: On Pace');
    });

    it('shows Warm at just over +5% delta', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 55.1 } })).toMatch(/^D4\/7: Warm \+5%$/);
    });

    it('shows Warm at exactly +15% delta', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 65 } })).toBe('D4/7: Warm +15%');
    });

    it('shows Overcooking at just over +15% delta', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 65.1 } })).toMatch(/^D4\/7: Overcooking \+15%$/);
    });

    // --- showPercent metadata ---

    it('shows On Pace with percentage when showPercent is true', () => {
        // 57.14% elapsed, 60% usage → delta ≈ +2.9%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(57.14));
        expect(render({ usageData: { weeklyUsage: 60 } }, SHOW_PERCENT_ITEM)).toBe('D4/7: On Pace +3%');
    });

    it('shows On Pace with negative percentage when showPercent is true', () => {
        // 50% elapsed, 47% usage → delta = -3%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 47 } }, SHOW_PERCENT_ITEM)).toBe('D4/7: On Pace -3%');
    });

    it('shows On Pace +0% when exactly on pace with showPercent', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 50 } }, SHOW_PERCENT_ITEM)).toBe('D4/7: On Pace +0%');
    });

    it('does not affect non-On Pace labels when showPercent is true', () => {
        // 30% elapsed, 40% usage → delta = +10% → Warm
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(30));
        expect(render({ usageData: { weeklyUsage: 40 } }, SHOW_PERCENT_ITEM)).toBe('D3/7: Warm +10%');
    });

    // --- Decimal precision ---

    it('shows 1 decimal place when decimals is 1', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(30));
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '1' } };
        expect(render({ usageData: { weeklyUsage: 40 } }, item)).toBe('D3/7: Warm +10.0%');
    });

    it('shows 2 decimal places when decimals is 2', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(30));
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '2' } };
        expect(render({ usageData: { weeklyUsage: 40 } }, item)).toBe('D3/7: Warm +10.00%');
    });

    it('shows 3 decimal places when decimals is 3', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(30));
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '3' } };
        expect(render({ usageData: { weeklyUsage: 40 } }, item)).toBe('D3/7: Warm +10.000%');
    });

    it('applies decimal precision to Underusing band', () => {
        // 85.71% elapsed (day 6/7), usage at 40% → delta ≈ -45.71%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(85.71));
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '1' } };
        expect(render({ usageData: { weeklyUsage: 40 } }, item)).toBe('D6/7: Underusing -45.7%');
    });

    it('does not show delta on On Pace when decimals set but showPercent absent', () => {
        // 57.14% elapsed, 60% usage → delta ≈ +2.86%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(57.14));
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '2' } };
        expect(render({ usageData: { weeklyUsage: 60 } }, item)).toBe('D4/7: On Pace');
    });

    it('shows fractional delta with decimals and showPercent combined', () => {
        // 57.14% elapsed, 60% usage → delta ≈ +2.86%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(57.14));
        const item: WidgetItem = { ...BASE_ITEM, metadata: { showPercent: 'true', decimals: '2' } };
        expect(render({ usageData: { weeklyUsage: 60 } }, item)).toBe('D4/7: On Pace +2.86%');
    });

    it('applies decimal precision to pendulum bar display', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(30));
        const item: WidgetItem = { ...BASE_ITEM, metadata: { display: 'pendulum', decimals: '1' } };
        const result = render({ usageData: { weeklyUsage: 50 } }, item);
        expect(result).toContain('+20.0%');
    });

    // --- Clamping ---

    it('clamps weeklyUsage above 100 to 100', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: 120 } })).toMatch(/Overcooking \+50%/);
    });

    it('clamps weeklyUsage below 0 to 0', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        expect(render({ usageData: { weeklyUsage: -10 } })).toMatch(/Underusing -50%/);
    });

    // --- rawValue support ---

    it('omits label prefix in text mode when rawValue is true', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const rawItem: WidgetItem = { ...BASE_ITEM, rawValue: true };
        expect(render({ usageData: { weeklyUsage: 50 } }, rawItem)).toBe('D4/7: On Pace');
    });

    it('omits Pace: prefix in pendulum mode when rawValue is true', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const rawItem: WidgetItem = { ...PENDULUM_ITEM, rawValue: true };
        const result = render({ usageData: { weeklyUsage: 60 } }, rawItem);
        expect(result).not.toMatch(/^Pace:/);
        expect(result).toMatch(/^\[/);
    });

    it('includes Pace: prefix in pendulum mode when rawValue is false', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const result = render({ usageData: { weeklyUsage: 60 } }, PENDULUM_ITEM);
        expect(result).toMatch(/^Pace: \[/);
    });

    // --- Pendulum bar rendering ---

    it('renders pendulum bar with positive delta (ahead of pace)', () => {
        // 30% elapsed, 50% usage → delta = +20%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(30));
        const result = render({ usageData: { weeklyUsage: 50 } }, PENDULUM_ITEM);
        expect(result).toMatch(/\[░+\|█+░*\]/);
        expect(result).toContain('D3/7 +20%');
    });

    it('renders pendulum bar with negative delta (behind pace)', () => {
        // 50% elapsed, 30% usage → delta = -20%
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const result = render({ usageData: { weeklyUsage: 30 } }, PENDULUM_ITEM);
        expect(result).toMatch(/\[░*█+\|░+\]/);
        expect(result).toContain('D4/7 -20%');
    });

    it('renders pendulum bar on pace (delta near zero)', () => {
        mockResolveWeeklyUsageWindow.mockReturnValue(makeWindow(50));
        const result = render({ usageData: { weeklyUsage: 50 } }, PENDULUM_ITEM);
        expect(result).toContain('[░░░░░░░|░░░░░░░]');
        expect(result).toContain('D4/7 +0%');
    });

    // --- Pendulum preview ---

    it('shows pendulum bar in preview with positive delta', () => {
        const result = render({ isPreview: true }, PENDULUM_ITEM);
        expect(result).toMatch(/\[░+\|█+░*\]/);
        expect(result).toContain('D4/7 +10%');
    });

    // --- Display mode toggle ---

    it('toggles from text to pendulum mode', () => {
        const widget = new WeeklyPaceWidget();
        const result = widget.handleEditorAction('toggle-pendulum', BASE_ITEM);
        expect(result?.metadata?.display).toBe('pendulum');
    });

    it('toggles from pendulum back to text mode', () => {
        const widget = new WeeklyPaceWidget();
        const result = widget.handleEditorAction('toggle-pendulum', PENDULUM_ITEM);
        expect(result?.metadata?.display).toBe('text');
    });

    it('toggles showPercent on', () => {
        const widget = new WeeklyPaceWidget();
        const result = widget.handleEditorAction('toggle-show-percent', BASE_ITEM);
        expect(result?.metadata?.showPercent).toBe('true');
    });

    it('toggles showPercent off', () => {
        const widget = new WeeklyPaceWidget();
        const result = widget.handleEditorAction('toggle-show-percent', SHOW_PERCENT_ITEM);
        expect(result?.metadata?.showPercent).toBe('false');
    });

    it('cycles decimals from 0 to 1', () => {
        const widget = new WeeklyPaceWidget();
        const result = widget.handleEditorAction('cycle-decimals', BASE_ITEM);
        expect(result?.metadata?.decimals).toBe('1');
    });

    it('cycles decimals from 1 to 2', () => {
        const widget = new WeeklyPaceWidget();
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '1' } };
        const result = widget.handleEditorAction('cycle-decimals', item);
        expect(result?.metadata?.decimals).toBe('2');
    });

    it('cycles decimals from 2 to 3', () => {
        const widget = new WeeklyPaceWidget();
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '2' } };
        const result = widget.handleEditorAction('cycle-decimals', item);
        expect(result?.metadata?.decimals).toBe('3');
    });

    it('cycles decimals from 3 back to 0', () => {
        const widget = new WeeklyPaceWidget();
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '3' } };
        const result = widget.handleEditorAction('cycle-decimals', item);
        expect(result?.metadata?.decimals).toBe('0');
    });

    it('returns null for unknown editor action', () => {
        const widget = new WeeklyPaceWidget();
        expect(widget.handleEditorAction('unknown', BASE_ITEM)).toBeNull();
    });

    // --- Custom keybinds ---

    it('exposes all custom keybinds', () => {
        const widget = new WeeklyPaceWidget();
        const keybinds = widget.getCustomKeybinds();
        expect(keybinds).toEqual([
            { key: 'p', label: '(p)endulum toggle', action: 'toggle-pendulum' },
            { key: '%', label: '(%) always show percent', action: 'toggle-show-percent' },
            { key: '.', label: '(.) decimal precision', action: 'cycle-decimals' }
        ]);
    });

    // --- Editor display ---

    it('shows no modifier text in text mode', () => {
        const widget = new WeeklyPaceWidget();
        const display = widget.getEditorDisplay(BASE_ITEM);
        expect(display.displayText).toBe('Weekly Pace');
        expect(display.modifierText).toBeUndefined();
    });

    it('shows (pendulum bar) modifier text in pendulum mode', () => {
        const widget = new WeeklyPaceWidget();
        const display = widget.getEditorDisplay(PENDULUM_ITEM);
        expect(display.displayText).toBe('Weekly Pace');
        expect(display.modifierText).toBe('(pendulum bar)');
    });

    it('shows (always %) modifier text when showPercent is true', () => {
        const widget = new WeeklyPaceWidget();
        const display = widget.getEditorDisplay(SHOW_PERCENT_ITEM);
        expect(display.displayText).toBe('Weekly Pace');
        expect(display.modifierText).toBe('(always %)');
    });

    it('shows both modifiers when pendulum and showPercent are active', () => {
        const widget = new WeeklyPaceWidget();
        const bothItem: WidgetItem = { ...BASE_ITEM, metadata: { display: 'pendulum', showPercent: 'true' } };
        const display = widget.getEditorDisplay(bothItem);
        expect(display.displayText).toBe('Weekly Pace');
        expect(display.modifierText).toBe('(pendulum bar, always %)');
    });

    it('shows decimal modifier text when decimals is set', () => {
        const widget = new WeeklyPaceWidget();
        const item: WidgetItem = { ...BASE_ITEM, metadata: { decimals: '2' } };
        const display = widget.getEditorDisplay(item);
        expect(display.modifierText).toBe('(.00)');
    });

    it('shows all modifiers combined', () => {
        const widget = new WeeklyPaceWidget();
        const item: WidgetItem = { ...BASE_ITEM, metadata: { display: 'pendulum', showPercent: 'true', decimals: '1' } };
        const display = widget.getEditorDisplay(item);
        expect(display.modifierText).toBe('(pendulum bar, always %, .0)');
    });

    // --- Off-hours integration ---

    /**
     * Build a RenderContext with a real weeklyResetAt and a mocked window.
     * The window's elapsedMs is reconstructed from local-time "now" and the
     * window start (resetAt - 7d), so the widget's off-hours math can
     * reconstruct a consistent nowMs for the adjustment pass.
     */
    function buildPaceContext(opts: {
        windowStartLocal: Date;
        nowLocal: Date;
        weeklyUsage: number;
    }): RenderContext {
        const resetAtMs = opts.windowStartLocal.getTime() + SEVEN_DAY_WINDOW_MS;
        const elapsedMs = opts.nowLocal.getTime() - opts.windowStartLocal.getTime();
        const elapsedPercent = (elapsedMs / SEVEN_DAY_WINDOW_MS) * 100;

        mockResolveWeeklyUsageWindow.mockReturnValue({
            sessionDurationMs: SEVEN_DAY_WINDOW_MS,
            elapsedMs,
            remainingMs: SEVEN_DAY_WINDOW_MS - elapsedMs,
            elapsedPercent,
            remainingPercent: 100 - elapsedPercent
        });

        return {
            usageData: {
                weeklyUsage: opts.weeklyUsage,
                weeklyResetAt: new Date(resetAtMs).toISOString()
            }
        };
    }

    const NIGHT_OFF_HOURS: OffHoursConfig = {
        enabled: true,
        startMinutes: 22 * 60,
        endMinutes: 7 * 60
    };

    function settingsWithOffHours(offHours: OffHoursConfig): Settings {
        return { ...DEFAULT_SETTINGS, offHours };
    }

    it('uses raw elapsed for delta when off-hours is disabled (default)', () => {
        // 3 days into the week: raw elapsed = 3/7 ≈ 42.86%, usage = 50%
        // → delta ≈ +7.14% → Warm
        const windowStart = new Date(2026, 2, 1, 7, 0); // Sun 07:00 local
        const now = new Date(2026, 2, 4, 7, 0);          // Wed 07:00 local
        const ctx = buildPaceContext({ windowStartLocal: windowStart, nowLocal: now, weeklyUsage: 50 });

        const result = new WeeklyPaceWidget().render(BASE_ITEM, ctx, DEFAULT_SETTINGS);
        // 50 - 42.857 ≈ +7.14 → Warm
        expect(result).toMatch(/^D3\/7: Warm \+7%$/);
    });

    it('produces a stable delta across a sleep window when off-hours is enabled', () => {
        // Weekly window: Sun 07:00 local → next Sun 07:00 local
        // Compare "going to sleep" Wed 22:00 vs "waking up" Thu 07:00.
        // Usage stays at 50% both times. With off-hours enabled, the
        // expected% should not drift across the 9-hour sleep → the delta
        // is the same at both timestamps.
        const windowStart = new Date(2026, 2, 1, 7, 0);
        const wedNight = new Date(2026, 2, 4, 22, 0);
        const thuMorning = new Date(2026, 2, 5, 7, 0);
        const usage = 50;

        const ctxNight = buildPaceContext({ windowStartLocal: windowStart, nowLocal: wedNight, weeklyUsage: usage });
        const nightResult = new WeeklyPaceWidget().render(
            { ...BASE_ITEM, metadata: { showPercent: 'true', decimals: '2' } },
            ctxNight,
            settingsWithOffHours(NIGHT_OFF_HOURS)
        );

        const ctxMorning = buildPaceContext({ windowStartLocal: windowStart, nowLocal: thuMorning, weeklyUsage: usage });
        const morningResult = new WeeklyPaceWidget().render(
            { ...BASE_ITEM, metadata: { showPercent: 'true', decimals: '2' } },
            ctxMorning,
            settingsWithOffHours(NIGHT_OFF_HOURS)
        );

        // Extract the delta from each result and verify they match.
        const extractDelta = (s: string | null) => s?.match(/([+-]\d+\.\d+)%/)?.[1];
        expect(nightResult).not.toBeNull();
        expect(morningResult).not.toBeNull();
        expect(extractDelta(nightResult)).toBe(extractDelta(morningResult));
    });

    it('raw (no off-hours) delta DOES drift across the same sleep window', () => {
        // Baseline: without off-hours, the delta naturally shrinks by ~5.36%
        // across 9 hours of sleep. (9h / 168h * 100 ≈ 5.36)
        const windowStart = new Date(2026, 2, 1, 7, 0);
        const wedNight = new Date(2026, 2, 4, 22, 0);
        const thuMorning = new Date(2026, 2, 5, 7, 0);
        const usage = 50;

        const ctxNight = buildPaceContext({ windowStartLocal: windowStart, nowLocal: wedNight, weeklyUsage: usage });
        const nightResult = new WeeklyPaceWidget().render(
            { ...BASE_ITEM, metadata: { showPercent: 'true', decimals: '2' } },
            ctxNight,
            DEFAULT_SETTINGS
        );

        const ctxMorning = buildPaceContext({ windowStartLocal: windowStart, nowLocal: thuMorning, weeklyUsage: usage });
        const morningResult = new WeeklyPaceWidget().render(
            { ...BASE_ITEM, metadata: { showPercent: 'true', decimals: '2' } },
            ctxMorning,
            DEFAULT_SETTINGS
        );

        const extractDelta = (s: string | null) => Number(s?.match(/([+-]\d+\.\d+)%/)?.[1] ?? 'NaN');
        const nightDelta = extractDelta(nightResult);
        const morningDelta = extractDelta(morningResult);

        // Drift is roughly 9h / 168h = 5.36%
        expect(nightDelta - morningDelta).toBeCloseTo(5.36, 1);
    });

    it('still uses wall-clock for the day label regardless of off-hours', () => {
        // Even with off-hours enabled, D<n>/7 tracks calendar progress, not
        // active-hours progress. At Wed 07:00 (3 days elapsed), we still see D3/7.
        const windowStart = new Date(2026, 2, 1, 7, 0);
        const now = new Date(2026, 2, 4, 7, 0);
        const ctx = buildPaceContext({ windowStartLocal: windowStart, nowLocal: now, weeklyUsage: 50 });

        const result = new WeeklyPaceWidget().render(
            BASE_ITEM,
            ctx,
            settingsWithOffHours(NIGHT_OFF_HOURS)
        );
        expect(result).toMatch(/^D3\/7:/);
    });

    it('does not adjust expected% when weeklyResetAt is missing', () => {
        // Gracefully falls back to raw elapsed if we can't parse the window.
        const elapsedPercent = (3 / 7) * 100;
        mockResolveWeeklyUsageWindow.mockReturnValue({
            sessionDurationMs: SEVEN_DAY_WINDOW_MS,
            elapsedMs: 3 * 24 * 60 * 60 * 1000,
            remainingMs: 4 * 24 * 60 * 60 * 1000,
            elapsedPercent,
            remainingPercent: 100 - elapsedPercent
        });
        const ctx: RenderContext = { usageData: { weeklyUsage: 50 } };
        const result = new WeeklyPaceWidget().render(
            BASE_ITEM,
            ctx,
            settingsWithOffHours(NIGHT_OFF_HOURS)
        );
        // Raw 42.86%, usage 50% → delta +7.14% → Warm
        expect(result).toMatch(/^D3\/7: Warm \+7%$/);
    });
});
