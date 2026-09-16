import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { formatRate } from '../utils/llama-swap';

export class SlotThroughputWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows the llama-swap slot rate in tokens per second'; }
    getDisplayName(): string { return 'Slot Throughput'; }
    getCategory(): string { return 'Llama Swap'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const llamaData = context.llamaSwapData;

        if (context.isPreview && !llamaData) {
            const demo = formatRate(53.9);
            return item.rawValue ? demo : `Rate: ${demo}`;
        }

        if (!llamaData?.fetched)
            return null;

        const rate = llamaData.lane?.tokensPerSecond;
        if (rate === null || rate === undefined || rate <= 0) {
            return item.rawValue ? '0.0 t/s' : `Rate: 0.0 t/s`;
        }

        const display = formatRate(rate);
        return item.rawValue ? display : `Rate: ${display}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }

    getNumericValue?(context: RenderContext, item: WidgetItem): number | null {
        const rate = context.llamaSwapData?.lane?.tokensPerSecond;
        return rate !== null && rate !== undefined && rate > 0 ? rate : null;
    }
}
