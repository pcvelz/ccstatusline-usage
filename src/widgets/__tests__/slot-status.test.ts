import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import type {
    LaneReadout,
    LlamaSwapData
} from '../../utils/llama-swap-types';
import { SlotStatusWidget } from '../SlotStatus';

const SESSION = 'aeabe08a-1f98-4e11-8e8d-38f0dff60803';

function lane(overrides: Partial<LaneReadout> = {}): LaneReadout {
    return {
        sessionId: SESSION,
        word: 'DECODE',
        model: 'Test-Local-27B-Q5',
        contextUsed: 54_000,
        contextTotal: 106_000,
        tokensPerSecond: 42,
        at: Date.now(),
        ...overrides
    };
}

function data(l: LaneReadout | null, fetched = true): LlamaSwapData {
    return { lane: l, fetched };
}

function ctx(llamaSwapData?: LlamaSwapData): RenderContext {
    return {
        data: { model: { id: 'Test-Local-27B-Q5' }, session_id: SESSION },
        llamaSwapData
    };
}

function render(widget: SlotStatusWidget, item: WidgetItem, context: RenderContext): string | null {
    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('SlotStatusWidget', () => {
    const widget = new SlotStatusWidget();
    const item: WidgetItem = { id: 's1', type: 'slot-status' };

    it('hides when no llama-swap data was prefetched (non-llama backend)', () => {
        expect(render(widget, item, ctx())).toBeNull();
    });

    it('hides when the fetch failed', () => {
        expect(render(widget, item, ctx(data(null, false)))).toBeNull();
    });

    it('shows the live word with State: prefix', () => {
        const result = render(widget, item, ctx(data(lane({ word: 'PREFILL' }))));
        expect(result).toContain('State:');
        expect(result).toContain('PREFILL');
    });

    it('shows DECODE', () => {
        expect(render(widget, item, ctx(data(lane({ word: 'DECODE' }))))).toContain('DECODE');
    });

    it('shows PARKED', () => {
        expect(render(widget, item, ctx(data(lane({ word: 'PARKED' }))))).toContain('PARKED');
    });

    it('shows FLAT', () => {
        expect(render(widget, item, ctx(data(lane({ word: 'FLAT' }))))).toContain('FLAT');
    });

    it('shows TURN for a lane held across a turn boundary', () => {
        expect(render(widget, item, ctx(data(lane({ word: 'TURN' }))))).toContain('TURN');
    });

    it('shows NONE when the session has no in-flight request', () => {
        expect(render(widget, item, ctx(data(lane({ word: 'NONE' }))))).toContain('NONE');
    });

    it('raw value mode drops the prefix', () => {
        const result = render(widget, { ...item, rawValue: true }, ctx(data(lane({ word: 'DECODE' }))));
        expect(result).not.toContain('State:');
        expect(result).toContain('DECODE');
    });

    it('renders a demo in preview mode without data', () => {
        const result = render(widget, item, { ...ctx(), isPreview: true });
        expect(result).toContain('State:');
    });

    it('metadata', () => {
        expect(widget.getDefaultColor()).toBe('green');
        expect(widget.getDisplayName()).toBe('Slot Status');
        expect(widget.getCategory()).toBe('Llama Swap');
        expect(widget.supportsRawValue()).toBe(true);
    });
});
