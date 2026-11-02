import type { RenderContext } from '../../types/RenderContext';
import type { Settings } from '../../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../../types/Widget';
import { formatUsageDuration } from '../../utils/usage';

import { formatRawOrLabeledValue } from './raw-or-labeled';
import {
    getUsageCompactKeybind,
    getUsageTextModifierText,
    isCompactWidth,
    isUsageCompact,
    toggleUsageCompact
} from './usage-display';

// Rounded down like the reset timers, but never "0m": the limit hasn't been hit yet.
const MIN_SHOWN_MS = 60 * 1000;

// The limit timers show how long until a usage window's limit at the current
// pace, and nothing when the pace reaches it only after the reset. They differ
// in the window, how its pace is measured, the label and the preview sample.
export abstract class LimitTimerWidget implements Widget {
    abstract getDescription(): string;
    abstract getDisplayName(): string;

    protected abstract readonly label: string;
    // The label in compact mode, usually a shortened form of the longhand label
    protected abstract readonly compactLabel: string;
    // The TUI preview's sample, in milliseconds
    protected abstract readonly previewLimitInMs: number;
    // Milliseconds until the limit, or null when it comes after the reset or
    // there's nothing to measure
    protected abstract getLimitInMs(context: RenderContext): number | null;

    getDefaultColor(): string { return 'ansi256:173'; }
    getCategory(): string { return 'Usage'; }
    getLabelPrefix(item: WidgetItem): string { return isUsageCompact(item) ? this.compactLabel : this.label; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return {
            displayText: this.getDisplayName(),
            modifierText: getUsageTextModifierText(item, { includeCompact: true })
        };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        return action === 'toggle-compact' ? toggleUsageCompact(item) : null;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        // Like the Model widget's preview, the TUI sample ignores the width and
        // shows the configured form; the live render also honours a narrow pane
        const compact = isUsageCompact(item) || (!context.isPreview && isCompactWidth(context));
        const format = (ms: number): string => compact ? this.formatCompactDuration(ms) : formatUsageDuration(ms);
        if (context.isPreview) {
            return formatRawOrLabeledValue(item, this.getLabelPrefix(item), format(this.previewLimitInMs));
        }

        const limitInMs = this.getLimitInMs(context);
        if (limitInMs === null) {
            return null;
        }

        return formatRawOrLabeledValue(item, compact ? this.compactLabel : this.label, format(Math.max(MIN_SHOWN_MS, limitInMs)));
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [getUsageCompactKeybind()];
    }

    // The compact duration form. The weekly/fable limit timers override this
    // with their coarser day/hour-only format; the rest keep the shared
    // formatUsageDuration compact form.
    protected formatCompactDuration(limitInMs: number): string {
        return formatUsageDuration(limitInMs, true);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
