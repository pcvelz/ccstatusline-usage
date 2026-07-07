import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { ContextBarWidget } from '../ApiUsage';

const BASE_ITEM: WidgetItem = { id: 'test', type: 'test' };

// Regression: a live context_window_size explicitly configured by the CLI
// (CLAUDE_CODE_MAX_CONTEXT_TOKENS -> status payload) must beat the
// model-context.json family mapping. Only the CLI's built-in 200000 default
// (the "CLI doesn't actually know" sentinel, e.g. Ollama-served models) may
// fall back to the mapping. Payloads below were captured live on 2026-07-07
// from a locally served Qwen3.6-35B (384K) session where the status line showed
// 262k (qwen3 mapping) while /context correctly showed 393216.
describe('live payload context_window_size precedence', () => {
    it('ContextBarWidget shows the live 393216 window, not the qwen3 mapping', () => {
        const widget = new ContextBarWidget();
        const context: RenderContext = {
            data: {
                model: {
                    id: 'Qwen3.6-35B-A3B-APEX-I-Balanced-384K',
                    display_name: 'Qwen3.6-35B-A3B-APEX-I-Balanced-384K'
                },
                context_window: {
                    context_window_size: 393216,
                    current_usage: {
                        input_tokens: 10835,
                        output_tokens: 0,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 140766
                    }
                }
            },
            terminalWidth: 200
        };
        expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Context: [██████░░░░░░░░░░] 152k/393k (39%)');
    });

    it('ContextBarWidget shows the live window on a fresh session (current_usage null)', () => {
        const widget = new ContextBarWidget();
        const context: RenderContext = {
            data: {
                model: { id: 'Qwen3.6-35B-A3B-APEX-I-Balanced-384K' },
                context_window: {
                    context_window_size: 393216,
                    current_usage: null
                }
            },
            terminalWidth: 200
        };
        expect(widget.render(BASE_ITEM, context, DEFAULT_SETTINGS)).toBe('Context: [░░░░░░░░░░░░░░░░] 0k/393k (0%)');
    });

    it('ContextBarWidget still falls back to the mapping at the 200000 CLI-default sentinel', () => {
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
});
