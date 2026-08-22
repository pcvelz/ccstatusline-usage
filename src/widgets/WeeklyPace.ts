import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import {
    computeAdjustedExpectedPercent,
    isOffHoursActive
} from '../utils/off-hours';
import {
    getUsageErrorMessage,
    makePendulumBar,
    resolveWeeklyPaceResetAt,
    resolveWeeklyPaceWindow,
    resolveWeeklyUsageWindow
} from '../utils/usage';
import type { WeeklyPaceSource } from '../utils/usage-types';
import {
    SEVEN_DAY_WINDOW_MS,
    getNextWeeklyPaceSourceId,
    getUsageNumberField,
    getWeeklyPaceSource
} from '../utils/usage-types';

import { makeModifierText } from './shared/editor-display';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

const MOBILE_THRESHOLD = 134;
const MEDIUM_THRESHOLD = 178;

type PaceDisplayMode = 'text' | 'pendulum';

function getPaceDisplayMode(item: WidgetItem): PaceDisplayMode {
    return item.metadata?.display === 'pendulum' ? 'pendulum' : 'text';
}

function getPaceSource(item: WidgetItem): WeeklyPaceSource {
    return getWeeklyPaceSource(item.metadata?.source);
}

// The overall weekly bucket keeps the original unprefixed labels so existing
// configs render exactly as before; per-model sources name the model.
function getPendulumLabel(source: WeeklyPaceSource): string {
    return source.modelName ? `${source.modelName} Pace: ` : 'Pace: ';
}

function getTextLabel(source: WeeklyPaceSource): string {
    return source.modelName ? `${source.modelName} ` : '';
}

type DecimalPrecision = 0 | 1 | 2 | 3;

function getDecimalPrecision(item: WidgetItem): DecimalPrecision {
    const val = Number(item.metadata?.decimals);
    return (val === 1 || val === 2 || val === 3) ? val : 0;
}

function formatDelta(delta: number, decimals: DecimalPrecision): string {
    return delta.toFixed(decimals);
}

function computePace(
    actualPercent: number,
    expectedPercent: number,
    rawElapsedPercent: number,
    showPercent = false,
    decimals: DecimalPrecision = 0
) {
    const delta = actualPercent - expectedPercent;
    // dayOfWeek reflects calendar progress through the 7-day window, not the
    // off-hours-adjusted expected. Always advances with wall-clock time.
    const dayOfWeek = Math.max(1, Math.min(7, Math.ceil(rawElapsedPercent * 7 / 100)));

    let status: string;
    if (delta > 15) {
        status = `Overcooking +${formatDelta(delta, decimals)}%`;
    } else if (delta > 5) {
        status = `Warm +${formatDelta(delta, decimals)}%`;
    } else if (delta < -15) {
        status = `Underusing ${formatDelta(delta, decimals)}%`;
    } else if (delta < -5) {
        status = `Cool ${formatDelta(delta, decimals)}%`;
    } else if (showPercent) {
        const sign = delta >= 0 ? '+' : '';
        status = `On Pace ${sign}${formatDelta(delta, decimals)}%`;
    } else {
        status = 'On Pace';
    }

    return { delta, dayOfWeek, status };
}

export class WeeklyPaceWidget implements Widget {
    getDefaultColor(): string { return 'brightYellow'; }
    getDescription(): string { return 'Shows if weekly usage pace is on track, overcooking, or underutilized'; }
    getDisplayName(): string { return 'Weekly Pace'; }
    getCategory(): string { return 'Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const mode = getPaceDisplayMode(item);
        const source = getPaceSource(item);
        const modifiers: string[] = [];

        if (source.modelName) {
            modifiers.push(source.modelName);
        }
        if (mode === 'pendulum') {
            modifiers.push('pendulum bar');
        }
        if (item.metadata?.showPercent === 'true') {
            modifiers.push('always %');
        }
        const decimals = getDecimalPrecision(item);
        if (decimals > 0) {
            modifiers.push(`.${'0'.repeat(decimals)}`);
        }

        return {
            displayText: this.getDisplayName(),
            modifierText: makeModifierText(modifiers)
        };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === 'toggle-pendulum') {
            const currentMode = getPaceDisplayMode(item);
            const nextMode: PaceDisplayMode = currentMode === 'text' ? 'pendulum' : 'text';

            return {
                ...item,
                metadata: {
                    ...(item.metadata ?? {}),
                    display: nextMode
                }
            };
        }

        if (action === 'toggle-show-percent') {
            const current = item.metadata?.showPercent === 'true';
            return {
                ...item,
                metadata: {
                    ...(item.metadata ?? {}),
                    showPercent: current ? 'false' : 'true'
                }
            };
        }

        if (action === 'cycle-source') {
            return {
                ...item,
                metadata: {
                    ...(item.metadata ?? {}),
                    source: getNextWeeklyPaceSourceId(item.metadata?.source)
                }
            };
        }

        if (action === 'cycle-decimals') {
            const current = getDecimalPrecision(item);
            const next = current >= 3 ? 0 : current + 1;
            return {
                ...item,
                metadata: {
                    ...(item.metadata ?? {}),
                    decimals: String(next)
                }
            };
        }

        return null;
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const displayMode = getPaceDisplayMode(item);
        const source = getPaceSource(item);

        if (context.isPreview) {
            if (displayMode === 'pendulum') {
                // Preview: delta +10, day 4/7
                const barDisplay = `${makePendulumBar(10)} D4/7 +10%`;
                return formatRawOrLabeledValue(item, getPendulumLabel(source), barDisplay);
            }
            return formatRawOrLabeledValue(item, getTextLabel(source), 'D4/7: On Pace');
        }

        const data = context.usageData;
        if (!data)
            return null;
        if (data.error)
            return getUsageErrorMessage(data.error);
        const sourceUsage = getUsageNumberField(data, source.usageField);
        if (sourceUsage === undefined)
            return null;

        // The overall weekly bucket keeps the original resolver so it stays on
        // the exact path it had before pace sources existed.
        const window = source.modelName
            ? resolveWeeklyPaceWindow(data, source)
            : resolveWeeklyUsageWindow(data);
        if (!window)
            return null;

        const actualPercent = Math.max(0, Math.min(100, sourceUsage));
        const showPercent = item.metadata?.showPercent === 'true';
        const decimals = getDecimalPrecision(item);

        // Raw expected from wall-clock. May be replaced below by an
        // off-hours-adjusted value for delta calculation, but dayOfWeek
        // always uses the raw value.
        const rawExpectedPercent = window.elapsedPercent;
        let expectedPercent = rawExpectedPercent;

        const sourceResetAt = resolveWeeklyPaceResetAt(data, source);

        if (isOffHoursActive(settings.offHours) && sourceResetAt) {
            const resetAtMs = Date.parse(sourceResetAt);
            if (!Number.isNaN(resetAtMs)) {
                const windowStartMs = resetAtMs - SEVEN_DAY_WINDOW_MS;
                const windowEndMs = resetAtMs;
                // nowMs is RECONSTRUCTED from the (already-clamped) window
                // metrics rather than calling Date.now() again. This keeps
                // the widget deterministic under the test's mocked window
                // and avoids a second clock read in production. Because
                // window.elapsedMs is clamped to [0, durationMs], nowMs is
                // guaranteed to land in [windowStartMs, windowEndMs], which
                // is exactly what computeAdjustedExpectedPercent expects —
                // do not repurpose nowMs for anything that needs the real
                // wall-clock instant.
                const nowMs = windowStartMs + window.elapsedMs;
                expectedPercent = computeAdjustedExpectedPercent(
                    windowStartMs,
                    windowEndMs,
                    nowMs,
                    settings.offHours
                );
            }
        }

        const { delta, dayOfWeek, status } = computePace(
            actualPercent,
            expectedPercent,
            rawExpectedPercent,
            showPercent,
            decimals
        );

        const width = context.terminalWidth ?? 0;
        const mobile = width > 0 && width < MOBILE_THRESHOLD;
        const medium = width >= MOBILE_THRESHOLD && width < MEDIUM_THRESHOLD;

        if (displayMode === 'pendulum' && !mobile) {
            const halfWidth = medium ? 4 : 7;
            const sign = delta >= 0 ? '+' : '';
            const barDisplay = `${makePendulumBar(delta, halfWidth)} D${dayOfWeek}/7 ${sign}${formatDelta(delta, decimals)}%`;
            return formatRawOrLabeledValue(item, getPendulumLabel(source), barDisplay);
        }

        return formatRawOrLabeledValue(item, getTextLabel(source), `D${dayOfWeek}/7: ${status}`);
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'p', label: '(p)endulum toggle', action: 'toggle-pendulum' },
            { key: 's', label: '(s)ource bucket', action: 'cycle-source' },
            { key: '%', label: '(%) always show percent', action: 'toggle-show-percent' },
            { key: '.', label: '(.) decimal precision', action: 'cycle-decimals' }
        ];
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
