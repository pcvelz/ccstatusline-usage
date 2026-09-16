import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import type { SlotWord } from '../utils/llama-swap-types';

const STATE_COLORS: Record<SlotWord, string> = {
    DECODE: 'green',
    PREFILL: 'yellow',
    PARKED: 'brightBlack',
    TURN: 'brightBlack',
    FLAT: 'red',
    NONE: 'brightBlack',
    UNKNOWN: 'brightRed'
};

const ANSI_FG: Record<string, string> = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    brightRed: '\x1b[91m',
    brightBlack: '\x1b[90m'
};

export class SlotStatusWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string { return 'Shows llama-swap slot state (PREFILL, DECODE, PARKED, FLAT, TURN)'; }
    getDisplayName(): string { return 'Slot Status'; }
    getCategory(): string { return 'Llama Swap'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const llamaData = context.llamaSwapData;

        // Preview mode: demo rendering so the TUI shows what the widget looks like
        if (context.isPreview && !llamaData) {
            const demo = this.colorText('DECODE', STATE_COLORS.DECODE);
            return item.rawValue ? demo : `State: ${demo}`;
        }

        // Not a llama-swap backend, no session id, or widgets not prefetched:
        // hide. A fetch failure hides too - an unreachable local server is
        // indistinguishable from "not llama-swap", and neither warrants noise.
        if (!llamaData?.fetched)
            return null;

        const word: SlotWord = llamaData.lane?.word ?? 'NONE';
        const colored = this.colorText(word, STATE_COLORS[word]);
        return item.rawValue ? colored : `State: ${colored}`;
    }

    private colorText(text: string, color: string): string {
        const code = ANSI_FG[color];
        return code ? `${code}${text}\x1b[39m` : text;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
