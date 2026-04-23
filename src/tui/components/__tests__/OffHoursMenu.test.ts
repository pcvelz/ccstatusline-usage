import {
    describe,
    expect,
    it
} from 'vitest';

import type { OffHoursConfig } from '../../../types/Settings';
import {
    describeOffWindow,
    formatActiveHoursPerWeek
} from '../OffHoursMenu';

const NIGHT: OffHoursConfig = {
    enabled: true,
    startMinutes: 22 * 60,
    endMinutes: 7 * 60
};

describe('describeOffWindow', () => {
    it('describes a wrap-midnight window with hours duration', () => {
        expect(describeOffWindow(NIGHT)).toBe('22:00 → 07:00 (9h/day)');
    });

    it('describes a same-day window with hours and minutes', () => {
        expect(describeOffWindow({ enabled: true, startMinutes: 2 * 60 + 30, endMinutes: 10 * 60 + 15 }))
            .toBe('02:30 → 10:15 (7h 45m/day)');
    });

    it('describes a zero-length window as "(no window)"', () => {
        expect(describeOffWindow({ enabled: true, startMinutes: 60, endMinutes: 60 })).toBe('(no window)');
    });
});

describe('formatActiveHoursPerWeek', () => {
    it('returns an integer string when hours divides cleanly', () => {
        expect(formatActiveHoursPerWeek(NIGHT)).toBe('105h / week');
    });

    it('returns a decimal string for fractional active hours', () => {
        // 7h 30m off/day = 7.5 * 7 = 52.5h off/week → 115.5h active
        expect(formatActiveHoursPerWeek({ enabled: true, startMinutes: 22 * 60 + 30, endMinutes: 6 * 60 }))
            .toBe('115.5h / week');
    });

    it('returns 168h for a disabled window', () => {
        expect(formatActiveHoursPerWeek({ ...NIGHT, enabled: false })).toBe('168h / week');
    });
});
