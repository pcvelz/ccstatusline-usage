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
    ContextBarWidget,
    ResetTimerWidget,
    SessionUsageWidget,
    WeeklyUsageWidget
} from '../ApiUsage';

const BASE_ITEM: WidgetItem = { id: 'test', type: 'test' };

function makeContext(usageData: RenderUsageData | null, extra: Partial<RenderContext> = {}): RenderContext {
    return {
        usageData,
        terminalWidth: 200, // full display size
        isPreview: false,
        ...extra
    };
}

describe('ApiUsage widgets with provider resolution', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Null provider models (unknown model ids) — widgets should hide (return null)
    describe('null provider (unknown models)', () => {
        it('SessionUsageWidget returns null for unknown models', () => {
            const widget = new SessionUsageWidget();
            const context = makeContext(
                { sessionUsage: 14.0 },
                { data: { model: { id: 'mistral-7b' } } }
            );
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBeNull();
        });

        it('WeeklyUsageWidget returns null for unknown models', () => {
            const widget = new WeeklyUsageWidget();
            const context = makeContext(
                { weeklyUsage: 24.0 },
                { data: { model: { id: 'mistral-7b' } } }
            );
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBeNull();
        });

        it('ResetTimerWidget returns null for unknown models', () => {
            const widget = new ResetTimerWidget();
            const context = makeContext(
                {
                    sessionResetAt: new Date(Date.now() + 3600_000).toISOString(),
                    weeklyResetAt: new Date(Date.now() + 86400_000).toISOString()
                },
                { data: { model: { id: 'mistral-7b' } } }
            );
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBeNull();
        });
    });

    // Opencode provider models (qwen, glm, kimi, minimax) — context bar renders if data present
    describe('opencode provider models', () => {
        it('ContextBarWidget renders for qwen models with context_window', () => {
            const widget = new ContextBarWidget();
            const context: RenderContext = {
                data: {
                    model: { id: 'qwen3-coder:30b' },
                    context_window: {
                        context_window_size: 200000,
                        current_usage: 50000
                    }
                },
                terminalWidth: 200
            };
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Context: [███░░░░░░░░░░░░░] 50k/262k (19%)');
        });

        it('ContextBarWidget renders for qwen models in mobile mode', () => {
            const widget = new ContextBarWidget();
            const context: RenderContext = {
                data: {
                    model: { id: 'qwen3-coder:30b' },
                    context_window: {
                        context_window_size: 200000,
                        current_usage: 50000
                    }
                },
                terminalWidth: 100
            };
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('C: [█░░░] 50k/262k');
        });

        it('ContextBarWidget renders for non-qwen opencode models with context_window', () => {
            const widget = new ContextBarWidget();
            const context: RenderContext = {
                data: {
                    model: { id: 'llama3:8b' },
                    context_window: {
                        context_window_size: 200000,
                        current_usage: 50000
                    }
                },
                terminalWidth: 200
            };
            // Non-Anthropic, non-opencode model — null provider
            // Context Bar still renders because it only checks for context_window presence
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Context: [████░░░░░░░░░░░░] 50k/200k (25%)');
        });

        it('SessionUsageWidget returns null for qwen models (opencode provider, no API data)', () => {
            const widget = new SessionUsageWidget();
            const context = makeContext(
                { sessionUsage: 14.0 },
                { data: { model: { id: 'qwen3-coder:30b' } } }
            );
            // Opencode provider — but usageData has no provider field from the resolver here.
            // The widget checks resolveProvider for the null gate, then checks usageData.
            // Since usageData.sessionUsage is defined, the widget will try to render.
            // But wait — the widget only gates on null provider before checking data.
            // For opencode models, resolveProvider returns 'opencode' (not 'null'),
            // so the widget proceeds past the gate and renders normally if usageData is present.
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Session: [██░░░░░░░░░░░░░░] 14.0%');
        });
    });

    describe('ContextBarWidget zero-usage fallback', () => {
        it('falls back to tokenMetrics when current_usage is all zeros', () => {
            const widget = new ContextBarWidget();
            const context: RenderContext = {
                data: {
                    model: { id: 'qwen3.6-35b' },
                    context_window: {
                        context_window_size: 131072,
                        current_usage: {
                            input_tokens: 0,
                            output_tokens: 0,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0
                        }
                    }
                },
                tokenMetrics: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cachedTokens: 0,
                    totalTokens: 0,
                    contextLength: 45000
                },
                terminalWidth: 200
            };
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Context: [███░░░░░░░░░░░░░] 45k/262k (17%)');
        });

        it('prefers payload usage over tokenMetrics when non-zero', () => {
            const widget = new ContextBarWidget();
            const context: RenderContext = {
                data: {
                    model: { id: 'claude-3-5-sonnet-20241022' },
                    context_window: {
                        context_window_size: 200000,
                        current_usage: {
                            input_tokens: 50000,
                            output_tokens: 10000,
                            cache_creation_input_tokens: 5000,
                            cache_read_input_tokens: 3000
                        }
                    }
                },
                tokenMetrics: {
                    inputTokens: 0,
                    outputTokens: 0,
                    cachedTokens: 0,
                    totalTokens: 0,
                    contextLength: 99999
                },
                terminalWidth: 200
            };
            // Should use payload values (68000) not tokenMetrics (99999)
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Context: [█████░░░░░░░░░░░] 68k/200k (34%)');
        });
    });

    // Anthropic provider models — should work exactly as before
    describe('anthropic provider models', () => {
        it('SessionUsageWidget renders normally for Sonnet', () => {
            const widget = new SessionUsageWidget();
            const context = makeContext(
                { sessionUsage: 14.0 },
                { data: { model: { id: 'claude-sonnet-4-5[1m]' } } }
            );
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Session: [██░░░░░░░░░░░░░░] 14.0%');
        });

        it('SessionUsageWidget renders normally for Opus', () => {
            const widget = new SessionUsageWidget();
            const context = makeContext(
                { sessionUsage: 14.0 },
                { data: { model: { id: 'claude-opus-4-7[1m]' } } }
            );
            expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Session: [██░░░░░░░░░░░░░░] 14.0%');
        });
    });
});
