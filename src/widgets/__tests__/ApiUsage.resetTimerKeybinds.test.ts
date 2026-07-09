import {
    describe,
    expect,
    it
} from 'vitest';

import type {
    WidgetEditorProps,
    WidgetItem
} from '../../types/Widget';
import { ResetTimerWidget } from '../ApiUsage';

const baseItem: WidgetItem = { id: 'reset-timer', type: 'reset-timer' };

describe('ResetTimerWidget custom keybinds', () => {
    it('does not advertise the (p)rogress or (s)hort toggles it cannot service', () => {
        // Reset Timer renders a fixed "H:MM hr" value: toggle-progress and toggle-compact
        // are unhandled, and advertising an unhandled action soft-locks the items editor.
        const keys = new ResetTimerWidget().getCustomKeybinds(baseItem).map(kb => kb.key);

        expect(keys).not.toContain('p');
        expect(keys).not.toContain('s');
        // The timestamp toggle IS handled, so it stays.
        expect(keys).toContain('t');
    });

    it('only advertises keybinds it can service, so the editor never soft-locks', () => {
        const widget = new ResetTimerWidget();
        // Cover the default state and the timestamp state, which exposes the extra
        // hour-format / timezone / locale keybinds.
        const dateItem = widget.handleEditorAction('toggle-date', baseItem);
        if (dateItem === null) {
            throw new Error('toggle-date must return an updated widget');
        }

        for (const item of [baseItem, dateItem]) {
            for (const keybind of widget.getCustomKeybinds(item)) {
                const handledInline = widget.handleEditorAction(keybind.action, item) !== null;
                const editorProps: WidgetEditorProps = {
                    widget: item,
                    action: keybind.action,
                    onComplete: () => undefined,
                    onCancel: () => undefined
                };
                const opensEditor = widget.renderEditor(editorProps) !== null;

                expect(
                    handledInline || opensEditor,
                    `keybind "${keybind.key}" (action "${keybind.action}") is advertised but not serviceable`
                ).toBe(true);
            }
        }
    });
});
