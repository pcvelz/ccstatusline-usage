import * as fs from 'fs';
import * as path from 'path';

import { getClaudeConfigDir } from './claude-settings';

/**
 * Shape of a single `<config>/sessions/<pid>.json` manifest, limited to the
 * fields this module reads. The real file carries many other keys (cwd,
 * version, tmux, status, etc.) that are irrelevant here.
 */
export interface SessionRegistryEntry {
    pid: number;
    sessionId: string;
    name?: string;
}

function getSessionsDir(): string {
    return path.join(getClaudeConfigDir(), 'sessions');
}

function tryReadEntry(filePath: string): SessionRegistryEntry | null {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }

    try {
        const parsed = JSON.parse(content) as Partial<SessionRegistryEntry>;
        if (typeof parsed.sessionId !== 'string' || typeof parsed.pid !== 'number') {
            return null;
        }
        return {
            pid: parsed.pid,
            sessionId: parsed.sessionId,
            name: typeof parsed.name === 'string' ? parsed.name : undefined
        };
    } catch {
        return null;
    }
}

/**
 * Resolves the address name another Claude Code session would use to message
 * this session (the `name` field of its `<config>/sessions/<pid>.json` manifest),
 * given this session's `session_id`.
 *
 * Fast path: the current process's parent PID (`process.ppid`) is the interactive
 * Claude Code process for this session, so its manifest is tried first. Falls back
 * to scanning the whole sessions directory for a `sessionId` match, since the fast
 * path can miss (e.g. process hierarchy differs from expectations).
 *
 * Every fs/JSON operation is wrapped so a missing dir, unreadable file, or
 * malformed JSON never throws — callers get `null` instead. Individual malformed
 * files are skipped without aborting the scan.
 */
export function getSessionAddress(sessionId: string): string | null {
    const sessionsDir = getSessionsDir();

    const fastPath = tryReadEntry(path.join(sessionsDir, `${process.ppid}.json`));
    if (fastPath?.sessionId === sessionId) {
        return fastPath.name ?? null;
    }

    let files: string[];
    try {
        files = fs.readdirSync(sessionsDir);
    } catch {
        return null;
    }

    for (const file of files) {
        if (!file.endsWith('.json')) {
            continue;
        }

        const entry = tryReadEntry(path.join(sessionsDir, file));
        if (entry?.sessionId === sessionId) {
            return entry.name ?? null;
        }
    }

    return null;
}
