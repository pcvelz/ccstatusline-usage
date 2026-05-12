/**
 * Tests that ApiUsage widgets (SessionUsage, WeeklyUsage, ResetTimer)
 * read from `context.usageData` — the shared upstream usage pipeline —
 * instead of fetching independently via the legacy `fetchApiData()`.
 *
 * Background: the fork originally shipped its own API fetch in
 * `ApiUsage.tsx` (writing `~/.cache/ccstatusline-api.json`). Later,
 * upstream added `src/utils/usage-fetch.ts` (`fetchUsageData` →
 * `~/.cache/ccstatusline/usage.json`), and `ccstatusline.ts` now
 * populates `context.usageData` from that system. The two caches
 * refresh independently and can drift — most visibly around the weekly
 * reset boundary, where the widget-bar shows stale `weeklyUsage=99%`
 * while `WeeklyPace` (which uses `context.usageData`) already sees the
 * new week and reports "D1/7". See reproduction in session notes.
 *
 * These tests pin the intended behavior: ALL ApiUsage widgets must read
 * `context.usageData` and must ignore any pre-existing content of
 * `~/.cache/ccstatusline-api.json` (the legacy cache file).
 *
 * Strategy: install `fs` mocks that make any call to `fetchApiData()`
 * return a fixed LEGACY value, then pass a deliberately DIFFERENT value
 * via `context.usageData`. A correctly-refactored widget returns the
 * context value; the current (buggy) implementation returns the legacy
 * value — so these tests fail before the fix and pass after.
 *
 * Note: ApiUsage.tsx has a module-level memory cache that we cannot
 * reset (Bun does not expose `vi.resetModules()`). That is fine — each
 * test uses distinctive values so cache pollution cannot produce a
 * false positive. Before the fix, every test fails; after the fix, the
 * memory cache is irrelevant because widgets no longer consult it.
 */

import * as fs from 'fs';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type {
    RenderContext,
    RenderUsageData
} from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    ResetTimerWidget,
    SessionUsageWidget,
    WeeklyUsageWidget
} from '../ApiUsage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_ITEM: WidgetItem = { id: 'test', type: 'test' };

/**
 * Install fs mocks so that `fetchApiData()` (the legacy path) would
 * return `legacyData` if it were ever consulted. The whole point of
 * the refactor is that widgets stop consulting it; these mocks exist
 * only so a regression is loud — the legacy data deliberately
 * contradicts the `context.usageData` each test passes in.
 */
function installLegacyCacheMock(legacyData: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);

    vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike | number) => {
        const pathStr = p.toString();
        if (pathStr.includes('ccstatusline-api.json')) {
            // Fresh mtime so CACHE_MAX_AGE does not invalidate it.
            return { mtimeMs: (now - 1) * 1000 } as fs.Stats;
        }
        throw new Error('ENOENT');
    });

    vi.spyOn(fs, 'readFileSync').mockImplementation((p: fs.PathLike | number) => {
        if (p.toString().includes('ccstatusline-api.json')) {
            return JSON.stringify(legacyData);
        }
        throw new Error('ENOENT');
    });

    // Block any write-back to the real cache file during tests.
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
}

function makeContext(usageData: RenderUsageData | null, extra: Partial<RenderContext> = {}): RenderContext {
    return {
        usageData,
        terminalWidth: 200, // full display size — avoids mobile/medium abbreviation
        isPreview: false,
        data: { model: { id: 'claude-sonnet-4-6' } },
        ...extra
    };
}

// ---------------------------------------------------------------------------
// WeeklyUsageWidget — the widget that first exposed the drift bug
// ---------------------------------------------------------------------------

describe('WeeklyUsageWidget — reads from context.usageData', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the percentage from context.usageData.weeklyUsage, ignoring the legacy fs cache', () => {
        // Legacy cache says 99% (the "stale" value from before the reset).
        installLegacyCacheMock({ sessionUsage: 50, weeklyUsage: 99 });

        // Fresh context data says 2% (the new week after reset).
        const widget = new WeeklyUsageWidget();
        const result = widget.render(BASE_ITEM, makeContext({ weeklyUsage: 2 }), DEFAULT_SETTINGS);

        expect(result).not.toBeNull();
        expect(result).toContain('2.0%');
        expect(result).not.toContain('99');
    });

    it('returns null when context.usageData.weeklyUsage is undefined (no legacy fallback)', () => {
        // Legacy cache has valid data; widget must NOT fall back to it.
        installLegacyCacheMock({ sessionUsage: 50, weeklyUsage: 77 });
        const widget = new WeeklyUsageWidget();
        const result = widget.render(BASE_ITEM, makeContext({}), DEFAULT_SETTINGS);

        expect(result).toBeNull();
    });

    it('propagates context.usageData.error as a formatted error message', () => {
        installLegacyCacheMock({ weeklyUsage: 50 });
        const widget = new WeeklyUsageWidget();
        const result = widget.render(
            BASE_ITEM,
            makeContext({ error: 'rate-limited' }),
            DEFAULT_SETTINGS
        );

        // Must surface a rate-limit message, not silently show legacy 50%.
        expect(result).toBeTruthy();
        expect(result).not.toContain('50');
        expect(result?.toLowerCase()).toMatch(/rate.?limit/);
    });
});

// ---------------------------------------------------------------------------
// SessionUsageWidget
// ---------------------------------------------------------------------------

describe('SessionUsageWidget — reads from context.usageData', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders context.usageData.sessionUsage, ignoring the legacy fs cache', () => {
        installLegacyCacheMock({ sessionUsage: 88, weeklyUsage: 10 });
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, makeContext({ sessionUsage: 17 }), DEFAULT_SETTINGS);

        expect(result).not.toBeNull();
        expect(result).toContain('17.0%');
        expect(result).not.toContain('88');
    });

    it('returns null when context.usageData.sessionUsage is undefined', () => {
        installLegacyCacheMock({ sessionUsage: 88 });
        const widget = new SessionUsageWidget();
        const result = widget.render(BASE_ITEM, makeContext({}), DEFAULT_SETTINGS);

        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// ResetTimerWidget — more complex: renders time OR extra-usage spending
// ---------------------------------------------------------------------------

describe('ResetTimerWidget — reads from context.usageData', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders time remaining based on context.usageData.sessionResetAt', () => {
        // Legacy cache has a completely different resetAt — must be ignored.
        installLegacyCacheMock({
            sessionUsage: 20,
            sessionResetAt: '2020-01-01T00:00:00Z'
        });

        // 2h30m in the future.
        const resetAt = new Date(Date.now() + (2 * 60 + 30) * 60 * 1000).toISOString();
        const widget = new ResetTimerWidget();
        const result = widget.render(
            BASE_ITEM,
            makeContext({ sessionUsage: 20, sessionResetAt: resetAt }),
            DEFAULT_SETTINGS
        );

        expect(result).not.toBeNull();
        // Allow 2:29 or 2:30 depending on sub-second timing.
        expect(result).toMatch(/^2:(29|30) hr$/);
    });

    it('shows weekly reset time when weekly >= 100% (Extra display moves to Weekly bar)', () => {
        installLegacyCacheMock({ extraUsageEnabled: false });

        // Weekly reset is 2h30m in the future.
        const weeklyResetAt = new Date(Date.now() + (2 * 60 + 30) * 60 * 1000).toISOString();
        const widget = new ResetTimerWidget();
        const result = widget.render(
            BASE_ITEM,
            makeContext({
                weeklyUsage: 100,
                sessionResetAt: new Date(Date.now() + 3600_000).toISOString(),
                weeklyResetAt,
                extraUsageEnabled: true,
                extraUsageLimit: 2000, // $20.00
                extraUsageUsed: 500    // $5.00
            }),
            DEFAULT_SETTINGS
        );

        expect(result).not.toBeNull();
        // Extra amounts no longer appear in the timer — they moved to the Weekly bar.
        expect(result).not.toContain('Extra');
        // Timer now shows weekly reset time (allow 2:29 or 2:30 depending on sub-second timing).
        expect(result).toMatch(/^2:(29|30) hr$/);
    });

    it('shows weekly reset time for a charged [1m] (Sonnet) model even when weekly is below 100%', () => {
        installLegacyCacheMock({ extraUsageEnabled: false });

        // Weekly reset is 3h45m in the future.
        const weeklyResetAt = new Date(Date.now() + (3 * 60 + 45) * 60 * 1000).toISOString();
        const widget = new ResetTimerWidget();
        const result = widget.render(
            BASE_ITEM,
            makeContext(
                {
                    weeklyUsage: 10,
                    sessionResetAt: new Date(Date.now() + 3600_000).toISOString(),
                    weeklyResetAt,
                    extraUsageEnabled: true,
                    extraUsageLimit: 3000,
                    extraUsageUsed: 1250
                },
                { data: { model: { id: 'claude-sonnet-4-5[1m]' } } }
            ),
            DEFAULT_SETTINGS
        );

        expect(result).not.toBeNull();
        expect(result).not.toContain('Extra');
        expect(result).toMatch(/^3:(44|45) hr$/);
    });

    it('falls back to session reset time when extra conditions are met but weeklyResetAt is absent', () => {
        installLegacyCacheMock({ extraUsageEnabled: false });

        // Provide a session reset time but no weeklyResetAt.
        const sessionResetAt = new Date(Date.now() + (1 * 60 + 30) * 60 * 1000).toISOString();
        const widget = new ResetTimerWidget();
        const result = widget.render(
            BASE_ITEM,
            makeContext({
                weeklyUsage: 100,
                sessionResetAt,
                extraUsageEnabled: true,
                extraUsageLimit: 2000,
                extraUsageUsed: 500
            }),
            DEFAULT_SETTINGS
        );

        expect(result).not.toBeNull();
        expect(result).not.toContain('Extra');
        // Falls back to session timer.
        expect(result).toMatch(/^1:(29|30) hr$/);
    });

    it('does NOT render extra-usage for Opus [1m] (included in plan) when weekly is below 100%', () => {
        installLegacyCacheMock({ extraUsageEnabled: false });
        const widget = new ResetTimerWidget();
        const resetAt = new Date(Date.now() + (1 * 60 + 15) * 60 * 1000).toISOString();
        const result = widget.render(
            BASE_ITEM,
            makeContext(
                {
                    weeklyUsage: 10,
                    sessionResetAt: resetAt,
                    extraUsageEnabled: true,
                    extraUsageLimit: 3000,
                    extraUsageUsed: 1250
                },
                { data: { model: { id: 'claude-opus-4-7[1m]' } } }
            ),
            DEFAULT_SETTINGS
        );

        // Should fall through to session time display — Opus [1m] is included in plan, not charged.
        expect(result).not.toContain('Extra');
        expect(result).toMatch(/^1:(14|15) hr$/);
    });

    it('surfaces context.usageData.error rather than falling back to legacy cache', () => {
        installLegacyCacheMock({
            sessionUsage: 20,
            sessionResetAt: new Date(Date.now() + 7200_000).toISOString()
        });
        const widget = new ResetTimerWidget();
        const result = widget.render(
            BASE_ITEM,
            makeContext({ error: 'rate-limited' }),
            DEFAULT_SETTINGS
        );

        expect(result).toBeTruthy();
        expect(result?.toLowerCase()).toMatch(/rate.?limit/);
    });
});
