import type React from 'react';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetEditorProps,
    WidgetItem
} from '../types/Widget';
import {
    getContextConfig,
    getModelContextIdentifier
} from '../utils/model-context';
import {
    getUsageErrorMessage,
    makeSplitUsageBar,
    resolveWeeklyUsageWindow
} from '../utils/usage';
import { resolveProvider } from '../utils/usage/resolver';

import {
    LOCALE_EDITOR_ACTION,
    renderUsageLocaleEditor
} from './shared/locale-editor';
import {
    TIMEZONE_EDITOR_ACTION,
    renderUsageTimezoneEditor
} from './shared/timezone-editor';
import {
    getUsageTimerCustomKeybinds,
    toggleUsageDateMode,
    toggleUsageHourFormat
} from './shared/usage-display';

const DARK_RED_OPEN = '\x1b[38;2;204;0;0m';
const DARK_RED_CLOSE = '\x1b[39m';

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

function formatSplitUsageBar(label: string, shortLabel: string, extraPercent: number, size: DisplaySize, extraUsed?: number, extraLimit?: number): string {
    const displayLabel = size === 'mobile' ? shortLabel : label;
    const suffix = extraUsed !== undefined && extraLimit !== undefined
        ? `${DARK_RED_OPEN}${formatCents(extraUsed)}/${formatCents(extraLimit)}${DARK_RED_CLOSE}`
        : '100.0%';

    if (size === 'mobile') {
        // Split bar is too cramped at 4 chars; use a plain full bar with used amount only
        const bar = makeProgressBar(100, getBarWidth(size));
        const mobileSuffix = extraUsed !== undefined
            ? `${DARK_RED_OPEN}${formatCents(extraUsed)}${DARK_RED_CLOSE}`
            : suffix;
        return `${displayLabel}: ${bar} ${mobileSuffix}`;
    }

    const bar = makeSplitUsageBar(extraPercent, getBarWidth(size));
    return `${displayLabel}: ${bar} ${suffix}`;
}

function computeExtraPercent(extraUsed: number, extraLimit: number): number {
    return extraLimit > 0 ? (extraUsed / extraLimit) * 100 : 0;
}

function getCurrencySymbol(): string {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz.startsWith('Europe/'))
            return '€';
    } catch {
        // Fall through to default
    }
    return '$';
}

function formatCents(cents: number): string {
    const symbol = getCurrencySymbol();
    return `${symbol}${(cents / 100).toFixed(2)}`;
}

function getModelId(context: RenderContext): string {
    const model = context.data?.model;
    return (typeof model === 'string' ? model : model?.id) ?? '';
}

// Session Usage Widget
export class SessionUsageWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows daily/session API usage percentage'; }
    getDisplayName(): string { return 'Session Usage'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview)
            return 'Session: [███░░░░░░░░░░░░] 20%';

        const data = context.usageData ?? {};
        if (data.error)
            return getUsageErrorMessage(data.error);
        if (data.sessionUsage === undefined)
            return null;

        const size = getDisplaySize(context);

        if (resolveProvider(getModelId(context)).name === 'null')
            return null;

        const extraUsed = data.extraUsageUsed;
        const extraLimit = data.extraUsageLimit;
        if (
            data.extraUsageEnabled === true
            && extraUsed !== undefined
            && extraLimit !== undefined
            && data.sessionUsage >= 100
            && (data.weeklyUsage === undefined || data.weeklyUsage < 100)
        ) {
            const extraPercent = computeExtraPercent(extraUsed, extraLimit);
            return formatSplitUsageBar('Session', 'S', extraPercent, size, extraUsed, extraLimit);
        }

        return formatUsageBar('Session', 'S', data.sessionUsage, size);
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}

// Weekly Usage Widget
export class WeeklyUsageWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows weekly API usage percentage'; }
    getDisplayName(): string { return 'Weekly Usage'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview)
            return 'Weekly: [██░░░░░░░░░░░░░] 12%';

        const data = context.usageData ?? {};
        if (data.error)
            return getUsageErrorMessage(data.error);
        if (data.weeklyUsage === undefined)
            return null;

        const size = getDisplaySize(context);

        if (resolveProvider(getModelId(context)).name === 'null')
            return null;

        const extraUsed = data.extraUsageUsed;
        const extraLimit = data.extraUsageLimit;
        if (
            data.extraUsageEnabled === true
            && extraUsed !== undefined
            && extraLimit !== undefined
            && data.weeklyUsage >= 100
        ) {
            const extraPercent = computeExtraPercent(extraUsed, extraLimit);
            return formatSplitUsageBar('Weekly', 'W', extraPercent, size, extraUsed, extraLimit);
        }

        return formatUsageBar('Weekly', 'W', data.weeklyUsage, size);
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}

// Reset Timer Widget — shows extra usage spending when weekly limit is reached, otherwise reset timer
export class ResetTimerWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows extra usage spending or time until limit reset'; }
    getDisplayName(): string { return 'Reset Timer'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview)
            return '4:30 hr';

        const data = context.usageData ?? {};
        if (data.error)
            return getUsageErrorMessage(data.error);

        if (resolveProvider(getModelId(context)).name === 'null')
            return null;

        // When extra usage is active (weekly limit reached), show the WEEKLY reset time.
        // Session hitting 100% alone doesn't count — session resets on its own 5-hour cycle,
        // so keep showing the session timer until weekly is also exhausted.
        // No [1m] model charges extra usage anymore (all context-window betas are included in-plan).
        const extraActive = data.extraUsageEnabled && data.extraUsageUsed !== undefined && data.extraUsageLimit !== undefined
            && data.weeklyUsage !== undefined && data.weeklyUsage >= 100;

        if (extraActive) {
            const weeklyWindow = resolveWeeklyUsageWindow(data);
            if (weeklyWindow) {
                const hours = Math.floor(weeklyWindow.remainingMs / (1000 * 60 * 60));
                const minutes = Math.floor((weeklyWindow.remainingMs % (1000 * 60 * 60)) / (1000 * 60));
                return `${hours}:${minutes.toString().padStart(2, '0')} hr`;
            }
            // No weekly reset data — fall through to session timer below.
        }

        if (!data.sessionResetAt)
            return null;

        try {
            const resetTime = new Date(data.sessionResetAt).getTime();
            const now = Date.now();
            const diffMs = resetTime - now;

            if (diffMs <= 0)
                return '0:00 hr';

            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            return `${hours}:${minutes.toString().padStart(2, '0')} hr`;
        } catch {
            return null;
        }
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === 'toggle-date') {
            return toggleUsageDateMode(item);
        }
        if (action === 'toggle-hour-format') {
            return toggleUsageHourFormat(item);
        }
        return null;
    }

    getCustomKeybinds(item?: WidgetItem): CustomKeybind[] {
        return getUsageTimerCustomKeybinds(item, {
            includeDate: true,
            includeHourFormat: true,
            includeLocale: true,
            includeTimezone: true
        });
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement | null {
        if (props.action === LOCALE_EDITOR_ACTION) {
            return renderUsageLocaleEditor(props);
        }
        if (props.action === TIMEZONE_EDITOR_ACTION) {
            return renderUsageTimezoneEditor(props);
        }
        return null;
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}

// Context Bar Widget (enhanced context display)
export class ContextBarWidget implements Widget {
    getDefaultColor(): string { return 'blue'; }
    getDescription(): string { return 'Shows context usage as a progress bar'; }
    getDisplayName(): string { return 'Context Bar'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(_item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview)
            return 'Context: [████░░░░░░░░░░░] 50k/200k (25%)';

        const cw = context.data?.context_window;
        if (!cw)
            return null;

        // Window-size precedence lives in getContextConfig: an authoritative
        // live context_window_size wins; the model-context.json mapping only
        // backfills the CLI's 200000 default (Ollama-style configs) and fresh
        // sessions with no live size.
        const modelId = getModelContextIdentifier(context.data?.model);
        const total = getContextConfig(modelId, Number(cw.context_window_size) || null).maxTokens;

        // current_usage can be a number or an object with token breakdown
        let used = 0;
        if (typeof cw.current_usage === 'number') {
            used = cw.current_usage;
        } else if (cw.current_usage && typeof cw.current_usage === 'object') {
            const u = cw.current_usage;
            used = (Number(u.input_tokens) || 0)
                + (Number(u.output_tokens) || 0)
                + (Number(u.cache_creation_input_tokens) || 0)
                + (Number(u.cache_read_input_tokens) || 0);
        }

        // When all usage fields are zero (e.g. during an active turn with a local
        // model where Claude Code hasn't flushed token accounting yet), fall back
        // to transcript-based metrics instead of showing "0k/200k".
        if (used === 0 && context.tokenMetrics && context.tokenMetrics.contextLength > 0) {
            used = context.tokenMetrics.contextLength;
        }

        if (isNaN(total) || isNaN(used))
            return null;

        const percent = total > 0 ? (used / total) * 100 : 0;

        const usedK = Math.round(used / 1000);
        const totalStr = total >= 1000000 ? `${Math.round(total / 1000000)}M` : `${Math.round(total / 1000)}k`;

        const size = getDisplaySize(context);
        const bar = makeProgressBar(percent, getBarWidth(size));
        const label = size === 'mobile' ? 'C' : 'Context';
        const suffix = size === 'mobile' ? '' : ` (${Math.round(percent)}%)`;
        return `${label}: ${bar} ${usedK}k/${totalStr}${suffix}`;
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
