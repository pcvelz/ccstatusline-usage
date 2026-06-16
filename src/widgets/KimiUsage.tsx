import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { getUsageErrorMessage } from '../utils/usage-windows';

const MOBILE_THRESHOLD = 134;
const MEDIUM_THRESHOLD = 178;
const MOBILE_BAR_WIDTH = 4;
const MEDIUM_BAR_WIDTH = 8;
const DEFAULT_BAR_WIDTH = 16;

type DisplaySize = 'mobile' | 'medium' | 'full';

function getDisplaySize(context: RenderContext): DisplaySize {
    const w = context.terminalWidth ?? 0;
    if (w > 0 && w < MOBILE_THRESHOLD)
        return 'mobile';
    if (w >= MOBILE_THRESHOLD && w < MEDIUM_THRESHOLD)
        return 'medium';
    return 'full';
}

function getBarWidth(size: DisplaySize): number {
    if (size === 'mobile')
        return MOBILE_BAR_WIDTH;
    if (size === 'medium')
        return MEDIUM_BAR_WIDTH;
    return DEFAULT_BAR_WIDTH;
}

function makeProgressBar(percent: number, width = DEFAULT_BAR_WIDTH): string {
    const clamped = Math.min(100, Math.max(0, percent));
    const filled = Math.round((clamped / 100) * width);
    const empty = width - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

function formatUsageBar(label: string, shortLabel: string, percent: number, size: DisplaySize): string {
    const bar = makeProgressBar(percent, getBarWidth(size));
    const display = Math.min(100, percent);
    return `${size === 'mobile' ? shortLabel : label}: ${bar} ${display.toFixed(1)}%`;
}

export class KimiWeeklyUsageWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows Kimi weekly usage percentage'; }
    getDisplayName(): string { return 'Kimi Weekly Usage'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview)
            return 'Kimi W: [██░░░░░░░░░░░░░] 12.0%';

        const data = context.usageData ?? {};
        if (data.error)
            return getUsageErrorMessage(data.error);
        if (data.kimiWeeklyUsage === undefined)
            return null;

        return formatUsageBar('Kimi W', 'KW', data.kimiWeeklyUsage, getDisplaySize(context));
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}

export class KimiMonthlyUsageWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows Kimi monthly usage percentage'; }
    getDisplayName(): string { return 'Kimi Monthly Usage'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview)
            return 'Kimi M: [████░░░░░░░░░░░] 25.0%';

        const data = context.usageData ?? {};
        if (data.error)
            return getUsageErrorMessage(data.error);
        if (data.kimiMonthlyUsage === undefined)
            return null;

        return formatUsageBar('Kimi M', 'KM', data.kimiMonthlyUsage, getDisplaySize(context));
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
