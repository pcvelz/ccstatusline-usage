import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    HideableState,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { formatTokens } from '../utils/format-tokens';
import { resolveNumberFormat } from '../utils/number-format';

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

const LABEL = 'Miss cost: ';
const COMPACT_PREFIX = '↻';
const COMPACT_METADATA_KEY = 'compact';
const TOGGLE_COMPACT_ACTION = 'toggle-compact';

export class CacheMissTokensWidget implements Widget {
    getDefaultColor(): string { return 'ansi256:180'; }
    getDescription(): string { return 'Shows the tokens this session\'s prompt cache misses wrote back to the cache'; }
    getDisplayName(): string { return 'Cache Miss Tokens'; }
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
        if (typeof cache?.miss_recache_tokens !== 'number') {
            return null;
        }

        if (hasNoMisses(cache) && isHidden(item, NO_MISSES_HIDEABLE_STATE.key)) {
            return null;
        }

        // Compact rounds to whole k regardless of the configured format
        const compact = isMetadataFlagEnabled(item, COMPACT_METADATA_KEY);
        const formatted = formatTokens(cache.miss_recache_tokens, resolveNumberFormat('token', item, settings), compact ? 0 : 1);
        const value = compact || cache.miss_recache_tokens < 1000
            ? formatted
            : `${formatted} tok`;

        // The recache glyph belongs to the value (like CacheTimer's glyphs), so
        // raw value mode keeps it; only the word label is dropped
        if (item.rawValue && !compact) {
            return value;
        }
        return `${compact ? COMPACT_PREFIX : LABEL}${value}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
    supportsNumberFormat(): boolean { return true; }
}
