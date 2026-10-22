import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Heartbeats live next to the other caches under ~/.cache/ccstatusline/
// (same base as usage-fetch.ts CACHE_DIR; there is no XDG_CACHE_HOME
// override anywhere in this codebase, so homedir() + '.cache' is the
// convention). Each active Claude Code session touches one empty file named
// by its sanitized session id; mtime is the liveness signal.
const DEFAULT_TTL_SECONDS = 120;
const DEFAULT_TTL_MULTIPLIER = 3;

function getSessionsDir(override?: string): string {
    return override ?? path.join(os.homedir(), '.cache', 'ccstatusline', 'sessions');
}

function sanitizeSessionId(sessionId: string): string {
    return sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Touches (or creates) the heartbeat file for sessionId and removes stale
 *  heartbeats. Never throws: a heartbeat failure must not break rendering. */
export function recordSessionHeartbeat(sessionId: string, now?: number, sessionsDir?: string): void {
    try {
        const dir = getSessionsDir(sessionsDir);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, sanitizeSessionId(sessionId));
        const time = new Date(now ?? Date.now());
        if (fs.existsSync(file)) {
            fs.utimesSync(file, time, time);
        } else {
            fs.writeFileSync(file, '');
        }

        const cutoff = (now ?? Date.now()) - DEFAULT_TTL_SECONDS * 1000;
        for (const entry of fs.readdirSync(dir)) {
            if (entry === path.basename(file))
                continue;
            try {
                const stats = fs.statSync(path.join(dir, entry));
                if (stats.isFile() && stats.mtimeMs < cutoff)
                    fs.unlinkSync(path.join(dir, entry));
            } catch {
                // Entry vanished or is unreadable; ignore.
            }
        }
    } catch {
        // Never let bookkeeping break the status line.
    }
}

/** Counts heartbeat files touched within ttlSeconds. Returns 1 on any fs
 *  failure (including a missing dir) so light mode can never wrongly engage
 *  from an fs error. */
export function getActiveSessionCount(ttlSeconds = DEFAULT_TTL_SECONDS, now?: number, sessionsDir?: string): number {
    try {
        const dir = getSessionsDir(sessionsDir);
        const cutoff = (now ?? Date.now()) - ttlSeconds * 1000;
        let count = 0;
        for (const entry of fs.readdirSync(dir)) {
            const stats = fs.statSync(path.join(dir, entry));
            if (stats.isFile() && stats.mtimeMs >= cutoff)
                count++;
        }
        return count;
    } catch {
        return 1;
    }
}

export interface AdaptiveLightModeSettings {
    adaptiveLightMode?: {
        sessionThreshold?: number;
        ttlMultiplier?: number;
    };
}

export interface LightModeResolution {
    lightMode: boolean;
    ttlMultiplier: number;
}

/** Decides whether light mode engages for this render. Off unless a
 *  threshold is configured and a session id is present; engages when the
 *  active session count (after recording this session's heartbeat) exceeds
 *  the threshold. */
export function resolveLightMode(
    settings: AdaptiveLightModeSettings,
    sessionId: string | undefined,
    now?: number,
    sessionsDir?: string
): LightModeResolution {
    const ttlMultiplier = settings.adaptiveLightMode?.ttlMultiplier ?? DEFAULT_TTL_MULTIPLIER;
    const threshold = settings.adaptiveLightMode?.sessionThreshold;
    if (threshold === undefined || sessionId === undefined)
        return { lightMode: false, ttlMultiplier };

    recordSessionHeartbeat(sessionId, now, sessionsDir);
    const count = getActiveSessionCount(DEFAULT_TTL_SECONDS, now, sessionsDir);
    return { lightMode: count > threshold, ttlMultiplier };
}
