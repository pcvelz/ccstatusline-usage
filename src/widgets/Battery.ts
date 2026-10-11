import { execSync } from 'child_process';
import { readFileSync } from 'fs';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

function getMacBatteryInfo(): { percent: number; charging: boolean } | null {
    try {
        const output = execSync('pmset -g batt', { encoding: 'utf-8', timeout: 2000 });
        const match = /(\d+)%;\s*(charging|discharging|charged|finishing charge|AC attached)/i.exec(output);
        const percentStr = match?.[1];
        const stateStr = match?.[2];
        if (!percentStr || !stateStr) {
            return null;
        }
        const percent = Number.parseInt(percentStr, 10);
        const state = stateStr.toLowerCase();
        const charging = state !== 'discharging';
        return { percent, charging };
    } catch {
        return null;
    }
}

function getLinuxBatteryInfo(): { percent: number; charging: boolean } | null {
    try {
        const capacity = readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf-8').trim();
        const status = readFileSync('/sys/class/power_supply/BAT0/status', 'utf-8').trim().toLowerCase();
        const percent = Number.parseInt(capacity, 10);
        if (Number.isNaN(percent)) {
            return null;
        }
        const charging = status !== 'discharging';
        return { percent, charging };
    } catch {
        return null;
    }
}

function getBatteryInfo(): { percent: number; charging: boolean } | null {
    if (process.platform === 'darwin') {
        return getMacBatteryInfo();
    }
    if (process.platform === 'linux') {
        return getLinuxBatteryInfo();
    }
    return null;
}

export class BatteryWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string { return 'Shows battery percentage (only when on battery, hidden when charging)'; }
    getDisplayName(): string { return 'Battery'; }
    getCategory(): string { return 'Environment'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return item.rawValue ? '72%' : 'B: 72%';
        }

        const info = getBatteryInfo();
        if (!info || info.charging) {
            return null;
        }

        const label = item.rawValue ? '' : 'B: ';
        return `${label}${info.percent}%`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
