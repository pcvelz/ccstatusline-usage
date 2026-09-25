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

import type { RenderContext } from '../../types';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { CacheTimerWidget } from '../CacheTimer';

// Upstream's glyph countdown is opt-in in the fork (display: 'glyphs'); these
// suites exercise it, the 'minutes display' suite covers the fork default.
const item = (extra: Partial<WidgetItem> = {}): WidgetItem => ({
    id: 'cache-timer',
    type: 'cache-timer',
    ...extra,
    metadata: { display: 'glyphs', ...extra.metadata }
});
const hidden: Partial<WidgetItem> = { metadata: { hide: 'empty' } };

const isoAgo = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString();
const assistant = (seconds: number): string => JSON.stringify({ type: 'assistant', timestamp: isoAgo(seconds) });
const pendingUser = JSON.stringify({ type: 'user' });
const sidechain = (type: string, seconds: number): string => JSON.stringify({ type, timestamp: isoAgo(seconds), isSidechain: true });
const apiError = (seconds: number): string => JSON.stringify({ type: 'assistant', timestamp: isoAgo(seconds), isApiErrorMessage: true });
const assistantUsage = (seconds: number, usage: object): string => JSON.stringify({ type: 'assistant', timestamp: isoAgo(seconds), message: { usage } });
const noCacheUsage = { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

describe('CacheTimer widget', () => {
    let tmpDir: string;
    let fileCounter = 0;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-cache-timer-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const transcriptContext = (lines: string[]): RenderContext => {
        const file = path.join(tmpDir, `transcript-${++fileCounter}.jsonl`);
        fs.writeFileSync(file, lines.join('\n'), 'utf8');
        return { data: { transcript_path: file } };
    };

    it('renders the preview as a labeled or raw sample', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(), { isPreview: true }, DEFAULT_SETTINGS)).toBe('Cache: 🟢 4:52');
        expect(widget.render(item({ rawValue: true }), { isPreview: true }, DEFAULT_SETTINGS)).toBe('🟢 4:52');
    });

    it('renders n/a when no transcript is available by default', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(), {}, DEFAULT_SETTINGS)).toBe('Cache: n/a');
        expect(widget.render(item({ rawValue: true }), {}, DEFAULT_SETTINGS)).toBe('n/a');
    });

    it('hides the widget when there is no data and hide-when-empty is enabled', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(hidden), {}, DEFAULT_SETTINGS)).toBeNull();
        expect(widget.render(item(hidden), transcriptContext([]), DEFAULT_SETTINGS)).toBeNull();
    });

    it('renders n/a for an empty transcript by default', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(), transcriptContext([]), DEFAULT_SETTINGS)).toBe('Cache: n/a');
    });

    it('shows HOT while a turn is in flight, regardless of hide-when-empty', () => {
        const widget = new CacheTimerWidget();
        const context = transcriptContext([assistant(60), pendingUser]);
        expect(widget.render(item(), context, DEFAULT_SETTINGS)).toBe('Cache: 🔥 HOT');
        expect(widget.render(item(hidden), context, DEFAULT_SETTINGS)).toBe('Cache: 🔥 HOT');
    });

    const buckets = [
        { label: 'fresh', elapsed: 10, icon: '🟢' },
        { label: 'draining', elapsed: 180, icon: '🟡' },
        { label: 'almost cold', elapsed: 260, icon: '🔴' }
    ];
    for (const { label, elapsed, icon } of buckets) {
        it(`renders the ${label} countdown with the ${icon} icon`, () => {
            const widget = new CacheTimerWidget();
            const out = widget.render(item(), transcriptContext([assistant(elapsed)]), DEFAULT_SETTINGS);
            expect(out).toMatch(new RegExp(`^Cache: ${icon} \\d+:\\d{2}$`));
        });
    }

    it('renders COLD once the TTL has elapsed', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(), transcriptContext([assistant(400)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
    });

    it('renders a raw countdown without the label', () => {
        const widget = new CacheTimerWidget();
        const out = widget.render(item({ rawValue: true }), transcriptContext([assistant(10)]), DEFAULT_SETTINGS);
        expect(out).toMatch(/^🟢 \d+:\d{2}$/);
    });

    it('ignores sidechain rows when deriving the cache state', () => {
        const widget = new CacheTimerWidget();
        // A trailing sidechain user row must not report HOT...
        expect(widget.render(item(), transcriptContext([assistant(400), sidechain('user', 5)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
        // ...and a trailing sidechain assistant row must not restart the countdown.
        expect(widget.render(item(), transcriptContext([assistant(400), sidechain('assistant', 5)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
    });

    it('ignores synthetic API-error rows when deriving the cache state', () => {
        const widget = new CacheTimerWidget();
        // A failed request refreshes nothing, so the prior event still drives the countdown...
        expect(widget.render(item(), transcriptContext([assistant(400), apiError(5)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
        // ...and with no prior main-chain row there is no cache event to report.
        expect(widget.render(item(), transcriptContext([apiError(5)]), DEFAULT_SETTINGS)).toBe('Cache: n/a');
    });

    it('skips assistant rows whose request had no cache activity', () => {
        const widget = new CacheTimerWidget();
        // The prior row that actually touched the cache still drives the countdown...
        const cached = assistantUsage(400, { cache_read_input_tokens: 100, cache_creation_input_tokens: 0 });
        expect(widget.render(item(), transcriptContext([cached, assistantUsage(10, noCacheUsage)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
        // ...and when caching never happened at all there is nothing to count down.
        expect(widget.render(item(), transcriptContext([assistantUsage(10, noCacheUsage)]), DEFAULT_SETTINGS)).toBe('Cache: n/a');
    });

    it('does not report HOT for a finished turn whose response had no cache activity', () => {
        const widget = new CacheTimerWidget();
        // The user row that started the turn precedes the zero-cache response,
        // as in a real transcript; the finished turn must not read as in-flight.
        expect(widget.render(item(), transcriptContext([pendingUser, assistantUsage(10, noCacheUsage)]), DEFAULT_SETTINGS)).toBe('Cache: n/a');
        // An older cache event still drives the countdown instead.
        const cached = assistantUsage(400, { cache_read_input_tokens: 100, cache_creation_input_tokens: 0 });
        expect(widget.render(item(), transcriptContext([cached, pendingUser, assistantUsage(10, noCacheUsage)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
    });

    it('does not report HOT for a turn that ended in an API error', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(), transcriptContext([pendingUser, apiError(5)]), DEFAULT_SETTINGS)).toBe('Cache: n/a');
        expect(widget.render(item(), transcriptContext([assistant(400), pendingUser, apiError(5)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
    });

    it('starts the countdown from rows with cache reads or cache writes', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(), transcriptContext([assistantUsage(10, { cache_read_input_tokens: 1234 })]), DEFAULT_SETTINGS)).toMatch(/^Cache: 🟢 \d+:\d{2}$/);
        expect(widget.render(item(), transcriptContext([assistantUsage(10, { cache_creation_input_tokens: 55 })]), DEFAULT_SETTINGS)).toMatch(/^Cache: 🟢 \d+:\d{2}$/);
    });

    it('finds the trailing record even when it exceeds the initial 32 KiB tail read', () => {
        const widget = new CacheTimerWidget();
        // A pending user row bigger than the initial tail (e.g. a pasted prompt
        // or large tool result) must still report HOT...
        const bigUser = JSON.stringify({ type: 'user', content: 'x'.repeat(64 * 1024) });
        expect(widget.render(item(), transcriptContext([assistant(400), bigUser]), DEFAULT_SETTINGS)).toBe('Cache: 🔥 HOT');
        // ...and an oversized trailing assistant row must still drive the countdown.
        const bigAssistant = JSON.stringify({ type: 'assistant', timestamp: isoAgo(10), content: 'x'.repeat(64 * 1024) });
        expect(widget.render(item(), transcriptContext([bigAssistant]), DEFAULT_SETTINGS)).toMatch(/^Cache: 🟢 \d+:\d{2}$/);
    });

    it('finds a valid trailing record larger than 1 MiB', () => {
        const widget = new CacheTimerWidget();
        const huge = JSON.stringify({ type: 'assistant', timestamp: isoAgo(10), message: { usage: { cache_read_input_tokens: 42 } }, content: 'x'.repeat(2 * 1024 * 1024) });
        expect(widget.render(item(), transcriptContext([huge]), DEFAULT_SETTINGS)).toMatch(/^Cache: 🟢 \d+:\d{2}$/);
    });

    it('renders n/a after scanning a file with no parseable records', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item(), transcriptContext(['x'.repeat(2 * 1024 * 1024)]), DEFAULT_SETTINGS)).toBe('Cache: n/a');
    });

    it('treats a malformed assistant timestamp as no data instead of rendering NaN', () => {
        const widget = new CacheTimerWidget();
        const context = transcriptContext([JSON.stringify({ type: 'assistant', timestamp: 'not-a-date' })]);
        expect(widget.render(item(), context, DEFAULT_SETTINGS)).toBe('Cache: n/a');
        expect(widget.render(item(hidden), context, DEFAULT_SETTINGS)).toBeNull();
    });

    it('declares the empty hideable state and leaves h to the shared checklist', () => {
        const widget = new CacheTimerWidget();
        expect(widget.getCustomKeybinds()).toEqual([
            { key: 't', label: '(t)tl', action: 'toggle-ttl' },
            { key: 'w', label: '(w)arn', action: 'toggle-warn' },
            { key: 'e', label: '(e)moji', action: 'toggle-glyphs' },
            { key: 'g', label: '(g)lyph', action: 'edit-symbol-override' }
        ]);
        expect(widget.getHideableStates().map(state => state.key)).toEqual(['empty']);
        expect(widget.handleEditorAction('unknown', item())).toBeNull();
    });

    it('leaves the editor unannotated at default settings', () => {
        const widget = new CacheTimerWidget();
        expect(widget.getEditorDisplay(item()).displayText).toBe('Cache Timer');
        expect(widget.getEditorDisplay(item()).modifierText).toBeUndefined();
        expect(widget.getEditorDisplay(item(hidden)).modifierText).toBeUndefined();
    });

    it('renders custom state glyphs from metadata overrides', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item({ metadata: { symbolCold: 'X' } }), transcriptContext([assistant(400)]), DEFAULT_SETTINGS)).toBe('Cache: X COLD');
        expect(widget.render(item({ metadata: { symbolFresh: '*' } }), transcriptContext([assistant(10)]), DEFAULT_SETTINGS)).toMatch(/^Cache: \* \d+:\d{2}$/);
        expect(widget.render(item({ metadata: { symbolHot: '>' } }), transcriptContext([assistant(60), pendingUser]), DEFAULT_SETTINGS)).toBe('Cache: > HOT');
    });

    it('drops the glyph and its space when an override is blanked', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item({ metadata: { symbolFresh: '' } }), transcriptContext([assistant(10)]), DEFAULT_SETTINGS)).toMatch(/^Cache: \d+:\d{2}$/);
    });

    it('reflects a custom fresh glyph in the preview', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item({ metadata: { symbolFresh: '#' } }), { isPreview: true }, DEFAULT_SETTINGS)).toBe('Cache: # 4:52');
    });

    it('extends the countdown window when the TTL is set to 1 hour', () => {
        const widget = new CacheTimerWidget();
        // 600s in is COLD at the default 5-minute TTL...
        expect(widget.render(item(), transcriptContext([assistant(600)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
        // ...but still fresh under a 1-hour TTL.
        expect(widget.render(item({ metadata: { ttlSeconds: '3600' } }), transcriptContext([assistant(600)]), DEFAULT_SETTINGS)).toMatch(/^Cache: 🟢 \d+:\d{2}$/);
    });

    it('falls back to the default TTL for a malformed value', () => {
        const widget = new CacheTimerWidget();
        expect(widget.render(item({ metadata: { ttlSeconds: 'abc' } }), transcriptContext([assistant(600)]), DEFAULT_SETTINGS)).toBe('Cache: ❄️ COLD');
    });

    it('cycles the TTL between 5m and 1h via the keybind', () => {
        const widget = new CacheTimerWidget();
        const toOneHour = widget.handleEditorAction('toggle-ttl', item());
        expect(toOneHour?.metadata?.ttlSeconds).toBe('3600');
        const backToDefault = widget.handleEditorAction('toggle-ttl', toOneHour ?? item());
        expect(backToDefault?.metadata?.ttlSeconds).toBeUndefined();
    });

    it('annotates the editor with a non-default TTL', () => {
        const widget = new CacheTimerWidget();
        expect(widget.getEditorDisplay(item({ metadata: { ttlSeconds: '3600' } })).modifierText).toBe('(ttl 1h)');
        expect(widget.getEditorDisplay(item({ metadata: { ttlSeconds: '3600', hide: 'empty' } })).modifierText).toBe('(ttl 1h)');
    });

    describe('minutes display', () => {
        const RED = '\x1b[31m';
        const minutes = (extra: Record<string, string> = {}): WidgetItem => item({ metadata: { display: 'minutes', ...extra } });
        const oneHour = (seconds: number): string => assistantUsage(seconds, { cache_read_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 5 } });
        const fiveMin = (seconds: number): string => assistantUsage(seconds, { cache_read_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 5 } });

        it('is the default display: no metadata renders minutes, no glyph, and hides without data', () => {
            const widget = new CacheTimerWidget();
            const plain: WidgetItem = { id: 'cache-timer', type: 'cache-timer' };
            expect(widget.render(plain, transcriptContext([oneHour(600)]), DEFAULT_SETTINGS)).toBe('Cache: 50 min');
            expect(widget.render(plain, transcriptContext([oneHour(600), pendingUser]), DEFAULT_SETTINGS)).toBe('Cache: 60 min');
            expect(widget.render(plain, {}, DEFAULT_SETTINGS)).toBeNull();
        });

        it('prefers Claude Code prompt_cache.expires_at over the transcript', () => {
            const widget = new CacheTimerWidget();
            const plain: WidgetItem = { id: 'cache-timer', type: 'cache-timer' };
            const expiresIn = (seconds: number): RenderContext => ({ data: { prompt_cache: { ttl: '1h', expires_at: Date.now() / 1000 + seconds } } });
            expect(widget.render(plain, expiresIn(46 * 60 - 1), DEFAULT_SETTINGS)).toBe('Cache: 46 min');
            expect(widget.render(plain, expiresIn(4 * 60), DEFAULT_SETTINGS)).toBe(`Cache: ${RED}4 min\x1b[39m`);
            expect(widget.render(plain, expiresIn(-10), DEFAULT_SETTINGS)).toBe('Cache: COLD');
            const fiveMin: RenderContext = { data: { prompt_cache: { ttl: '5m', expires_at: Date.now() / 1000 + 150 } } };
            expect(widget.render(plain, fiveMin, DEFAULT_SETTINGS)).toBe('Cache: 3 min');
        });

        it('toggles the emoji countdown on and off with the e keybind', () => {
            const widget = new CacheTimerWidget();
            const plain: WidgetItem = { id: 'cache-timer', type: 'cache-timer' };
            const glyphs = widget.handleEditorAction('toggle-glyphs', plain);
            expect(glyphs?.metadata?.display).toBe('glyphs');
            expect(widget.handleEditorAction('toggle-glyphs', glyphs ?? plain)?.metadata?.display).toBeUndefined();
            expect(widget.getCustomKeybinds().map(k => k.key)).toContain('e');
        });

        it('detects the 1h tier and shows whole minutes longhand', () => {
            const widget = new CacheTimerWidget();
            expect(widget.render(minutes(), transcriptContext([oneHour(600)]), DEFAULT_SETTINGS)).toBe('Cache: 50 min');
        });

        it('switches to C: <n>m on narrow terminals', () => {
            const widget = new CacheTimerWidget();
            const context = { ...transcriptContext([oneHour(600)]), terminalWidth: 100 };
            expect(widget.render(minutes(), context, DEFAULT_SETTINGS)).toBe('C: 50m');
        });

        it('turns red within 5 minutes of a 1h expiry', () => {
            const widget = new CacheTimerWidget();
            expect(widget.render(minutes(), transcriptContext([oneHour(3400)]), DEFAULT_SETTINGS)).toBe(`Cache: ${RED}4 min\x1b[39m`);
        });

        it('turns red within 2 minutes of a 5m expiry, not before', () => {
            const widget = new CacheTimerWidget();
            expect(widget.render(minutes(), transcriptContext([fiveMin(60)]), DEFAULT_SETTINGS)).toBe('Cache: 4 min');
            expect(widget.render(minutes(), transcriptContext([fiveMin(200)]), DEFAULT_SETTINGS)).toBe(`Cache: ${RED}2 min\x1b[39m`);
        });

        it('shows the full detected TTL mid-turn instead of a word', () => {
            const widget = new CacheTimerWidget();
            expect(widget.render(minutes(), transcriptContext([oneHour(600), pendingUser]), DEFAULT_SETTINGS)).toBe('Cache: 60 min');
            expect(widget.render(minutes(), transcriptContext([fiveMin(60), pendingUser]), DEFAULT_SETTINGS)).toBe('Cache: 5 min');
        });

        it('shows COLD in the regular color once expired', () => {
            const widget = new CacheTimerWidget();
            expect(widget.render(minutes(), transcriptContext([fiveMin(400)]), DEFAULT_SETTINGS)).toBe('Cache: COLD');
        });

        it('honours a configured warn threshold', () => {
            const widget = new CacheTimerWidget();
            expect(widget.render(minutes({ warnSeconds: '60' }), transcriptContext([oneHour(3400)]), DEFAULT_SETTINGS)).toBe('Cache: 4 min');
        });

        it('cycles the warn threshold through presets back to auto', () => {
            const widget = new CacheTimerWidget();
            let current: WidgetItem | null = minutes();
            const seen: (string | undefined)[] = [];
            for (let i = 0; i < 5; i++) {
                current = widget.handleEditorAction('toggle-warn', current ?? minutes());
                seen.push(current?.metadata?.warnSeconds);
            }
            expect(seen).toEqual(['60', '120', '300', '600', undefined]);
        });
    });
});
