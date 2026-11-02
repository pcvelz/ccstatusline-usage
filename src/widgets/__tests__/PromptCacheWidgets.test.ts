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

import type { RenderContext } from '../../types';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { StatusJSON } from '../../types/StatusJSON';
import type { WidgetItem } from '../../types/Widget';
import { getWidget } from '../../utils/widgets';
import { CacheIfColdWidget } from '../CacheIfCold';
import { CacheMissTokensWidget } from '../CacheMissTokens';
import { CacheMissesWidget } from '../CacheMisses';
import { LastCacheMissWidget } from '../LastCacheMiss';

type PromptCache = NonNullable<StatusJSON['prompt_cache']>;

// Three minutes after the docs' example miss
const NOW_SECONDS = 1738425410;

// The docs' example session: 2 misses in 14 requests, the last from 2 added tools
const DOCS_EXAMPLE: PromptCache = {
    warm: true,
    caching_observed: true,
    ttl: '1h',
    expires_at: 1738429200,
    requests: 14,
    misses: 2,
    expected_rebuilds: 1,
    hit_ratio: 0.91,
    cache_write_tokens: 352000,
    miss_recache_tokens: 300000,
    last_miss_at: 1738425230,
    last_miss_cause: { causes: ['tools_changed'], tools_added: 2, tools_removed: 0 },
    miss_causes: { tools_changed: 2 },
    recache_tokens_if_cold: 45000
};

const NO_MISSES: PromptCache = {
    requests: 6,
    misses: 0,
    miss_recache_tokens: 0,
    last_miss_at: null,
    last_miss_cause: null,
    recache_tokens_if_cold: 30000
};

const item = (type: string, extra: Partial<WidgetItem> = {}): WidgetItem => ({ id: type, type, ...extra });
const hideZero = (type: string): WidgetItem => item(type, { metadata: { hide: 'zero' } });
const compact = (type: string): WidgetItem => item(type, { metadata: { compact: 'true' } });
const withCache = (promptCache: PromptCache): RenderContext => ({ data: { prompt_cache: promptCache } });
const PREVIEW: RenderContext = { isPreview: true };
const NO_CACHE: RenderContext = { data: {} };

// CacheTimer's warn red, shared by the Last Cache Miss widget
const RED = '\x1b[31m';
const RESET = '\x1b[39m';

describe('Prompt cache widgets', () => {
    let tmpDir: string;
    let fileCounter = 0;

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1000);
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-prompt-cache-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // A transcript whose last main-chain user row is `userSeconds` old;
    // omit it to write a transcript with no user rows at all
    const transcriptContext = (promptCache: PromptCache, userSeconds?: number): RenderContext => {
        const file = path.join(tmpDir, `transcript-${++fileCounter}.jsonl`);
        const lines: string[] = [];
        if (userSeconds !== undefined) {
            lines.push(JSON.stringify({
                type: 'user',
                timestamp: new Date((NOW_SECONDS - userSeconds) * 1000).toISOString(),
                message: { role: 'user', content: 'x' }
            }));
        }
        fs.writeFileSync(file, lines.join('\n'), 'utf8');
        return { data: { prompt_cache: promptCache, transcript_path: file } };
    };

    it('describes each widget in the Cache category', () => {
        const widgets = [new CacheMissesWidget(), new LastCacheMissWidget(), new CacheMissTokensWidget(), new CacheIfColdWidget()];

        expect(widgets.map(widget => widget.getDisplayName())).toEqual(['Cache Misses', 'Last Cache Miss', 'Cache Miss Tokens', 'Cache If Cold']);
        expect(widgets.map(widget => widget.getLabelPrefix())).toEqual(['Cache misses: ', 'Last miss: ', 'Miss cost: ', 'Next miss: ']);
        for (const widget of widgets) {
            expect(widget.getCategory()).toBe('Cache');
            expect(widget.supportsRawValue()).toBe(true);
        }
    });

    it('registers each widget under its type', () => {
        expect(getWidget('cache-misses')).toBeInstanceOf(CacheMissesWidget);
        expect(getWidget('last-cache-miss')).toBeInstanceOf(LastCacheMissWidget);
        expect(getWidget('cache-miss-tokens')).toBeInstanceOf(CacheMissTokensWidget);
        expect(getWidget('cache-if-cold')).toBeInstanceOf(CacheIfColdWidget);
    });

    describe('Cache Misses', () => {
        const widget = new CacheMissesWidget();
        const render = (widgetItem: WidgetItem, context: RenderContext) => widget.render(widgetItem, context, DEFAULT_SETTINGS);

        it('shows the misses out of the session\'s requests with the miss rate', () => {
            expect(render(item('cache-misses'), withCache(DOCS_EXAMPLE))).toBe('Cache misses: 2/14 (14%)');
            expect(render(item('cache-misses', { rawValue: true }), withCache(DOCS_EXAMPLE))).toBe('2/14 (14%)');
        });

        it('shows the short label in compact mode', () => {
            expect(render(compact('cache-misses'), withCache(DOCS_EXAMPLE))).toBe('CM: 2/14');
            expect(render(item('cache-misses', { rawValue: true, metadata: { compact: 'true' } }), withCache(DOCS_EXAMPLE))).toBe('2/14');
        });

        it('shows zero misses unless hidden', () => {
            expect(render(item('cache-misses'), withCache(NO_MISSES))).toBe('Cache misses: 0/6 (0%)');
            expect(render(hideZero('cache-misses'), withCache(NO_MISSES))).toBeNull();
            expect(render(hideZero('cache-misses'), withCache(DOCS_EXAMPLE))).toBe('Cache misses: 2/14 (14%)');
        });

        it('shows the count alone when the request count is missing', () => {
            expect(render(item('cache-misses'), withCache({ misses: 2 }))).toBe('Cache misses: 2');
        });

        it('renders nothing without a miss count', () => {
            expect(render(item('cache-misses'), NO_CACHE)).toBeNull();
            expect(render(item('cache-misses'), withCache({ requests: 14 }))).toBeNull();
        });

        it('previews the docs\' example', () => {
            expect(render(item('cache-misses'), PREVIEW)).toBe('Cache misses: 2/14 (14%)');
        });

        it('can hide while the session has no misses', () => {
            expect(widget.getHideableStates()).toEqual([{ key: 'zero', label: 'when there are no misses' }]);
        });

        it('starts amber, with a compact toggle on s', () => {
            expect(widget.getDefaultColor()).toBe('ansi256:180');
            expect(widget.getCustomKeybinds()).toContainEqual({ key: 's', label: '(s)hort time', action: 'toggle-compact' });
            const toggled = widget.handleEditorAction('toggle-compact', item('cache-misses'));
            expect(toggled?.metadata?.compact).toBe('true');
            expect(toggled).not.toBeNull();
            if (!toggled) {
                return;
            }
            expect(widget.handleEditorAction('toggle-compact', toggled)?.metadata?.compact).toBe('false');
        });
    });

    describe('Last Cache Miss', () => {
        const widget = new LastCacheMissWidget();
        const render = (widgetItem: WidgetItem, context: RenderContext) => widget.render(widgetItem, context, DEFAULT_SETTINGS);

        it('shows how long ago the last miss was, red by default, with a brief cause', () => {
            expect(render(item('last-cache-miss'), withCache(DOCS_EXAMPLE))).toBe(`Last miss: ${RED}3m ago, 2 tools added${RESET}`);
            expect(render(item('last-cache-miss', { rawValue: true }), withCache(DOCS_EXAMPLE))).toBe(`${RED}3m ago, 2 tools added${RESET}`);
        });

        it('drops TTL-expired and unknown causes', () => {
            expect(render(item('last-cache-miss'), withCache({ ...DOCS_EXAMPLE, last_miss_cause: { causes: ['ttl_expired_1h'] } }))).toBe(`Last miss: ${RED}3m ago${RESET}`);
            expect(render(item('last-cache-miss'), withCache({ ...DOCS_EXAMPLE, last_miss_cause: null }))).toBe(`Last miss: ${RED}3m ago${RESET}`);
        });

        it('keeps only the non-TTL causes of a mixed list', () => {
            const cache = { ...DOCS_EXAMPLE, last_miss_cause: { causes: ['system_prompt_changed', 'ttl_expired_5m'], system_char_delta: 120 } };

            expect(render(item('last-cache-miss'), withCache(cache))).toBe(`Last miss: ${RED}3m ago, system prompt changed (+120 chars)${RESET}`);
        });

        it('names removed tools singularly', () => {
            const cache = { ...DOCS_EXAMPLE, last_miss_cause: { causes: ['tools_changed'], tools_added: 0, tools_removed: 1 } };

            expect(render(item('last-cache-miss'), withCache(cache))).toBe(`Last miss: ${RED}3m ago, 1 tool removed${RESET}`);
        });

        it('shows the short label and cause codes in compact mode', () => {
            expect(render(compact('last-cache-miss'), withCache(DOCS_EXAMPLE))).toBe(`CM ${RED}3m tools+2${RESET}`);

            const removed = { ...DOCS_EXAMPLE, last_miss_cause: { causes: ['tools_changed'], tools_added: 0, tools_removed: 1 } };
            expect(render(compact('last-cache-miss'), withCache(removed))).toBe(`CM ${RED}3m tools-1${RESET}`);

            const serverSide = { ...DOCS_EXAMPLE, last_miss_cause: { causes: ['likely_server_side'] } };
            expect(render(compact('last-cache-miss'), withCache(serverSide))).toBe(`CM ${RED}3m srv${RESET}`);
            expect(render(item('last-cache-miss'), withCache(serverSide))).toBe(`Last miss: ${RED}3m ago, server-side${RESET}`);
        });

        it('renders in its normal color when warn mode is off', () => {
            const warnOff = item('last-cache-miss', { metadata: { warn: 'off' } });
            expect(render(warnOff, withCache(DOCS_EXAMPLE))).toBe('Last miss: 3m ago, 2 tools added');
        });

        it('toggles warn mode with w and compact mode with s', () => {
            const warnOff = widget.handleEditorAction('toggle-warn', item('last-cache-miss'));
            expect(warnOff?.metadata?.warn).toBe('off');
            expect(warnOff).not.toBeNull();
            if (!warnOff) {
                return;
            }
            expect(widget.handleEditorAction('toggle-warn', warnOff)?.metadata?.warn).toBeUndefined();

            expect(widget.getCustomKeybinds()).toContainEqual({ key: 'w', label: '(w)arn', action: 'toggle-warn' });
            expect(widget.getCustomKeybinds()).toContainEqual({ key: 's', label: '(s)hort time', action: 'toggle-compact' });
        });

        it('hides once the user has sent a newer prompt', () => {
            // Miss 3 minutes ago; a user prompt 1 minute ago supersedes it
            expect(render(item('last-cache-miss'), transcriptContext(DOCS_EXAMPLE, 60))).toBeNull();
            // A user prompt before the miss leaves it visible
            expect(render(item('last-cache-miss'), transcriptContext(DOCS_EXAMPLE, 600))).toBe(`Last miss: ${RED}3m ago, 2 tools added${RESET}`);
        });

        it('keeps showing when the transcript cannot be read', () => {
            const context: RenderContext = { data: { prompt_cache: DOCS_EXAMPLE, transcript_path: path.join(tmpDir, 'missing.jsonl') } };
            expect(render(item('last-cache-miss'), context)).toBe(`Last miss: ${RED}3m ago, 2 tools added${RESET}`);

            // A transcript without any user row tells nothing either
            expect(render(item('last-cache-miss'), transcriptContext(DOCS_EXAMPLE))).toBe(`Last miss: ${RED}3m ago, 2 tools added${RESET}`);
        });

        it('renders nothing before the first miss', () => {
            expect(render(item('last-cache-miss'), withCache(NO_MISSES))).toBeNull();
            expect(render(item('last-cache-miss'), NO_CACHE)).toBeNull();
        });

        it('previews the docs\' example', () => {
            expect(render(item('last-cache-miss'), PREVIEW)).toBe(`Last miss: ${RED}3m ago, 2 tools added${RESET}`);
        });

        it('starts amber, mentions the next prompt, and shows its modes in the editor', () => {
            expect(widget.getDefaultColor()).toBe('ansi256:180');
            expect(widget.getDescription()).toContain('next prompt');
            expect(widget.getEditorDisplay(item('last-cache-miss'))).toEqual({ displayText: 'Last Cache Miss', modifierText: undefined });
            expect(widget.getEditorDisplay(compact('last-cache-miss'))).toEqual({ displayText: 'Last Cache Miss', modifierText: '(compact)' });
            expect(widget.getEditorDisplay(item('last-cache-miss', { metadata: { warn: 'off' } }))).toEqual({ displayText: 'Last Cache Miss', modifierText: '(warn off)' });
        });
    });

    describe('Cache Miss Tokens', () => {
        const widget = new CacheMissTokensWidget();
        const render = (widgetItem: WidgetItem, context: RenderContext) => widget.render(widgetItem, context, DEFAULT_SETTINGS);

        it('shows the tokens the misses wrote back to the cache', () => {
            expect(render(item('cache-miss-tokens'), withCache(DOCS_EXAMPLE))).toBe('Miss cost: 300.0k tok');
            expect(render(item('cache-miss-tokens', { rawValue: true }), withCache(DOCS_EXAMPLE))).toBe('300.0k tok');
        });

        it('shows the short label with whole-k tokens in compact mode', () => {
            expect(render(compact('cache-miss-tokens'), withCache(DOCS_EXAMPLE))).toBe('↻300k');
            expect(render(item('cache-miss-tokens', { rawValue: true, metadata: { compact: 'true' } }), withCache(DOCS_EXAMPLE))).toBe('↻300k');
        });

        it('applies the token number format', () => {
            expect(render(item('cache-miss-tokens', { numberFormat: { style: 'whole' } }), withCache(DOCS_EXAMPLE))).toBe('Miss cost: 300k tok');
        });

        it('shows zero unless hidden while the session has no misses', () => {
            expect(render(item('cache-miss-tokens'), withCache(NO_MISSES))).toBe('Miss cost: 0');
            expect(render(hideZero('cache-miss-tokens'), withCache(NO_MISSES))).toBeNull();
            expect(widget.getHideableStates()).toEqual([{ key: 'zero', label: 'when there are no misses' }]);
        });

        it('renders nothing without the token count', () => {
            expect(render(item('cache-miss-tokens'), NO_CACHE)).toBeNull();
            expect(render(item('cache-miss-tokens'), withCache({ misses: 2 }))).toBeNull();
        });

        it('previews the docs\' example', () => {
            expect(render(item('cache-miss-tokens'), PREVIEW)).toBe('Miss cost: 310.2k tok');
        });

        it('starts amber, with a compact toggle on s', () => {
            expect(widget.getDefaultColor()).toBe('ansi256:180');
            expect(widget.getCustomKeybinds()).toContainEqual({ key: 's', label: '(s)hort time', action: 'toggle-compact' });
            expect(widget.handleEditorAction('toggle-compact', item('cache-miss-tokens'))?.metadata?.compact).toBe('true');
        });
    });

    describe('Cache If Cold', () => {
        const widget = new CacheIfColdWidget();
        const render = (widgetItem: WidgetItem, context: RenderContext) => widget.render(widgetItem, context, DEFAULT_SETTINGS);

        it('shows what the next request re-caches if the cache has gone cold', () => {
            expect(render(item('cache-if-cold'), withCache(DOCS_EXAMPLE))).toBe('Next miss: 45.0k tok');
            expect(render(item('cache-if-cold', { rawValue: true }), withCache(DOCS_EXAMPLE))).toBe('45.0k tok');
            expect(render(item('cache-if-cold', { numberFormat: { style: 'whole' } }), withCache(DOCS_EXAMPLE))).toBe('Next miss: 45k tok');
        });

        it('shows the short label with whole-k tokens in compact mode', () => {
            expect(render(compact('cache-if-cold'), withCache(DOCS_EXAMPLE))).toBe('↻?45k');
            expect(render(item('cache-if-cold', { rawValue: true, metadata: { compact: 'true' } }), withCache(DOCS_EXAMPLE))).toBe('↻?45k');
        });

        // Null right after a compaction, until the next request
        it('renders nothing while Claude Code has no figure', () => {
            expect(render(item('cache-if-cold'), withCache({ ...DOCS_EXAMPLE, recache_tokens_if_cold: null }))).toBeNull();
            expect(render(item('cache-if-cold'), NO_CACHE)).toBeNull();
        });

        it('previews the docs\' example', () => {
            expect(render(item('cache-if-cold'), PREVIEW)).toBe('Next miss: 45.0k tok');
        });

        it('starts amber, with a compact toggle on s', () => {
            expect(widget.getDefaultColor()).toBe('ansi256:180');
            expect(widget.getCustomKeybinds()).toContainEqual({ key: 's', label: '(s)hort time', action: 'toggle-compact' });
            expect(widget.handleEditorAction('toggle-compact', item('cache-if-cold'))?.metadata?.compact).toBe('true');
        });
    });
});
