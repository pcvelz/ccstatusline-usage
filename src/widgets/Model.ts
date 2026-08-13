import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

const MEDIUM_THRESHOLD = 178;

// Parse model ID into compact form: claude-opus-4-7 → o4.7, claude-fable-5 → f5
function compactModelName(name: string): string {
    // Strip claude- prefix and [1m] suffix (caller re-appends the suffix)
    const stripped = name.replace(/^claude-/, '').replace(/\[1m\]/gi, '');
    // Minimal override for vendor-prefixed model ids that the claude-style regex misses.
    if (stripped === 'k3')
        return 'k3';
    // Match: {model-name}-{major}[-minor][-optional-date-suffix]
    const match = /^([a-z]+)-(\d+)(?:-(\d+))?/.exec(stripped);
    if (match) {
        const letter = match[1]?.charAt(0) ?? '';
        return match[3] ? `${letter}${match[2]}.${match[3]}` : `${letter}${match[2]}`;
    }
    return stripped;
}

export class ModelWidget implements Widget {
    getDefaultColor(): string { return 'ansi256:124'; }
    getDescription(): string { return 'Displays the Claude model name (e.g., Claude 3.5 Sonnet)'; }
    getDisplayName(): string { return 'Model'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'Claude' : 'Model: Claude';
        }

        const model = context.data?.model;
        const modelId = typeof model === 'string' ? model : model?.id;
        const modelDisplayName = typeof model === 'string'
            ? model
            : (model?.display_name ?? model?.id);

        if (!modelDisplayName)
            return null;

        const is1m = modelId?.includes('[1m]') ?? false;
        const suffix = is1m ? '[1m]' : '';
        // Strip context size indicators and any trailing parenthetical (e.g. "(1M context)")
        const cleanDisplayName = modelDisplayName
            .replace(/\[1m\]/gi, '')
            .replace(/\s*\(.*\)$/, '')
            .trim();

        const mobile = (context.terminalWidth ?? 0) > 0 && (context.terminalWidth ?? 0) < MEDIUM_THRESHOLD;
        if (mobile && modelId) {
            return `M: ${compactModelName(modelId)}${suffix}`;
        }

        const display = suffix ? `${cleanDisplayName}${suffix}` : cleanDisplayName;
        return item.rawValue ? display : `Model: ${display}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
