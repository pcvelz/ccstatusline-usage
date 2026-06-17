import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { UsageData } from '../../usage-types';
import type { UsageProvider } from '../types';

const SCRIPT_TIMEOUT_MS = 3000;

function runKimiScript(): Record<string, unknown> | null {
    const scriptPath = path.join(process.cwd(), 'scripts', 'kimi-usage.sh');
    if (!fs.existsSync(scriptPath)) {
        return null;
    }

    try {
        const output = execFileSync(scriptPath, {
            encoding: 'utf8',
            timeout: SCRIPT_TIMEOUT_MS,
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return JSON.parse(output) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export const kimiProvider: UsageProvider = {
    name: 'kimi',
    fetchUsage(): Promise<UsageData> {
        const result = runKimiScript();
        if (!result) {
            return Promise.resolve({ provider: 'kimi' });
        }

        const weeklyUsage = typeof result.weeklyUsage === 'number' ? result.weeklyUsage : undefined;
        const weeklyResetAt = typeof result.weeklyResetAt === 'string' ? result.weeklyResetAt : undefined;
        const monthlyUsage = typeof result.monthlyUsage === 'number' ? result.monthlyUsage : undefined;
        const monthlyResetAt = typeof result.monthlyResetAt === 'string' ? result.monthlyResetAt : undefined;
        // CDP fallback returns the shorter "Rate limit details" window as sessionUsage.
        const sessionUsage = typeof result.sessionUsage === 'number' ? result.sessionUsage : monthlyUsage;
        const sessionResetAt = typeof result.sessionResetAt === 'string' ? result.sessionResetAt : monthlyResetAt;

        return Promise.resolve({
            // Kimi-native fields (used by kimi-* widgets)
            kimiWeeklyUsage: weeklyUsage,
            kimiWeeklyResetAt: weeklyResetAt,
            kimiMonthlyUsage: monthlyUsage,
            kimiMonthlyResetAt: monthlyResetAt,
            // Generic aliases so the standard Session/Weekly/WeeklyPace widgets render
            sessionUsage,
            sessionResetAt,
            weeklyUsage,
            weeklyResetAt,
            provider: 'kimi'
        });
    }
};
