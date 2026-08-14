import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

export class ClaudeSessionIdWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows the current Claude Code session ID reported in status JSON'; }
    getDisplayName(): string { return 'Claude Session ID'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'preview-session-id' : 'Session ID: preview-session-id';
        }

        const sessionId = context.data?.session_id;
        if (!sessionId) {
            return null;
        }

        const mobile = (context.terminalWidth ?? 0) > 0 && (context.terminalWidth ?? 0) < 192;
        if (mobile) {
            return `S: ${sessionId.slice(0, 8)}`;
        }

        return item.rawValue ? sessionId : `Session ID: ${sessionId}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
