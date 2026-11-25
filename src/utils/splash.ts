import * as fs from 'node:fs';

/**
 * Whether this session is served by a live local Splash front. Splash has no
 * prompt-cache TTL (its cache is evicted under memory pressure only), so
 * Anthropic's 5-minute countdown means nothing for it. True only on macOS,
 * when SPLASH_SWAP_PORT_FILE names a file holding "<PORT> <PID>",
 * ANTHROPIC_BASE_URL points at that loopback port and the pid is alive.
 */
export function isSplashSession(env: NodeJS.ProcessEnv = process.env): boolean {
    if (process.platform !== 'darwin' || !env.SPLASH_SWAP_PORT_FILE) {
        return false;
    }
    try {
        const match = /^(\d+)\s+(\d+)$/.exec(fs.readFileSync(env.SPLASH_SWAP_PORT_FILE, 'utf8').trim());
        const url = new URL(env.ANTHROPIC_BASE_URL?.trim() ?? '');
        const port = Number(match?.[1]);
        const pid = Number(match?.[2]);
        // NaN (no match) fails both comparisons.
        if (!(port >= 1 && pid >= 1) || url.port !== String(port) || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
            return false;
        }
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // Any read or parse error means "not Splash". EPERM from the pid probe
        // means the process exists under another user, which counts as alive.
        const { code, syscall } = error as NodeJS.ErrnoException;
        return code === 'EPERM' && syscall === 'kill';
    }
}
