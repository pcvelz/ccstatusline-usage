import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import type {
    LlamaSwapData,
    SlotWord
} from '../../utils/llama-swap-types';
import {
    ContextBarWidget,
    makePrefillBar
} from '../ApiUsage';

const SESSION = 'aeabe08a-1f98-4e11-8e8d-38f0dff60803';
const ITEM: WidgetItem = { id: 'ctx', type: 'context-bar' };

// The chat's current context is 50k of a 200k window; the prefill has
// processed 20k of those 50k so far. In prefill mode the bar spans the
// chat context (50k = full width), so 20k is 40% of the bar.
function makeContext(overrides: Partial<RenderContext> = {}): RenderContext {
    return {
        data: {
            context_window: {
                context_window_size: 200000,
                current_usage: 50000
            }
        },
        ...overrides
    };
}

function makeLlamaSwapData(word: SlotWord = 'PREFILL', contextUsed = 20000): LlamaSwapData {
    return {
        lane: {
            sessionId: SESSION,
            word,
            model: 'Test-Local',
            contextUsed,
            contextTotal: 50000,
            tokensPerSecond: null,
            at: Date.now()
        },
        fetched: true
    };
}

describe('ContextBarWidget - llama-swap prefill mode', () => {
    it('shows the Prefill label, prefilled/session-context numbers, solid cells and an arrow at the prefill front', () => {
        const context = makeContext({ llamaSwapData: makeLlamaSwapData() });

        const result = new ContextBarWidget().render(ITEM, context, DEFAULT_SETTINGS);

        // 16 cells: 40% prefilled = 6 solid cells, then the front marker.
        expect(result).toBe('Prefill: [██████▶░░░░░░░░░] 20k/50k (40%)');
    });

    it('keeps the arrow inside the chat context when rounding makes the prefill look complete', () => {
        const context = makeContext({ llamaSwapData: makeLlamaSwapData('PREFILL', 49000) });

        const result = new ContextBarWidget().render(ITEM, context, DEFAULT_SETTINGS);

        // 98% rounds to all 16 cells; the arrow takes the last so it stays visible.
        expect(result).toBe('Prefill: [███████████████▶] 49k/50k (98%)');
    });

    it('puts the arrow in the first cell when nothing has been prefilled yet', () => {
        const context = makeContext({ llamaSwapData: makeLlamaSwapData('PREFILL', 0) });

        const result = new ContextBarWidget().render(ITEM, context, DEFAULT_SETTINGS);

        expect(result).toBe('Prefill: [▶░░░░░░░░░░░░░░░] 0k/50k (0%)');
    });

    it('falls back to the Context label and two-character bar when the slot is DECODE', () => {
        const context = makeContext({ llamaSwapData: makeLlamaSwapData('DECODE') });

        const result = new ContextBarWidget().render(ITEM, context, DEFAULT_SETTINGS);

        expect(result).toBe('Context: [████░░░░░░░░░░░░] 50k/200k (25%)');
    });

    it('falls back to the Context label and two-character bar when the slot is PARKED', () => {
        const context = makeContext({ llamaSwapData: makeLlamaSwapData('PARKED') });

        const result = new ContextBarWidget().render(ITEM, context, DEFAULT_SETTINGS);

        expect(result).toBe('Context: [████░░░░░░░░░░░░] 50k/200k (25%)');
    });

    it('falls back to the Context label and two-character bar when there is no llama-swap backend', () => {
        const context = makeContext({ llamaSwapData: null });

        const result = new ContextBarWidget().render(ITEM, context, DEFAULT_SETTINGS);

        expect(result).toBe('Context: [████░░░░░░░░░░░░] 50k/200k (25%)');
    });

    it('uses the P label and the 4-cell bar on a narrow terminal', () => {
        const context = makeContext({
            llamaSwapData: makeLlamaSwapData(),
            terminalWidth: 100
        });

        const result = new ContextBarWidget().render(ITEM, context, DEFAULT_SETTINGS);

        expect(result).toBe('P: [██▶░] 20k/50k');
    });
});

describe('makePrefillBar', () => {
    it('lays out solid cells, the arrow, then empty cells', () => {
        expect(makePrefillBar(25, 8)).toBe('[██▶░░░░░]');
    });

    it('starts with the arrow when nothing is prefilled', () => {
        expect(makePrefillBar(0, 8)).toBe('[▶░░░░░░░]');
    });

    it('never places the arrow past the last cell', () => {
        expect(makePrefillBar(100, 8)).toBe('[███████▶]');
    });

    it('clamps out-of-range shares', () => {
        expect(makePrefillBar(-5, 4)).toBe('[▶░░░]');
        expect(makePrefillBar(250, 4)).toBe('[███▶]');
    });
});
