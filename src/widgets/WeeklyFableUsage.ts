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
import { makeTimerProgressBar } from './shared/progress-bar';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';
import {
    USAGE_NO_DATA_HIDEABLE_STATE,
    cycleUsageDisplayMode,
    getUsageDisplayMode,
    getUsageDisplayModifierText,
    getUsagePercentCustomKeybinds,
    getUsageProgressBarWidth,
    isUsageCursorEnabled,
    isUsageInverted,
    isUsageProgressMode,
    isUsageSliderMode,
    makeSliderBar,
    toggleUsageCursor,
    toggleUsageInverted
} from './shared/usage-display';

const LABEL = 'Fable: ';

export class WeeklyFableUsageWidget implements Widget {
    getDefaultColor(): string { return 'magenta'; }
    getDescription(): string { return 'Shows weekly Fable API usage percentage'; }
    getDisplayName(): string { return 'Weekly Fable Usage'; }
    getCategory(): string { return 'Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return {
            displayText: this.getDisplayName(),
            modifierText: getUsageDisplayModifierText(item, { showUsageDirection: true })
        };
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
        const displayMode = getUsageDisplayMode(item);
        const inverted = isUsageInverted(item);
        const showCursor = isUsageCursorEnabled(item);

        if (context.isPreview) {
            const previewPercent = 13;
            const renderedPercent = inverted ? 100 - previewPercent : previewPercent;

            if (isUsageProgressMode(displayMode)) {
                const width = getUsageProgressBarWidth(displayMode);
                const progressBar = makeTimerProgressBar(renderedPercent, width, showCursor ? { cursorPercent: 50 } : undefined);
                const progressDisplay = `[${progressBar}] ${formatPercent(renderedPercent, format)}`;
                return formatRawOrLabeledValue(item, LABEL, progressDisplay);
            }

            if (isUsageSliderMode(displayMode)) {
                const slider = makeSliderBar(renderedPercent, undefined, showCursor ? { cursorPercent: 50 } : undefined);
                const sliderDisplay = displayMode === 'slider' ? `${slider} ${formatPercent(renderedPercent, format)}` : slider;
                return formatRawOrLabeledValue(item, LABEL, sliderDisplay);
            }

            return formatRawOrLabeledValue(item, LABEL, formatPercent(renderedPercent, format));
        }

        const data = context.usageData ?? {};
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
            return window ? { cursorPercent: window.elapsedPercent } : undefined;
        };

        if (isUsageProgressMode(displayMode)) {
            const width = getUsageProgressBarWidth(displayMode);

            const progressBar = makeTimerProgressBar(renderedPercent, width, getCursorOptions());
            const progressDisplay = `[${progressBar}] ${formatPercent(renderedPercent, format)}`;
            return formatRawOrLabeledValue(item, LABEL, progressDisplay);
        }

        if (isUsageSliderMode(displayMode)) {
            const slider = makeSliderBar(renderedPercent, undefined, getCursorOptions());
            const sliderDisplay = displayMode === 'slider' ? `${slider} ${formatPercent(renderedPercent, format)}` : slider;
            return formatRawOrLabeledValue(item, LABEL, sliderDisplay);
        }

        return formatRawOrLabeledValue(item, LABEL, formatPercent(renderedPercent, format));
    }

    getCustomKeybinds(item?: WidgetItem): CustomKeybind[] {
        return getUsagePercentCustomKeybinds(item);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
    supportsNumberFormat(): boolean { return true; }
}
