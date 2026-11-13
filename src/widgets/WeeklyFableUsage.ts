import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    HideableState,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import {
    formatPercent,
    resolveNumberFormat
} from '../utils/number-format';
import {
    getUsageErrorMessage,
    resolveWeeklyFableUsageWindow
} from '../utils/usage';

import { isHidden } from './shared/hideable';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';
import {
    USAGE_NO_DATA_HIDEABLE_STATE,
    cycleUsageDisplayMode,
    formatUsageBar,
    getUsageLabel,
    getUsagePercentCustomKeybinds,
    isUsageCursorEnabled,
    isUsageInverted,
    toggleUsageCursor,
    toggleUsageInverted
} from './shared/usage-display';
import { getUsagePercentWidgetEditorDisplay } from './shared/usage-percent-widget';

const LABEL = 'Fable: ';
const SHORT_LABEL = 'F: ';

export class WeeklyFableUsageWidget implements Widget {
    getDefaultColor(): string { return 'magenta'; }
    getDescription(): string { return 'Shows weekly Fable API usage percentage'; }
    getDisplayName(): string { return 'Weekly Fable Usage'; }
    getCategory(): string { return 'Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return getUsagePercentWidgetEditorDisplay('fable-weekly', item);
    }

    getHideableStates(): HideableState[] {
        return [USAGE_NO_DATA_HIDEABLE_STATE];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === 'toggle-progress') {
            return cycleUsageDisplayMode(item, [], true, true);
        }

        if (action === 'toggle-invert') {
            return toggleUsageInverted(item);
        }

        if (action === 'toggle-cursor') {
            return toggleUsageCursor(item);
        }

        return null;
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const format = resolveNumberFormat('percent', item, settings);
        const inverted = isUsageInverted(item);
        const showCursor = isUsageCursorEnabled(item);
        const label = getUsageLabel(context, LABEL, SHORT_LABEL);

        if (context.isPreview) {
            const previewPercent = 13;
            const renderedPercent = inverted ? 100 - previewPercent : previewPercent;

            const previewBar = formatUsageBar(item, renderedPercent, format, () => (showCursor ? { cursorPercent: 50 } : undefined), context);
            return formatRawOrLabeledValue(item, label, previewBar ?? formatPercent(renderedPercent, format));
        }

        const data = context.usageData ?? {};
        // Fable is an Anthropic-only quota. A defined non-Anthropic provider
        // (Kimi, OpenCode, null) means "no Fable window exists", so hide
        // instead of letting the zero-usage fallback below show a bogus 0.0%.
        if (data.provider !== undefined && data.provider !== 'anthropic')
            return null;
        // Accounts that never used Fable get no Fable limit from the API. When
        // the core usage windows did arrive, that absence means "no usage yet",
        // so show 0.0% instead of hiding the widget for light users (#7).
        const fableUsage = data.weeklyFableUsage
            ?? (data.sessionUsage !== undefined || data.weeklyUsage !== undefined ? 0 : undefined);
        if (fableUsage === undefined) {
            if (data.error) {
                return isHidden(item, USAGE_NO_DATA_HIDEABLE_STATE.key)
                    ? null
                    : getUsageErrorMessage(data.error);
            }
            return null;
        }

        const percent = Math.max(0, Math.min(100, fableUsage));
        const renderedPercent = inverted ? 100 - percent : percent;
        const getCursorOptions = (): { cursorPercent: number } | undefined => {
            if (!showCursor) {
                return undefined;
            }

            const window = resolveWeeklyFableUsageWindow(data);
            // Same rule as the shared percent widgets: a remaining-percent bar puts its cursor on time left
            return window ? { cursorPercent: inverted ? window.remainingPercent : window.elapsedPercent } : undefined;
        };

        const bar = formatUsageBar(item, renderedPercent, format, getCursorOptions, context);
        return formatRawOrLabeledValue(item, label, bar ?? formatPercent(renderedPercent, format));
    }

    getCustomKeybinds(item?: WidgetItem): CustomKeybind[] {
        return getUsagePercentCustomKeybinds(item);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
    supportsNumberFormat(): boolean { return true; }
}
