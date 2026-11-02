import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import { observeFiveHourPlan } from '../five-hour-plan';

describe('observeFiveHourPlan', () => {
    let dir: string;
    let statePath: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'five-hour-plan-'));
        statePath = path.join(dir, 'state.json');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const observe = (weekly: number | undefined, fiveHour: number | undefined): boolean => observeFiveHourPlan(weekly, fiveHour, statePath);

    it('shows the bar on the very first reading', () => {
        expect(observe(10, 0)).toBe(false);
    });

    it('stays shown while the weekly has moved less than 2 points with the 5-hour at 0', () => {
        observe(10, 0);
        expect(observe(11, 0)).toBe(false);
    });

    it('hides once the weekly rose 2 points and the 5-hour was 0 at every reading', () => {
        observe(10, 0);
        observe(11, 0);
        expect(observe(12, 0)).toBe(true);
    });

    it('accumulates the rise across separate runs through the state file', () => {
        observe(10, 0);
        expect(observeFiveHourPlan(12, 0, statePath)).toBe(true);
    });

    it('never hides when the 5-hour was above 0 at any reading of the span', () => {
        observe(10, 0);
        observe(11, 3);
        expect(observe(12, 0)).toBe(false);
        expect(observe(13, 0)).toBe(false);
    });

    it('does not count the span that came before a 5-hour reading above 0', () => {
        observe(10, 0);
        observe(11, 1);
        // A fresh span starts at 12, the first reading after the one above 0
        expect(observe(12, 0)).toBe(false);
        expect(observe(13, 0)).toBe(false);
        expect(observe(14, 0)).toBe(true);
    });

    it('un-hides the moment the 5-hour goes above 0 again', () => {
        observe(10, 0);
        observe(12, 0);
        expect(observe(12, 0)).toBe(true);
        expect(observe(12, 1)).toBe(false);
    });

    it('ignores readings with no 5-hour value, neither counting them as 0 nor resetting', () => {
        observe(10, 0);
        expect(observe(14, undefined)).toBe(false);
        expect(observe(11, 0)).toBe(false);
        expect(observe(12, 0)).toBe(true);
    });

    it('un-hides on a 5-hour reading above 0 even when the weekly value is missing', () => {
        observe(10, 0);
        expect(observe(12, 0)).toBe(true);
        expect(observe(undefined, 5)).toBe(false);
        expect(observe(12, 0)).toBe(false);
    });

    it('ignores readings with no weekly value', () => {
        observe(10, 0);
        expect(observe(undefined, 0)).toBe(false);
        expect(observe(12, 0)).toBe(true);
    });

    it('restarts the span when the weekly drops (new week)', () => {
        observe(50, 0);
        expect(observe(1, 0)).toBe(false);
        expect(observe(2, 0)).toBe(false);
        expect(observe(3, 0)).toBe(true);
    });

    it('stays hidden across a weekly reset while the 5-hour keeps reading 0', () => {
        observe(10, 0);
        expect(observe(12, 0)).toBe(true);
        expect(observe(1, 0)).toBe(true);
    });

    it('does not hide on a single reading from a cold start', () => {
        expect(observe(12, 0)).toBe(false);
    });

    it('fails open (shows) when the state file is corrupt', () => {
        fs.writeFileSync(statePath, '{not json');
        expect(observe(10, 0)).toBe(false);
    });

    it('fails open when the state path cannot be written', () => {
        expect(observeFiveHourPlan(10, 0, path.join(dir, 'missing', 'deeper', 'state.json'))).toBe(false);
    });
});
