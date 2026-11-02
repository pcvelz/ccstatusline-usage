import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    formatMissAge,
    formatMissCause,
    formatMissCauseBrief,
    getLastUserPromptSeconds,
    getPromptCache
} from '../prompt-cache';

describe('formatMissCause', () => {
    it('names changed tools with how many were added and removed, leaving out zeros', () => {
        expect(formatMissCause({ causes: ['tools_changed'], tools_added: 2, tools_removed: 0 })).toBe('tools changed (+2)');
        expect(formatMissCause({ causes: ['tools_changed'], tools_added: 0, tools_removed: 3 })).toBe('tools changed (−3)');
        expect(formatMissCause({ causes: ['tools_changed'], tools_added: 2, tools_removed: 1 })).toBe('tools changed (+2, −1)');
        expect(formatMissCause({ causes: ['tools_changed'] })).toBe('tools changed');
    });

    it('gives the system prompt\'s change in length with its sign', () => {
        expect(formatMissCause({ causes: ['system_prompt_changed'], system_char_delta: 120 })).toBe('system prompt changed (+120 chars)');
        expect(formatMissCause({ causes: ['system_prompt_changed'], system_char_delta: -45 })).toBe('system prompt changed (−45 chars)');
        expect(formatMissCause({ causes: ['system_prompt_changed'], system_char_delta: 0 })).toBe('system prompt changed');
        expect(formatMissCause({ causes: ['system_prompt_changed'] })).toBe('system prompt changed');
    });

    it('names an expired TTL by its lifetime', () => {
        expect(formatMissCause({ causes: ['ttl_expired_5m'] })).toBe('5m TTL expired');
        expect(formatMissCause({ causes: ['ttl_expired_1h'] })).toBe('1h TTL expired');
    });

    it('reads the server-side cause and causes it doesn\'t know as words', () => {
        expect(formatMissCause({ causes: ['likely_server_side'] })).toBe('likely server side');
        expect(formatMissCause({ causes: ['model_switched'] })).toBe('model switched');
    });

    it('joins several causes', () => {
        expect(formatMissCause({ causes: ['tools_changed', 'ttl_expired_5m'], tools_added: 1 })).toBe('tools changed (+1), 5m TTL expired');
    });

    it('says the cause is unknown when Claude Code identified none', () => {
        expect(formatMissCause(null)).toBe('cause unknown');
        expect(formatMissCause(undefined)).toBe('cause unknown');
        expect(formatMissCause({ causes: [] })).toBe('cause unknown');
    });
});

describe('formatMissCauseBrief', () => {
    it('names added and removed tools, singular for one', () => {
        expect(formatMissCauseBrief({ causes: ['tools_changed'], tools_added: 2, tools_removed: 0 }, false)).toBe('2 tools added');
        expect(formatMissCauseBrief({ causes: ['tools_changed'], tools_added: 0, tools_removed: 1 }, false)).toBe('1 tool removed');
        expect(formatMissCauseBrief({ causes: ['tools_changed'], tools_added: 2, tools_removed: 1 }, false)).toBe('2 tools added, 1 tool removed');
        expect(formatMissCauseBrief({ causes: ['tools_changed'] }, false)).toBe('tools changed');
    });

    it('codes tools compactly with their signed counts', () => {
        expect(formatMissCauseBrief({ causes: ['tools_changed'], tools_added: 2, tools_removed: 0 }, true)).toBe('tools+2');
        expect(formatMissCauseBrief({ causes: ['tools_changed'], tools_added: 0, tools_removed: 1 }, true)).toBe('tools-1');
        expect(formatMissCauseBrief({ causes: ['tools_changed'], tools_added: 2, tools_removed: 1 }, true)).toBe('tools+2-1');
        expect(formatMissCauseBrief({ causes: ['tools_changed'] }, true)).toBe('tools');
    });

    it('drops TTL-expired and unknown causes entirely', () => {
        expect(formatMissCauseBrief({ causes: ['ttl_expired_5m'] }, false)).toBe('');
        expect(formatMissCauseBrief({ causes: ['ttl_expired_1h', 'ttl_expired_5m'] }, true)).toBe('');
        expect(formatMissCauseBrief(null, false)).toBe('');
        expect(formatMissCauseBrief(undefined, false)).toBe('');
        expect(formatMissCauseBrief({ causes: [] }, false)).toBe('');
    });

    it('keeps only the non-TTL causes of a mixed list', () => {
        expect(formatMissCauseBrief({ causes: ['tools_changed', 'ttl_expired_5m'], tools_added: 1 }, false)).toBe('1 tool added');
        expect(formatMissCauseBrief({ causes: ['system_prompt_changed', 'ttl_expired_1h'], system_char_delta: 120 }, false)).toBe('system prompt changed (+120 chars)');
    });

    it('reads the server-side cause as words or a short code', () => {
        expect(formatMissCauseBrief({ causes: ['likely_server_side'] }, false)).toBe('server-side');
        expect(formatMissCauseBrief({ causes: ['likely_server_side'] }, true)).toBe('srv');
        expect(formatMissCauseBrief({ causes: ['model_switched'] }, false)).toBe('model switched');
    });
});

describe('getLastUserPromptSeconds', () => {
    let tmpDir: string;
    let fileCounter = 0;

    afterEach(() => {
        if (tmpDir) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    const writeTranscript = (lines: string[]): string => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-last-user-prompt-'));
        const file = path.join(tmpDir, `transcript-${++fileCounter}.jsonl`);
        fs.writeFileSync(file, lines.join('\n'), 'utf8');
        return file;
    };

    const userAt = (iso: string, extra: object = {}): string => JSON.stringify({ type: 'user', timestamp: iso, message: { role: 'user', content: 'x' }, ...extra });

    it('returns the newest main-chain user row as unix seconds', () => {
        const file = writeTranscript([
            userAt('2025-02-01T10:00:00.000Z'),
            JSON.stringify({ type: 'assistant', timestamp: '2025-02-01T10:05:00.000Z' }),
            userAt('2025-02-01T10:10:00.000Z')
        ]);

        expect(getLastUserPromptSeconds(file)).toBe(Date.parse('2025-02-01T10:10:00.000Z') / 1000);
    });

    it('skips sidechain user rows', () => {
        const file = writeTranscript([
            userAt('2025-02-01T10:00:00.000Z'),
            userAt('2025-02-01T10:10:00.000Z', { isSidechain: true })
        ]);

        expect(getLastUserPromptSeconds(file)).toBe(Date.parse('2025-02-01T10:00:00.000Z') / 1000);
    });

    it('returns null when the file is missing, empty or has no timestamped user row', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-last-user-prompt-'));

        expect(getLastUserPromptSeconds(path.join(tmpDir, 'missing.jsonl'))).toBeNull();
        expect(getLastUserPromptSeconds(writeTranscript([]))).toBeNull();
        expect(getLastUserPromptSeconds(writeTranscript([JSON.stringify({ type: 'assistant', timestamp: '2025-02-01T10:00:00.000Z' })]))).toBeNull();
    });
});

describe('formatMissAge', () => {
    // Three minutes after a miss at 1738425230
    const nowMs = 1738425410 * 1000;

    it('gives the time since the miss compactly', () => {
        expect(formatMissAge(1738425230, nowMs)).toBe('3m ago');
        expect(formatMissAge(1738425230 - 3600, nowMs)).toBe('1h3m ago');
    });

    it('says just now within a minute, and for a miss stamped ahead of the clock', () => {
        expect(formatMissAge(1738425400, nowMs)).toBe('just now');
        expect(formatMissAge(1738425500, nowMs)).toBe('just now');
    });
});

describe('getPromptCache', () => {
    it('reads prompt_cache from the status line payload', () => {
        expect(getPromptCache({ data: { prompt_cache: { requests: 14, misses: 2 } } })).toEqual({ requests: 14, misses: 2 });
    });

    it('returns null before Claude Code reports one', () => {
        expect(getPromptCache({})).toBeNull();
        expect(getPromptCache({ data: {} })).toBeNull();
        expect(getPromptCache({ data: { prompt_cache: null } })).toBeNull();
    });
});
