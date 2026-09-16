import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import type { LaneReadout } from '../../utils/llama-swap-types';
import { SlotThroughputWidget } from '../SlotThroughput';

const SESSION = 'aeabe08a-1f98-4e11-8e8d-38f0dff60803';

function lane(overrides: Partial<LaneReadout> = {}): LaneReadout {
    return {
        sessionId: SESSION,
        word: 'PREFILL',
        model: 'Test-Local-27B-Q5',
        contextUsed: 54_000,
        contextTotal: 106_000,
        tokensPerSecond: 53.94,
        at: Date.now(),
        ...overrides
    };
}

function ctx(l: LaneReadout | null, fetched = true): RenderContext {
    return {
        data: { model: { id: 'Test-Local-27B-Q5' }, session_id: SESSION },
        llamaSwapData: { lane: l, fetched }
    };
}

function render(widget: SlotThroughputWidget, item: WidgetItem, context: RenderContext): string | null {
    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('SlotThroughputWidget', () => {
    const widget = new SlotThroughputWidget();
    const item: WidgetItem = { id: 't1', type: 'slot-throughput' };

    it('hides when no llama-swap data was prefetched', () => {
        expect(render(widget, item, { data: {} })).toBeNull();
    });

    it('hides when the fetch failed', () => {
        expect(render(widget, item, ctx(null, false))).toBeNull();
    });

    it('shows 0.0 t/s when no rate is truthful (idle/parked state)', () => {
        expect(render(widget, item, ctx(lane({ word: 'NONE', tokensPerSecond: null })))).toBe('Rate: 0.0 t/s');
    });

    it('shows raw 0.0 t/s in raw value mode when idle', () => {
        expect(render(widget, { ...item, rawValue: true }, ctx(lane({ word: 'NONE', tokensPerSecond: null })))).toBe('0.0 t/s');
    });

    it('renders the rate with one decimal', () => {
        expect(render(widget, item, ctx(lane()))).toBe('Rate: 53.9 t/s');
    });

    it('raw value mode drops the prefix', () => {
        expect(render(widget, { ...item, rawValue: true }, ctx(lane()))).toBe('53.9 t/s');
    });

    it('renders a demo in preview mode', () => {
        const result = render(widget, item, { data: {}, isPreview: true });
        expect(result).toContain('t/s');
    });

    it('getNumericValue returns the rate', () => {
        expect(widget.getNumericValue?.(ctx(lane()), item)).toBeCloseTo(53.94);
        expect(widget.getNumericValue?.(ctx(lane({ tokensPerSecond: null })), item)).toBeNull();
    });

    it('metadata', () => {
        expect(widget.getDefaultColor()).toBe('cyan');
        expect(widget.getDisplayName()).toBe('Slot Throughput');
        expect(widget.getCategory()).toBe('Llama Swap');
    });
});
