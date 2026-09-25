import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { getSessionEntry } from '../utils/session-registry';

export class AgentAddressWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows the name other Claude Code sessions use to message this session'; }
    getDisplayName(): string { return 'Agent Address'; }
    getCategory(): string { return 'Session'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'my-project-a1' : 'Chat ref: my-project-a1';
        }

        const sessionId = context.data?.session_id;
        if (!sessionId) {
            return null;
        }

        const entry = getSessionEntry(sessionId);
        const name = entry?.name;
        // A name identical to the session title is already shown in the prompt
        // border, so repeating it adds nothing. Only distinct refs are shown.
        // session_name is the title from the payload; nameSource 'user' covers
        // payloads that predate that field.
        if (!name || name === context.data?.session_name || entry.nameSource === 'user') {
            return null;
        }

        const mobile = (context.terminalWidth ?? 0) > 0 && (context.terminalWidth ?? 0) < 192;
        if (mobile) {
            return `R: ${name}`;
        }

        return item.rawValue ? name : `Chat ref: ${name}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
