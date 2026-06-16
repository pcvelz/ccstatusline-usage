import { execFileSync } from 'child_process';
import * as fs from 'fs';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock
} from 'vitest';

import { kimiProvider } from '../providers/kimi';
import { resolveProvider } from '../resolver';

vi.mock('child_process', () => ({ execFileSync: vi.fn() }));

vi.mock('fs', () => ({ existsSync: vi.fn(() => true) }));

describe('resolveProvider for Kimi', () => {
    it('routes kimi model ids to the kimi provider', () => {
        expect(resolveProvider('kimi-k2.7').name).toBe('kimi');
    });

    it('still routes qwen to opencode even though kimi pattern overlaps', () => {
        expect(resolveProvider('qwen-3.6-plus').name).toBe('opencode');
    });

    it('routes claude-sonnet to anthropic', () => {
        expect(resolveProvider('claude-sonnet-4-6').name).toBe('anthropic');
    });

    it('routes unknown models to null', () => {
        expect(resolveProvider('mistral-7b').name).toBe('null');
    });
});

describe('kimiProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (fs.existsSync as Mock).mockReturnValue(true);
    });

    it('maps script JSON to UsageData', async () => {
        (execFileSync as Mock).mockReturnValue(JSON.stringify({
            provider: 'kimi',
            modelPattern: 'kimi',
            weeklyUsage: 12.5,
            weeklyResetAt: '2026-06-16T00:00:00Z',
            monthlyUsage: 45.0,
            monthlyResetAt: '2026-07-01T00:00:00Z'
        }));

        const data = await kimiProvider.fetchUsage();
        expect(data.provider).toBe('kimi');
        expect(data.kimiWeeklyUsage).toBe(12.5);
        expect(data.kimiWeeklyResetAt).toBe('2026-06-16T00:00:00Z');
        expect(data.kimiMonthlyUsage).toBe(45.0);
        expect(data.kimiMonthlyResetAt).toBe('2026-07-01T00:00:00Z');
    });

    it('returns empty provider data when script fails', async () => {
        (execFileSync as Mock).mockImplementation(() => {
            throw new Error('script failed');
        });

        const data = await kimiProvider.fetchUsage();
        expect(data.provider).toBe('kimi');
        expect(data.kimiMonthlyUsage).toBeUndefined();
    });
});
