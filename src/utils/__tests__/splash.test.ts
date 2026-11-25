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

import { isSplashSession } from '../splash';

const DEAD_PID = 2147483646;
const esrch = (): Error => Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });

describe('isSplashSession', () => {
    let tmpDir: string;
    let portFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-splash-'));
        portFile = path.join(tmpDir, 'swap-port');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const env = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
        SPLASH_SWAP_PORT_FILE: portFile,
        ANTHROPIC_BASE_URL: 'http://localhost:18170',
        ...extra
    });
    const writePortFile = (contents: string): void => {
        fs.writeFileSync(portFile, contents, 'utf8');
    };
    const darwin = { platform: 'darwin' as const };

    it('is false when SPLASH_SWAP_PORT_FILE is unset', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession({ ANTHROPIC_BASE_URL: 'http://localhost:18170' }, darwin)).toBe(false);
    });

    it('is false on platforms other than macOS', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession(env(), { platform: 'linux' })).toBe(false);
        expect(isSplashSession(env(), { platform: 'win32' })).toBe(false);
    });

    it('is false when the recorded pid is dead', () => {
        writePortFile(`18170 ${DEAD_PID}\n`);
        expect(isSplashSession(env(), { ...darwin, kill: () => { throw esrch(); } })).toBe(false);
    });

    it('treats EPERM as a live process', () => {
        writePortFile(`18170 ${DEAD_PID}\n`);
        const eperm = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
        expect(isSplashSession(env(), { ...darwin, kill: () => { throw eperm; } })).toBe(true);
    });

    it('is false when the port in ANTHROPIC_BASE_URL differs from the port file', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'http://localhost:8001' }), darwin)).toBe(false);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:18171' }), darwin)).toBe(false);
    });

    it('is false when ANTHROPIC_BASE_URL is not a loopback address', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'https://api.example.com:18170' }), darwin)).toBe(false);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: undefined }), darwin)).toBe(false);
    });

    it('is true when the port matches and the pid is alive', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession(env(), darwin)).toBe(true);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:18170' }), darwin)).toBe(true);
    });

    it.each([
        '',
        'garbage',
        '18170',
        `18170 ${process.pid} extra`,
        `port ${process.pid}`,
        `18170 pid${process.pid}`,
        `99999 ${process.pid}`,
        '18170 0'
    ])('is false for a malformed port file: %j', (contents) => {
        writePortFile(contents);
        expect(isSplashSession(env(), darwin)).toBe(false);
    });

    it('is false when the port file does not exist', () => {
        expect(isSplashSession(env(), darwin)).toBe(false);
    });
});
