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
import type { SessionRegistryEntry } from '../../utils/session-registry';
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

function entry(name: string, nameSource = 'derived'): SessionRegistryEntry {
    return { pid: 1, sessionId: 'some-session-id', name, nameSource };
}

let mockGetSessionEntry: { mockReturnValue: (value: SessionRegistryEntry | null) => void };

describe('AgentAddressWidget', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockGetSessionEntry = vi.spyOn(sessionRegistry, 'getSessionEntry');
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
        expect(mockGetSessionEntry).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('should return null when no registry entry matches', () => {
        mockGetSessionEntry.mockReturnValue(null);
        const result = render('some-session-id');
        expect(result).toBeNull();
    });

    it('should return null when the name equals the payload session_name, and show a distinct one', () => {
        const widget = new AgentAddressWidget();
        const item: WidgetItem = { id: 'agent-address', type: 'agent-address' };
        mockGetSessionEntry.mockReturnValue(entry('my-title'));
        expect(widget.render(item, { data: { session_id: 'some-session-id', session_name: 'my-title' } }, DEFAULT_SETTINGS)).toBeNull();
        mockGetSessionEntry.mockReturnValue(entry('ccstatusline-usage-90'));
        expect(widget.render(item, { data: { session_id: 'some-session-id', session_name: 'my-title' } }, DEFAULT_SETTINGS)).toBe('Chat ref: ccstatusline-usage-90');
    });

    it('should return null when the name is the user-set session title', () => {
        mockGetSessionEntry.mockReturnValue(entry('git-stash guard ignores the session bypass - o5.5', 'user'));
        const result = render('some-session-id', false, false, 100);
        expect(result).toBeNull();
    });

    it('should render Chat ref: <name> normally', () => {
        mockGetSessionEntry.mockReturnValue(entry('my-project-a1'));
        const result = render('some-session-id');
        expect(result).toBe('Chat ref: my-project-a1');
    });

    it('should render bare <name> in rawValue mode', () => {
        mockGetSessionEntry.mockReturnValue(entry('my-project-a1'));
        const result = render('some-session-id', true);
        expect(result).toBe('my-project-a1');
    });

    it('should render R: <name> when terminalWidth is below 192 and above 0', () => {
        mockGetSessionEntry.mockReturnValue(entry('my-project-a1'));
        const result = render('some-session-id', false, false, 100);
        expect(result).toBe('R: my-project-a1');
    });
});
