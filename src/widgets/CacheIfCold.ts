import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { formatTokens } from '../utils/format-tokens';
import { resolveNumberFormat } from '../utils/number-format';

import { makeModifierText } from './shared/editor-display';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';
import { getPromptCache } from './shared/prompt-cache';

const LABEL = 'Next miss: ';
const COMPACT_PREFIX = '↻?';
const COMPACT_METADATA_KEY = 'compact';
const TOGGLE_COMPACT_ACTION = 'toggle-compact';

// Claude Code leaves the figure null right after a compaction or a clearing of
// old tool results, until the next request records the conversation's new size
export class CacheIfColdWidget implements Widget {
    getDefaultColor(): string { return 'ansi256:180'; }
    getDescription(): string { return 'Shows the tokens the next request re-caches if the prompt cache has gone cold by then'; }
    getDisplayName(): string { return 'Cache If Cold'; }
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
        const tokens = getPromptCache(context)?.recache_tokens_if_cold;
        if (typeof tokens !== 'number') {
            return null;
        }

        // Both modes round to whole k regardless of the configured format
        const compact = isMetadataFlagEnabled(item, COMPACT_METADATA_KEY);
        const formatted = formatTokens(tokens, resolveNumberFormat('token', item, settings), 0);
        const value = compact
            ? formatted
            : `${formatted} tok`;

        // The cold-glyph belongs to the value (like CacheTimer's glyphs), so raw
        // value mode keeps it; only the word label is dropped
        if (item.rawValue && !compact) {
            return value;
        }
        return `${compact ? COMPACT_PREFIX : LABEL}${value}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
    supportsNumberFormat(): boolean { return true; }
}
