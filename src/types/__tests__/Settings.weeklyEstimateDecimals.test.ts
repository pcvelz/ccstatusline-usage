import {
    describe,
    expect,
    it
} from 'vitest';

import {
    DEFAULT_SETTINGS,
    SettingsSchema
} from '../Settings';

describe('weeklyEstimateDecimals setting', () => {
    it('defaults to 1', () => {
        expect(DEFAULT_SETTINGS.weeklyEstimateDecimals).toBe(1);
    });

    it('is 1 when the key is missing from an older settings file', () => {
        const result = SettingsSchema.safeParse({ weeklyEstimate: false });

        expect(result.success).toBe(true);
        expect(result.data?.weeklyEstimateDecimals).toBe(1);
    });

    it('accepts 1 and 2', () => {
        expect(SettingsSchema.parse({ weeklyEstimateDecimals: 1 }).weeklyEstimateDecimals).toBe(1);
        expect(SettingsSchema.parse({ weeklyEstimateDecimals: 2 }).weeklyEstimateDecimals).toBe(2);
    });

    it('falls back to 1 for invalid values without failing the whole parse', () => {
        for (const bad of [3, 0, -1, 1.5, 'x', '2', null, true]) {
            const result = SettingsSchema.safeParse({ weeklyEstimateDecimals: bad, minimalistMode: true });

            expect(result.success).toBe(true);
            expect(result.data?.weeklyEstimateDecimals).toBe(1);
            expect(result.data?.minimalistMode).toBe(true);
        }
    });
});
