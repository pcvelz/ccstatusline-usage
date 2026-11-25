import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { isSplashSession } from '../splash';

const DEAD_PID = 2147483646;
// The error shape process.kill(pid, 0) throws under both Node and Bun.
const errno = (code: string, syscall: string): Error => Object.assign(new Error(`${syscall} ${code}`), { code, syscall });

describe('isSplashSession', () => {
    let tmpDir: string;
    let portFile: string;
    let originalPlatform: PropertyDescriptor | undefined;

    const setPlatform = (value: NodeJS.Platform): void => {
        Object.defineProperty(process, 'platform', { value });
    };
    const failKill = (error: Error): void => {
        vi.spyOn(process, 'kill').mockImplementation(() => { throw error; });
    };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-splash-'));
        portFile = path.join(tmpDir, 'swap-port');
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        setPlatform('darwin');
    });

    // Platform first, so a failure in the rest of the cleanup cannot leak darwin into other files.
    afterEach(() => {
        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
        vi.restoreAllMocks();
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

    it('is false when SPLASH_SWAP_PORT_FILE is unset', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession({ ANTHROPIC_BASE_URL: 'http://localhost:18170' })).toBe(false);
    });

    it('is false on platforms other than macOS', () => {
        writePortFile(`18170 ${process.pid}\n`);
        setPlatform('linux');
        expect(isSplashSession(env())).toBe(false);
        setPlatform('win32');
        expect(isSplashSession(env())).toBe(false);
    });

    it('is false when the recorded pid is dead', () => {
        writePortFile(`18170 ${DEAD_PID}\n`);
        failKill(errno('ESRCH', 'kill'));
        expect(isSplashSession(env())).toBe(false);
    });

    it('treats EPERM from the pid probe as a live process', () => {
        writePortFile(`18170 ${DEAD_PID}\n`);
        failKill(errno('EPERM', 'kill'));
        expect(isSplashSession(env())).toBe(true);
    });

    it('does not take EPERM from anything but the pid probe as alive', () => {
        writePortFile(`18170 ${DEAD_PID}\n`);
        failKill(errno('EPERM', 'open'));
        expect(isSplashSession(env())).toBe(false);
    });

    it('is false when the port in ANTHROPIC_BASE_URL differs from the port file', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'http://localhost:8001' }))).toBe(false);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:18171' }))).toBe(false);
    });

    it('is false when ANTHROPIC_BASE_URL is not a loopback address', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'https://api.example.com:18170' }))).toBe(false);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: undefined }))).toBe(false);
    });

    it('is true when the port matches and the pid is alive', () => {
        writePortFile(`18170 ${process.pid}\n`);
        expect(isSplashSession(env())).toBe(true);
        expect(isSplashSession(env({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:18170' }))).toBe(true);
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
        expect(isSplashSession(env())).toBe(false);
    });

    it('is false when the port file does not exist', () => {
        expect(isSplashSession(env())).toBe(false);
    });
});
