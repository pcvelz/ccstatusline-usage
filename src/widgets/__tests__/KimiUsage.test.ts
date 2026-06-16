import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import type { Settings } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    KimiMonthlyUsageWidget,
    KimiWeeklyUsageWidget
} from '../KimiUsage';

function makeContext(usageData: object, terminalWidth: number): RenderContext {
    return {
        usageData,
        terminalWidth,
        isPreview: false
    };
}

const settings = {} as Settings;

describe('KimiWeeklyUsageWidget', () => {
    const widget = new KimiWeeklyUsageWidget();
    const item = { id: 'kw', type: 'kimi-weekly-usage' } as WidgetItem;

    it('renders weekly usage at full width', () => {
        const out = widget.render(item, makeContext({ kimiWeeklyUsage: 12.5 }, 200), settings);
        expect(out).toContain('Kimi W:');
        expect(out).toContain('12.5%');
    });

    it('returns null when weekly usage is undefined', () => {
        const out = widget.render(item, makeContext({}, 200), settings);
        expect(out).toBeNull();
    });

    it('uses mobile label on narrow terminals', () => {
        const out = widget.render(item, makeContext({ kimiWeeklyUsage: 12.5 }, 80), settings);
        expect(out).toContain('KW:');
    });
});

describe('KimiMonthlyUsageWidget', () => {
    const widget = new KimiMonthlyUsageWidget();
    const item = { id: 'km', type: 'kimi-monthly-usage' } as WidgetItem;

    it('renders monthly usage at full width', () => {
        const out = widget.render(item, makeContext({ kimiMonthlyUsage: 45.0 }, 200), settings);
        expect(out).toContain('Kimi M:');
        expect(out).toContain('45.0%');
    });

    it('returns null when monthly usage is undefined', () => {
        const out = widget.render(item, makeContext({}, 200), settings);
        expect(out).toBeNull();
    });
});
