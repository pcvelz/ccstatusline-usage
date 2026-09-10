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
    WidgetItem
} from '../../types';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import * as sessionRegistry from '../../utils/session-registry';
import { AgentAddressWidget } from '../AgentAddress';

function render(sessionId: string | undefined, rawValue = false, isPreview = false, terminalWidth: number | null = null) {
    const widget = new AgentAddressWidget();
    const context: RenderContext = {
        data: sessionId ? { session_id: sessionId } : undefined,
        isPreview,
        terminalWidth
    };
    const item: WidgetItem = {
        id: 'agent-address',
        type: 'agent-address',
        rawValue
    };

    return widget.render(item, context, DEFAULT_SETTINGS);
}

let mockGetSessionAddress: { mockReturnValue: (value: string | null) => void };

describe('AgentAddressWidget', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockGetSessionAddress = vi.spyOn(sessionRegistry, 'getSessionAddress');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should have session category', () => {
        const widget = new AgentAddressWidget();
        expect(widget.getCategory()).toBe('Session');
    });

    it('should return preview text when in preview mode', () => {
        const result = render('some-session-id', false, true);
        expect(result).toBe('Chat ref: my-project-a1');
    });

    it('should return raw preview text when in preview mode with rawValue', () => {
        const result = render('some-session-id', true, true);
        expect(result).toBe('my-project-a1');
    });

    it('should return null when no session_id', () => {
        const result = render(undefined);
        expect(mockGetSessionAddress).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('should return null when no registry entry matches', () => {
        mockGetSessionAddress.mockReturnValue(null);
        const result = render('some-session-id');
        expect(result).toBeNull();
    });

    it('should render Chat ref: <name> normally', () => {
        mockGetSessionAddress.mockReturnValue('my-project-a1');
        const result = render('some-session-id');
        expect(result).toBe('Chat ref: my-project-a1');
    });

    it('should render bare <name> in rawValue mode', () => {
        mockGetSessionAddress.mockReturnValue('my-project-a1');
        const result = render('some-session-id', true);
        expect(result).toBe('my-project-a1');
    });

    it('should render R: <name> when terminalWidth is below 192 and above 0', () => {
        mockGetSessionAddress.mockReturnValue('my-project-a1');
        const result = render('some-session-id', false, false, 100);
        expect(result).toBe('R: my-project-a1');
    });
});
