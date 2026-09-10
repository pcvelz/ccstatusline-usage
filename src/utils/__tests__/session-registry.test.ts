import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import { getSessionAddress } from '../session-registry';

const SESSION_ID = '00000000-1111-2222-3333-444444444444';
const OTHER_SESSION_ID = '99999999-8888-7777-6666-555555555555';

let configDir: string;
let sessionsDir: string;
let originalConfigDir: string | undefined;

function writeEntry(fileName: string, entry: Record<string, unknown>) {
    fs.writeFileSync(path.join(sessionsDir, fileName), JSON.stringify(entry));
}

function makeEntry(overrides: Record<string, unknown> = {}) {
    return {
        pid: 12345,
        sessionId: SESSION_ID,
        name: 'my-project-a1',
        ...overrides
    };
}

describe('getSessionAddress', () => {
    beforeEach(() => {
        originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
        configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-registry-'));
        sessionsDir = path.join(configDir, 'sessions');
        fs.mkdirSync(sessionsDir);
        process.env.CLAUDE_CONFIG_DIR = configDir;
    });

    afterEach(() => {
        if (originalConfigDir === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
        }

        fs.rmSync(configDir, { force: true, recursive: true });
    });

    it('should find the name by scanning when the pid fast path does not apply', () => {
        writeEntry('12345.json', makeEntry());
        expect(getSessionAddress(SESSION_ID)).toBe('my-project-a1');
    });

    it('should prefer the parent pid entry over a scanned duplicate', () => {
        writeEntry(`${process.ppid}.json`, makeEntry({ name: 'from-fast-path', pid: process.ppid }));
        writeEntry('12345.json', makeEntry({ name: 'from-scan' }));
        expect(getSessionAddress(SESSION_ID)).toBe('from-fast-path');
    });

    it('should fall back to scanning when the parent pid entry is a different session', () => {
        writeEntry(`${process.ppid}.json`, makeEntry({ name: 'other-session', pid: process.ppid, sessionId: OTHER_SESSION_ID }));
        writeEntry('12345.json', makeEntry({ name: 'from-scan' }));
        expect(getSessionAddress(SESSION_ID)).toBe('from-scan');
    });

    it('should return null when no entry matches the session id', () => {
        writeEntry('12345.json', makeEntry({ sessionId: OTHER_SESSION_ID }));
        expect(getSessionAddress(SESSION_ID)).toBeNull();
    });

    it('should return null when the matching entry has no name', () => {
        writeEntry('12345.json', makeEntry({ name: undefined }));
        expect(getSessionAddress(SESSION_ID)).toBeNull();
    });

    it('should skip malformed json and still find a later match', () => {
        fs.writeFileSync(path.join(sessionsDir, '00001.json'), '{ not valid json');
        writeEntry('12345.json', makeEntry());
        expect(getSessionAddress(SESSION_ID)).toBe('my-project-a1');
    });

    it('should skip entries missing the required fields', () => {
        writeEntry('00001.json', { name: 'no-session-id' });
        writeEntry('00002.json', { name: 'pid-not-a-number', pid: 'nope', sessionId: SESSION_ID });
        writeEntry('12345.json', makeEntry());
        expect(getSessionAddress(SESSION_ID)).toBe('my-project-a1');
    });

    it('should ignore files that are not json', () => {
        fs.writeFileSync(path.join(sessionsDir, 'notes.txt'), 'ignored');
        writeEntry('12345.json', makeEntry());
        expect(getSessionAddress(SESSION_ID)).toBe('my-project-a1');
    });

    it('should return null when the sessions directory does not exist', () => {
        fs.rmSync(sessionsDir, { recursive: true });
        expect(getSessionAddress(SESSION_ID)).toBeNull();
    });
});
