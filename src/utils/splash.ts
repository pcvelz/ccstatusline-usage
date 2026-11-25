import * as fs from 'node:fs';

// Splash is a local inference engine with no prompt-cache TTL: its cache is
// evicted under memory pressure only, so Anthropic's 5-minute countdown means
// nothing for it. A session is Splash when SPLASH_SWAP_PORT_FILE names a file
// holding "<PORT> <PID>" of a live Splash front, and this session's
// ANTHROPIC_BASE_URL points at that same loopback port.

export interface SplashDeps {
    platform: NodeJS.Platform;
    readFile: (filePath: string) => string;
    kill: (pid: number) => void;
}

// Kept as a function so the defaults are read at call time, not at import.
function defaultDeps(): SplashDeps {
    return {
        platform: process.platform,
        readFile: (filePath: string) => fs.readFileSync(filePath, 'utf8'),
        kill: (pid: number) => { process.kill(pid, 0); }
    };
}

// process.kill(pid, 0) throws when the pid is gone; EPERM means the process
// exists but belongs to another user, which still counts as alive.
function isPidAlive(pid: number, kill: SplashDeps['kill']): boolean {
    try {
        kill(pid);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function isLoopbackPort(baseUrl: string | undefined, port: number): boolean {
    if (!baseUrl) {
        return false;
    }
    try {
        const url = new URL(baseUrl.trim());
        const isLoopbackHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
        return isLoopbackHost && url.port === String(port);
    } catch {
        return false;
    }
}

/**
 * Whether this session is served by a live local Splash front. Only macOS
 * qualifies. The port file is read fresh on every call; any read or parse
 * error means "not Splash".
 */
export function isSplashSession(env: NodeJS.ProcessEnv = process.env, deps: Partial<SplashDeps> = {}): boolean {
    const resolved = { ...defaultDeps(), ...deps };
    if (resolved.platform !== 'darwin') {
        return false;
    }
    const portFile = env.SPLASH_SWAP_PORT_FILE;
    if (!portFile) {
        return false;
    }
    try {
        const [portText, pidText, extra] = resolved.readFile(portFile).trim().split(/\s+/);
        if (portText === undefined || pidText === undefined || extra !== undefined) {
            return false;
        }
        if (!/^\d+$/.test(portText) || !/^\d+$/.test(pidText)) {
            return false;
        }
        const port = Number.parseInt(portText, 10);
        const pid = Number.parseInt(pidText, 10);
        if (port < 1 || port > 65535 || pid < 1) {
            return false;
        }
        return isLoopbackPort(env.ANTHROPIC_BASE_URL, port) && isPidAlive(pid, resolved.kill);
    } catch {
        return false;
    }
}
