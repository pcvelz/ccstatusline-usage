import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { preRenderAllWidgets } from '../renderer';

const offPeakWidget: WidgetItem = { id: 'off-peak', type: 'off-peak' };

function renderOffPeakForModel(modelId: string | undefined): string {
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: 200,
        data: modelId ? { model: { id: modelId } } : undefined
    };
    const [line] = preRenderAllWidgets([[offPeakWidget]], DEFAULT_SETTINGS, context);
    return line?.[0]?.content ?? '';
}

describe('renderer provider gate (getSupportedProviders)', () => {
    it('renders Off-peak widget for Anthropic models', () => {
        const out = renderOffPeakForModel('claude-opus-4-7');
        expect(out).toMatch(/Peak|Off-peak/);
    });

    it('hides Off-peak widget for Kimi (opencode provider)', () => {
        const out = renderOffPeakForModel('kimi-for-coding');
        expect(out).toBe('');
    });

    it('hides Off-peak widget for GLM (opencode provider)', () => {
        const out = renderOffPeakForModel('glm-4.6');
        expect(out).toBe('');
    });

    it('hides Off-peak widget when model id is missing (null provider)', () => {
        const out = renderOffPeakForModel(undefined);
        expect(out).toBe('');
    });

    it('renders Off-peak widget in preview mode regardless of provider', () => {
        const context: RenderContext = {
            isPreview: true,
            terminalWidth: 200,
            data: { model: { id: 'kimi-for-coding' } }
        };
        const [line] = preRenderAllWidgets([[offPeakWidget]], DEFAULT_SETTINGS, context);
        expect(line?.[0]?.content ?? '').toMatch(/Off-peak/);
    });
});
