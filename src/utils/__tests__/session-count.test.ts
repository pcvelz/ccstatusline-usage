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

import {
    getActiveSessionCount,
    recordSessionHeartbeat,
    resolveLightMode
} from '../session-count';

describe('session-count', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-sessions-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('recordSessionHeartbeat', () => {
        it('creates a heartbeat file named by the session id', () => {
            recordSessionHeartbeat('session-a', undefined, tempDir);

            expect(fs.existsSync(path.join(tempDir, 'session-a'))).toBe(true);
        });

        it('sanitizes characters outside [A-Za-z0-9_-] to underscores', () => {
            recordSessionHeartbeat('a/b.c d:e', undefined, tempDir);

            expect(fs.existsSync(path.join(tempDir, 'a_b_c_d_e'))).toBe(true);
            expect(fs.readdirSync(tempDir)).toEqual(['a_b_c_d_e']);
        });

        it('updates mtime of an existing heartbeat file', () => {
            recordSessionHeartbeat('session-a', undefined, tempDir);
            const file = path.join(tempDir, 'session-a');
            const oldMtime = new Date(Date.now() - 60_000);
            fs.utimesSync(file, oldMtime, oldMtime);

            recordSessionHeartbeat('session-a', undefined, tempDir);

            const stats = fs.statSync(file);
            expect(Date.now() - stats.mtimeMs).toBeLessThan(10_000);
        });

        it('cleans up heartbeat files older than the TTL', () => {
            recordSessionHeartbeat('fresh', undefined, tempDir);
            recordSessionHeartbeat('stale', undefined, tempDir);
            const staleFile = path.join(tempDir, 'stale');
            const oldMtime = new Date(Date.now() - 300_000);
            fs.utimesSync(staleFile, oldMtime, oldMtime);

            recordSessionHeartbeat('another', undefined, tempDir);

            expect(fs.existsSync(staleFile)).toBe(false);
            expect(fs.existsSync(path.join(tempDir, 'fresh'))).toBe(true);
            expect(fs.existsSync(path.join(tempDir, 'another'))).toBe(true);
        });

        it('never throws on an unwritable base path', () => {
            expect(() => {
                recordSessionHeartbeat('x', undefined, path.join(tempDir, 'no', 'such', 'deep', 'dir'));
            }).not.toThrow();
        });
    });

    describe('getActiveSessionCount', () => {
        it('returns 1 when the sessions dir does not exist', () => {
            expect(getActiveSessionCount(120, undefined, path.join(tempDir, 'missing'))).toBe(1);
        });

        it('counts heartbeat files within the TTL', () => {
            recordSessionHeartbeat('one', undefined, tempDir);
            recordSessionHeartbeat('two', undefined, tempDir);

            expect(getActiveSessionCount(120, undefined, tempDir)).toBe(2);
        });

        it('excludes heartbeat files older than the TTL', () => {
            recordSessionHeartbeat('fresh', undefined, tempDir);
            recordSessionHeartbeat('stale', undefined, tempDir);
            const staleFile = path.join(tempDir, 'stale');
            const oldMtime = new Date(Date.now() - 300_000);
            fs.utimesSync(staleFile, oldMtime, oldMtime);

            expect(getActiveSessionCount(120, undefined, tempDir)).toBe(1);
        });

        it('uses the injected now for TTL comparison', () => {
            recordSessionHeartbeat('one', undefined, tempDir);
            recordSessionHeartbeat('two', undefined, tempDir);
            const futureNow = Date.now() + 300_000;

            expect(getActiveSessionCount(120, futureNow, tempDir)).toBe(0);
        });
    });

    describe('resolveLightMode', () => {
        it('returns lightMode false when adaptiveLightMode is unset', () => {
            const result = resolveLightMode({}, 'session-a', undefined, tempDir);

            expect(result).toEqual({ lightMode: false, ttlMultiplier: 3 });
        });

        it('returns lightMode false when sessionThreshold is unset', () => {
            const result = resolveLightMode({ adaptiveLightMode: {} }, 'session-a', undefined, tempDir);

            expect(result).toEqual({ lightMode: false, ttlMultiplier: 3 });
        });

        it('returns lightMode false when sessionId is undefined', () => {
            const result = resolveLightMode(
                { adaptiveLightMode: { sessionThreshold: 1 } },
                undefined,
                undefined,
                tempDir
            );

            expect(result).toEqual({ lightMode: false, ttlMultiplier: 3 });
        });

        it('returns lightMode false at exactly the threshold', () => {
            recordSessionHeartbeat('other-1', undefined, tempDir);
            recordSessionHeartbeat('other-2', undefined, tempDir);

            const result = resolveLightMode(
                { adaptiveLightMode: { sessionThreshold: 3 } },
                'mine',
                undefined,
                tempDir
            );

            expect(result.lightMode).toBe(false);
        });

        it('returns lightMode true above the threshold', () => {
            recordSessionHeartbeat('other-1', undefined, tempDir);
            recordSessionHeartbeat('other-2', undefined, tempDir);

            const result = resolveLightMode(
                { adaptiveLightMode: { sessionThreshold: 2 } },
                'mine',
                undefined,
                tempDir
            );

            expect(result.lightMode).toBe(true);
            expect(result.ttlMultiplier).toBe(3);
        });

        it('respects a ttlMultiplier override', () => {
            const result = resolveLightMode(
                { adaptiveLightMode: { sessionThreshold: 1, ttlMultiplier: 5 } },
                'mine',
                undefined,
                tempDir
            );

            expect(result.ttlMultiplier).toBe(5);
        });
    });
});
