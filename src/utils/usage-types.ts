import { z } from 'zod';

export const FIVE_HOUR_BLOCK_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const UsageErrorSchema = z.enum(['no-credentials', 'timeout', 'rate-limited', 'api-error', 'parse-error']);
export type UsageError = z.infer<typeof UsageErrorSchema>;

export interface UsageData {
    sessionUsage?: number;  // five_hour.utilization (percentage)
    sessionResetAt?: string; // five_hour.resets_at
    weeklyUsage?: number;   // seven_day.utilization (percentage)
    weeklyResetAt?: string; // seven_day.resets_at
    weeklySonnetUsage?: number;   // seven_day_sonnet.utilization (percentage)
    weeklySonnetResetAt?: string; // seven_day_sonnet.resets_at
    weeklyOpusUsage?: number;     // seven_day_opus.utilization (percentage)
    weeklyOpusResetAt?: string;   // seven_day_opus.resets_at
    kimiWeeklyUsage?: number;     // Kimi weekly sliding window utilization
    kimiWeeklyResetAt?: string;   // Kimi weekly sliding window reset time
    kimiMonthlyUsage?: number;    // Kimi monthly quota utilization
    kimiMonthlyResetAt?: string;  // Kimi monthly quota reset time
    extraUsageEnabled?: boolean;
    extraUsageLimit?: number;      // in cents (divide by 100 for dollars)
    extraUsageUsed?: number;       // in cents (divide by 100 for dollars)
    extraUsageUtilization?: number; // percentage 0-100
    error?: UsageError;
    provider?: 'anthropic' | 'opencode' | 'kimi' | null;
}

export type UsageDataField = Exclude<keyof UsageData, 'error'>;

export interface FetchUsageDataOptions { requiredFields?: readonly UsageDataField[] }

export interface UsageWindowMetrics {
    sessionDurationMs: number;
    elapsedMs: number;
    remainingMs: number;
    elapsedPercent: number;
    remainingPercent: number;
}
