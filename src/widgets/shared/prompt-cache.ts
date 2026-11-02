import * as fs from 'node:fs';

import type { RenderContext } from '../../types/RenderContext';
import type { StatusJSON } from '../../types/StatusJSON';
import type { HideableState } from '../../types/Widget';
import { formatUsageDuration } from '../../utils/usage-windows';

// Claude Code's prompt cache statistics for the main conversation, from the
// status line payload (Claude Code 2.1.251+). The cache miss widgets read only
// this: no transcript scan and no network.
export type PromptCache = NonNullable<StatusJSON['prompt_cache']>;
type LastMissCause = NonNullable<PromptCache['last_miss_cause']>;

export const NO_MISSES_HIDEABLE_STATE: HideableState = { key: 'zero', label: 'when there are no misses' };

// The documentation's example session, for the TUI preview: 2 misses in 14
// requests, the last 3 minutes ago because 2 tools were added
function getPreviewPromptCache(nowMs: number): PromptCache {
    return {
        requests: 14,
        misses: 2,
        miss_recache_tokens: 310200,
        last_miss_at: Math.floor(nowMs / 1000) - 3 * 60,
        last_miss_cause: { causes: ['tools_changed'], tools_added: 2, tools_removed: 0 },
        recache_tokens_if_cold: 45000
    };
}

export function getPromptCache(context: RenderContext): PromptCache | null {
    if (context.isPreview) {
        return getPreviewPromptCache(Date.now());
    }

    return context.data?.prompt_cache ?? null;
}

export function hasNoMisses(cache: PromptCache): boolean {
    return cache.misses === 0;
}

const MINUS = '−';

function formatSigned(value: number): string {
    return value < 0 ? `${MINUS}${Math.abs(value)}` : `+${value}`;
}

function formatCause(name: string, details: LastMissCause): string {
    if (name === 'tools_changed') {
        const counts = [
            details.tools_added ? `+${details.tools_added}` : null,
            details.tools_removed ? `${MINUS}${details.tools_removed}` : null
        ].filter(count => count !== null);
        return counts.length > 0 ? `tools changed (${counts.join(', ')})` : 'tools changed';
    }

    if (name === 'system_prompt_changed') {
        const delta = details.system_char_delta;
        return delta ? `system prompt changed (${formatSigned(delta)} chars)` : 'system prompt changed';
    }

    const ttl = /^ttl_expired_(.+)$/.exec(name);
    if (ttl) {
        return `${ttl[1]} TTL expired`;
    }

    // likely_server_side and any cause a later Claude Code adds
    return name.replace(/_/g, ' ');
}

// Claude Code leaves last_miss_cause null when it couldn't identify a cause,
// and older versions (before 2.1.260) don't send it at all
export function formatMissCause(cause: LastMissCause | null | undefined): string {
    if (!cause || cause.causes.length === 0) {
        return 'cause unknown';
    }

    return cause.causes.map(name => formatCause(name, cause)).join(', ');
}

export function formatMissAge(lastMissAtSeconds: number, nowMs = Date.now()): string {
    const ageMs = nowMs - lastMissAtSeconds * 1000;
    return ageMs < 60 * 1000 ? 'just now' : `${formatUsageDuration(ageMs, true)} ago`;
}

function formatToolsBrief(details: LastMissCause, compact: boolean): string {
    const added = details.tools_added ?? 0;
    const removed = details.tools_removed ?? 0;
    if (compact) {
        const counts = [added > 0 ? `+${added}` : '', removed > 0 ? `-${removed}` : ''].join('');
        return counts.length > 0 ? `tools${counts}` : 'tools';
    }
    const parts: string[] = [];
    if (added > 0) {
        parts.push(`${added} tool${added === 1 ? '' : 's'} added`);
    }
    if (removed > 0) {
        parts.push(`${removed} tool${removed === 1 ? '' : 's'} removed`);
    }
    return parts.length > 0 ? parts.join(', ') : 'tools changed';
}

// The widget's brief cause suffix. TTL expiries and unknown causes add nothing
// (a TTL expiry is the cache's normal background churn, not news), so only
// actionable causes render: longhand '2 tools added' / 'server-side', compact
// 'tools+2' / 'srv'. Returns '' when there is nothing worth showing.
export function formatMissCauseBrief(cause: LastMissCause | null | undefined, compact: boolean): string {
    if (!cause) {
        return '';
    }

    const parts: string[] = [];
    for (const name of cause.causes) {
        if (name.startsWith('ttl_expired_')) {
            continue;
        }
        if (name === 'tools_changed') {
            parts.push(formatToolsBrief(cause, compact));
        } else if (name === 'system_prompt_changed') {
            parts.push(compact ? 'sys' : formatCause(name, cause));
        } else if (name === 'likely_server_side') {
            parts.push(compact ? 'srv' : 'server-side');
        } else {
            parts.push(compact ? name.split('_')[0]?.slice(0, 4) ?? name : name.replace(/_/g, ' '));
        }
    }
    return parts.join(compact ? ' ' : ', ');
}

interface TranscriptTimestampEntry {
    type?: string;
    timestamp?: string;
    isSidechain?: boolean;
}

// A single transcript record can exceed the initial tail read (pasted prompts
// and tool results reach hundreds of KiB), so the read doubles until the last
// user row resolves or the whole file has been scanned. Same pattern as
// CacheTimer's transcript tail reader.
const INITIAL_TAIL_BYTES = 32768;

function readTranscriptTail(filePath: string, bytes: number): { text: string; isComplete: boolean } | null {
    try {
        const fd = fs.openSync(filePath, 'r');
        try {
            const size = fs.fstatSync(fd).size;
            const readSize = Math.min(bytes, size);
            const buf = Buffer.alloc(readSize);
            fs.readSync(fd, buf, 0, readSize, size - readSize);
            return { text: buf.toString('utf-8'), isComplete: readSize === size };
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return null;
    }
}

// Seconds of the newest main-chain user row in the transcript tail, or null
// when none is in view (so the caller doubles the read).
function scanTailForLastUserSeconds(text: string): number | null {
    for (const line of text.split('\n').reverse()) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const entry = JSON.parse(trimmed) as TranscriptTimestampEntry;
            // Sidechain (subagent) traffic is not this conversation's prompts.
            if (entry.type !== 'user' || entry.isSidechain === true) {
                continue;
            }
            const parsed = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
            if (!Number.isNaN(parsed)) {
                return parsed / 1000;
            }
        } catch {
            continue;
        }
    }
    return null;
}

/**
 * Unix seconds of the transcript's last main-chain user message, the same
 * "last user message" the speed-metrics collector reports. Reads only the
 * file's tail, doubling until the row resolves. Null when the file cannot be
 * read or holds no timestamped user row: callers treat null as "unknown",
 * not as "no prompt yet".
 */
export function getLastUserPromptSeconds(transcriptPath: string): number | null {
    for (let bytes = INITIAL_TAIL_BYTES; ; bytes *= 2) {
        const tail = readTranscriptTail(transcriptPath, bytes);
        if (!tail || tail.text.length === 0) {
            return null;
        }
        const seconds = scanTailForLastUserSeconds(tail.text);
        if (seconds !== null) {
            return seconds;
        }
        if (tail.isComplete) {
            return null;
        }
    }
}
