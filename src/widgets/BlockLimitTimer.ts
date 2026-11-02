import type { RenderContext } from '../types/RenderContext';

import { LimitTimerWidget } from './shared/limit-timer-widget';

export class BlockLimitTimerWidget extends LimitTimerWidget {
    protected readonly label = 'Limit in: ';
    // Same label in compact mode, like upstream; only the duration shortens
    protected readonly compactLabel = 'Limit in: ';
    protected readonly previewLimitInMs = 73 * 60 * 1000;

    // Upstream keeps its red; the fork's weekly/fable timers mute to amber
    override getDefaultColor(): string { return 'red'; }

    getDescription(): string { return 'Time until the 5-hour block\'s limit at the current pace; shown only when that comes before the reset'; }
    getDisplayName(): string { return 'Block Limit Timer'; }

    protected getLimitInMs(context: RenderContext): number | null {
        return context.sessionForecast?.limitInMs ?? null;
    }
}
