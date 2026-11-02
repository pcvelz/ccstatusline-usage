import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import { makeModifierText } from './shared/editor-display';
import {
    isMetadataFlagEnabled,
    removeMetadataKeys,
    toggleMetadataFlag
} from './shared/metadata';
import {
    formatMissAge,
    formatMissCauseBrief,
    getLastUserPromptSeconds,
    getPromptCache
} from './shared/prompt-cache';
import { isCompactWidth } from './shared/usage-display';

const LABEL = 'Last miss: ';
const COMPACT_LABEL = 'CM ';

// Same compact flag, action and (s) keybind as the other compact-capable widgets
const COMPACT_METADATA_KEY = 'compact';
const TOGGLE_COMPACT_ACTION = 'toggle-compact';

// Warn mode is ON unless the metadata says otherwise: absent = on. Same (w)
// keybind, action and red ANSI as CacheTimer's warn mode.
const WARN_METADATA_KEY = 'warn';
const WARN_DISABLED_VALUE = 'off';
const TOGGLE_WARN_ACTION = 'toggle-warn';
const ANSI_RED = '\x1b[31m';
const ANSI_FG_RESET = '\x1b[39m';

function isWarnEnabled(item: WidgetItem): boolean {
    return item.metadata?.[WARN_METADATA_KEY] !== WARN_DISABLED_VALUE;
}

function toggleWarn(item: WidgetItem): WidgetItem {
    if (isWarnEnabled(item)) {
        return {
            ...item,
            metadata: {
                ...item.metadata,
                [WARN_METADATA_KEY]: WARN_DISABLED_VALUE
            }
        };
    }
    return removeMetadataKeys(item, [WARN_METADATA_KEY]);
}

// Renders nothing until the session's first miss, so it needs no hide option.
// The widget is news, not history: once the user's next prompt lands after the
// miss it hides, until Claude Code reports a fresher miss.
export class LastCacheMissWidget implements Widget {
    getDefaultColor(): string { return 'ansi256:180'; }
    getDescription(): string { return 'Shows when the last prompt cache miss happened, until your next prompt; red by default, cause only when it is not a cache expiry'; }
    getDisplayName(): string { return 'Last Cache Miss'; }
    getCategory(): string { return 'Cache'; }
    getLabelPrefix(): string { return LABEL; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const modifiers: string[] = [];
        if (!isWarnEnabled(item)) {
            modifiers.push('warn off');
        }
        if (isMetadataFlagEnabled(item, COMPACT_METADATA_KEY)) {
            modifiers.push('compact');
        }
        return {
            displayText: this.getDisplayName(),
            modifierText: makeModifierText(modifiers)
        };
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'w', label: '(w)arn', action: TOGGLE_WARN_ACTION },
            { key: 's', label: '(s)hort time', action: TOGGLE_COMPACT_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === TOGGLE_WARN_ACTION) {
            return toggleWarn(item);
        }
        if (action === TOGGLE_COMPACT_ACTION) {
            return toggleMetadataFlag(item, COMPACT_METADATA_KEY);
        }
        return null;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const cache = getPromptCache(context);
        if (typeof cache?.last_miss_at !== 'number') {
            return null;
        }

        if (!context.isPreview && this.isSuperseded(context, cache.last_miss_at)) {
            return null;
        }

        const compact = isMetadataFlagEnabled(item, COMPACT_METADATA_KEY) || (!context.isPreview && isCompactWidth(context));
        const cause = formatMissCauseBrief(cache.last_miss_cause, compact);
        const age = formatMissAge(cache.last_miss_at);
        const value = compact
            ? [age.replace(/ ago$/, ''), cause].filter(part => part.length > 0).join(' ')
            : [age, cause].filter(part => part.length > 0).join(', ');
        const text = item.rawValue ? value : `${compact ? COMPACT_LABEL : LABEL}${value}`;

        // Warn mode paints the whole widget, label included; off leaves the
        // text uncolored so the default color applies
        return isWarnEnabled(item) ? `${ANSI_RED}${text}${ANSI_FG_RESET}` : text;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }

    // Hidden once a user prompt newer than the miss exists in the transcript;
    // an unreadable transcript (or one with no user rows) says nothing, so the
    // widget keeps showing rather than flickering off.
    private isSuperseded(context: RenderContext, lastMissAtSeconds: number): boolean {
        const transcriptPath = context.data?.transcript_path;
        if (!transcriptPath) {
            return false;
        }
        const lastUserSeconds = getLastUserPromptSeconds(transcriptPath);
        return lastUserSeconds !== null && lastUserSeconds > lastMissAtSeconds;
    }
}
