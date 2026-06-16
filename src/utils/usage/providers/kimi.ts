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

        return Promise.resolve({
            kimiWeeklyUsage: typeof result.weeklyUsage === 'number' ? result.weeklyUsage : undefined,
            kimiWeeklyResetAt: typeof result.weeklyResetAt === 'string' ? result.weeklyResetAt : undefined,
            kimiMonthlyUsage: typeof result.monthlyUsage === 'number' ? result.monthlyUsage : undefined,
            kimiMonthlyResetAt: typeof result.monthlyResetAt === 'string' ? result.monthlyResetAt : undefined,
            provider: 'kimi'
        });
    }
};
