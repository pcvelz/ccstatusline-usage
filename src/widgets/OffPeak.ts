import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import type { ProviderName } from '../utils/usage/types';

// Peak hours on weekdays: 8 AM–2 PM EDT (UTC-4)
// Peak = 12:00–18:00 UTC
const PEAK_START_UTC_HOUR = 12;
const PEAK_END_UTC_HOUR   = 18;

export function isWeekend(now: Date): boolean {
    const dayOfWeek = now.getUTCDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
}

export function isPeakHour(now: Date): boolean {
    const utcHour = now.getUTCHours();
    return utcHour >= PEAK_START_UTC_HOUR && utcHour < PEAK_END_UTC_HOUR;
}

export function isOffPeak(now: Date): boolean {
    if (isWeekend(now))
        return true;
    return !isPeakHour(now);
}

export function minutesUntilFlip(now: Date): number {
    if (isWeekend(now)) {
        return minutesUntilMondayPeak(now);
    }

    const utcHour = now.getUTCHours();
    const peak = isPeakHour(now);
    const flipHour = peak ? PEAK_END_UTC_HOUR : PEAK_START_UTC_HOUR;
    const target = new Date(now);

    if (!peak && utcHour >= PEAK_END_UTC_HOUR) {
        // Off-peak evening — flip is tomorrow morning, unless tomorrow is a weekend
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(now.getUTCDate() + 1);
        if (isWeekend(tomorrow)) {
            return minutesUntilMondayPeak(now);
        }
        target.setUTCDate(now.getUTCDate() + 1);
    }
    target.setUTCHours(flipHour, 0, 0, 0);

    return Math.max(0, Math.round((target.getTime() - now.getTime()) / 60000));
}

function minutesUntilMondayPeak(now: Date): number {
    const dayOfWeek = now.getUTCDay();
    // 0=Sunday, 6=Saturday
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    const target = new Date(now);
    target.setUTCDate(now.getUTCDate() + daysUntilMonday);
    target.setUTCHours(PEAK_START_UTC_HOUR, 0, 0, 0);
    return Math.max(0, Math.round((target.getTime() - now.getTime()) / 60000));
}

function formatCountdown(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
}

export class OffPeakWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string { return 'Shows peak / off-peak status with countdown timer'; }
    getDisplayName(): string { return 'Off Peak'; }
    getCategory(): string { return 'Usage'; }
    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? 'Off-peak (3:42 hr)' : 'Off-peak (3:42 hr)';
        }

        const now = new Date();
        const offPeak = isOffPeak(now);
        const mins = minutesUntilFlip(now);
        const countdown = ` (${formatCountdown(mins)} hr)`;
        const mobile = (context.terminalWidth ?? 0) > 0 && (context.terminalWidth ?? 0) < 134;

        if (offPeak) {
            return mobile ? `OffPk${countdown}` : `Off-peak${countdown}`;
        }
        return `Peak${countdown}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }

    // Peak hours are an Anthropic-plan concept (8 AM–2 PM EDT rate-limit window).
    // Hide for non-Anthropic providers (Kimi, GLM, Qwen, ...) and unknown models.
    getSupportedProviders(): ProviderName[] { return ['anthropic']; }
}
