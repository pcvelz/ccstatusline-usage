import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import * as fiveHourPlan from '../../utils/five-hour-plan';
import { SessionUsageWidget } from '../ApiUsage';

let observeMock: MockInstance<typeof fiveHourPlan.observeFiveHourPlan>;

const BASE_ITEM: WidgetItem = { id: 'session', type: 'session-usage' };

function item(mode?: string): WidgetItem {
    return mode === undefined ? BASE_ITEM : { ...BASE_ITEM, metadata: { fiveHourDisplay: mode } };
}

function context(overrides: Partial<NonNullable<RenderContext['usageData']>> = {}): RenderContext {
    return {
        usageData: { sessionUsage: 0, weeklyUsage: 12, ...overrides },
        terminalWidth: 200,
        isPreview: false,
        data: { model: { id: 'claude-sonnet-4-6' } }
    };
}

describe('SessionUsageWidget five-hour display mode', () => {
    let widget: SessionUsageWidget;

    beforeEach(() => {
        widget = new SessionUsageWidget();
        vi.restoreAllMocks();
        observeMock = vi.spyOn(fiveHourPlan, 'observeFiveHourPlan').mockReturnValue(false);
    });

    it('defaults to auto: shows the bar while the detector has not judged it unlimited', () => {
        expect(widget.render(item(), context(), DEFAULT_SETTINGS)).toContain('Session');
    });

    it('auto hides the bar once the detector judges the plan to have no 5-hour limit', () => {
        observeMock.mockReturnValue(true);
        expect(widget.render(item(), context(), DEFAULT_SETTINGS)).toBeNull();
    });

    it('feeds every anthropic reading to the detector, weekly then 5-hour', () => {
        widget.render(item(), context({ sessionUsage: 7, weeklyUsage: 30 }), DEFAULT_SETTINGS);
        expect(observeMock).toHaveBeenCalledWith(30, 7);
    });

    it('show mode renders even when the detector judges the plan unlimited', () => {
        observeMock.mockReturnValue(true);
        expect(widget.render(item('show'), context(), DEFAULT_SETTINGS)).toContain('Session');
    });

    it('hide mode never renders', () => {
        expect(widget.render(item('hide'), context({ sessionUsage: 50 }), DEFAULT_SETTINGS)).toBeNull();
    });

    it('treats an unknown mode value as auto', () => {
        observeMock.mockReturnValue(true);
        expect(widget.render(item('bogus'), context(), DEFAULT_SETTINGS)).toBeNull();
    });

    it('does not consult the detector for the preview', () => {
        const result = widget.render(item(), { isPreview: true }, DEFAULT_SETTINGS);
        expect(result).toContain('Session');
        expect(observeMock).not.toHaveBeenCalled();
    });

    it('does not feed the detector readings from a non-anthropic provider', () => {
        const kimi: RenderContext = { ...context({ sessionUsage: 0 }), data: { model: { id: 'k3-pro' } } };
        widget.render(item(), kimi, DEFAULT_SETTINGS);
        expect(observeMock).not.toHaveBeenCalled();
    });

    it('cycles auto -> show -> hide -> auto from the editor action', () => {
        const toShow = widget.handleEditorAction('cycle-five-hour-mode', item());
        expect(toShow?.metadata?.fiveHourDisplay).toBe('show');
        const toHide = widget.handleEditorAction('cycle-five-hour-mode', toShow ?? item());
        expect(toHide?.metadata?.fiveHourDisplay).toBe('hide');
        const toAuto = widget.handleEditorAction('cycle-five-hour-mode', toHide ?? item());
        expect(toAuto?.metadata?.fiveHourDisplay).toBeUndefined();
    });

    it('labels the current mode in the editor, auto by default', () => {
        expect(widget.getEditorDisplay(item()).modifierText).toBe('(auto)');
        expect(widget.getEditorDisplay(item('hide')).modifierText).toBe('(hide)');
    });

    it('offers the mode keybind', () => {
        expect(widget.getCustomKeybinds().map(bind => bind.action)).toContain('cycle-five-hour-mode');
    });
});
