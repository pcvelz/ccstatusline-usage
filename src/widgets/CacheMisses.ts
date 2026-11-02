import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    HideableState,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import { makeModifierText } from './shared/editor-display';
import { isHidden } from './shared/hideable';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';
import {
    NO_MISSES_HIDEABLE_STATE,
    getPromptCache,
    hasNoMisses
} from './shared/prompt-cache';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

const LABEL = 'Cache misses: ';
const COMPACT_LABEL = 'CM: ';
const COMPACT_METADATA_KEY = 'compact';
const TOGGLE_COMPACT_ACTION = 'toggle-compact';

export class CacheMissesWidget implements Widget {
    getDefaultColor(): string { return 'ansi256:180'; }
    getDescription(): string { return 'Shows prompt cache misses out of the session\'s requests with the miss rate, as Claude Code reports them'; }
    getDisplayName(): string { return 'Cache Misses'; }
    getCategory(): string { return 'Cache'; }
    getLabelPrefix(): string { return LABEL; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const modifiers: string[] = [];
        if (isMetadataFlagEnabled(item, COMPACT_METADATA_KEY)) {
            modifiers.push('compact');
        }
        return {
            displayText: this.getDisplayName(),
            modifierText: makeModifierText(modifiers)
        };
    }

    getHideableStates(): HideableState[] {
        return [NO_MISSES_HIDEABLE_STATE];
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 's', label: '(s)hort time', action: TOGGLE_COMPACT_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === TOGGLE_COMPACT_ACTION) {
            return toggleMetadataFlag(item, COMPACT_METADATA_KEY);
        }
        return null;
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const cache = getPromptCache(context);
        if (typeof cache?.misses !== 'number') {
            return null;
        }

        if (hasNoMisses(cache) && isHidden(item, NO_MISSES_HIDEABLE_STATE.key)) {
            return null;
        }

        const compact = isMetadataFlagEnabled(item, COMPACT_METADATA_KEY);
        const count = typeof cache.requests === 'number' ? `${cache.misses}/${cache.requests}` : `${cache.misses}`;
        const value = compact || typeof cache.requests !== 'number'
            ? count
            : `${count} (${Math.round((cache.misses / cache.requests) * 100)}%)`;

        if (compact) {
            if (item.rawValue) {
                return value;
            }
            return `${COMPACT_LABEL}${value}`;
        }
        return formatRawOrLabeledValue(item, LABEL, value);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
