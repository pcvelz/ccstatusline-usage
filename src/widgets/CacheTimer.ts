import * as fs from 'fs';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    HideableState,
    Widget,
    WidgetEditorDisplay,
    WidgetEditorProps,
    WidgetItem
} from '../types/Widget';

import { CACHE_EMPTY_HIDEABLE_STATE } from './shared/cache-scope';
import { makeModifierText } from './shared/editor-display';
import { isHidden } from './shared/hideable';
import { removeMetadataKeys } from './shared/metadata';
import { formatRawOrLabeledValue } from './shared/raw-or-labeled';
import {
    getSlotSymbol,
    getSymbolKeybind,
    renderSymbolSlotsEditor,
    type SymbolSlot
} from './shared/symbol-override';

// Anthropic's ephemeral prompt cache defaults to a 5-minute TTL, but Claude Code
// also writes 1-hour breakpoints (cache_control ttl: "1h") for the stable prefix.
// The expiry itself is never exposed (the transcript only records token counts),
// so this is a best-effort countdown from the last turn; the TTL is configurable
// to match whichever tier the user cares about.
const TTL_METADATA_KEY = 'ttlSeconds';
const DEFAULT_TTL_SECONDS = 300;
const TTL_OPTIONS = [300, 3600] as const; // 5 minutes, 1 hour
const TOGGLE_TTL_ACTION = 'toggle-ttl';

const SAFETY_MARGIN = 5; // display as COLD 5s before actual expiry

// One editable glyph per display state, so nerd-font / ASCII users can replace
// the emoji (which ignore the widget's color) with symbols that respect it.
const HOT_SLOT: SymbolSlot = { id: 'symbolHot', label: 'Working', defaultSymbol: '🔥' };
const FRESH_SLOT: SymbolSlot = { id: 'symbolFresh', label: 'Fresh', defaultSymbol: '🟢' };
const DRAINING_SLOT: SymbolSlot = { id: 'symbolDraining', label: 'Draining', defaultSymbol: '🟡' };
const URGENT_SLOT: SymbolSlot = { id: 'symbolUrgent', label: 'Urgent', defaultSymbol: '🔴' };
const COLD_SLOT: SymbolSlot = { id: 'symbolCold', label: 'Cold', defaultSymbol: '❄️' };
const SYMBOL_SLOTS: SymbolSlot[] = [HOT_SLOT, FRESH_SLOT, DRAINING_SLOT, URGENT_SLOT, COLD_SLOT];

interface TranscriptEntry {
    type?: string;
    timestamp?: string;
    isSidechain?: boolean;
    isApiErrorMessage?: boolean;
    message?: {
        usage?: {
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_creation?: {
                ephemeral_5m_input_tokens?: number;
                ephemeral_1h_input_tokens?: number;
            };
        };
    };
}

// Whether this assistant row's request actually read or wrote the prompt
// cache. Rows without usage data cannot be classified and are assumed to be
// cache events so older transcript formats keep driving the countdown.
function hasCacheActivity(entry: TranscriptEntry): boolean {
    const usage = entry.message?.usage;
    if (!usage) {
        return true;
    }
    return (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) > 0;
}

// A single transcript record can exceed the initial tail read (pasted prompts
// and tool results reach hundreds of KiB), leaving only an unparseable
// fragment in view, so the read doubles until the state resolves or the whole
// file has been scanned.
const INITIAL_TAIL_BYTES = 32768;

/**
 * Read the last N bytes of a file, reporting whether the read reached back to
 * the start of the file. Avoids loading large transcript files entirely.
 */
function readFileTail(filePath: string, bytes: number): { text: string; isComplete: boolean } | null {
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

// The TTL tier Claude Code actually wrote on this request, read from the
// per-tier cache_creation breakdown. Undefined when the row wrote nothing
// (pure cache read) or predates the breakdown.
function detectTtlSeconds(entry: TranscriptEntry): number | undefined {
    const creation = entry.message?.usage?.cache_creation;
    if ((creation?.ephemeral_1h_input_tokens ?? 0) > 0) {
        return 3600;
    }
    if ((creation?.ephemeral_5m_input_tokens ?? 0) > 0) {
        return 300;
    }
    return undefined;
}

type TranscriptState = { isWorking: true; detectedTtl?: number } | { isWorking: false; lastAssistant: Date | null; detectedTtl?: number };

/**
 * Find the cache state from the newest main-chain rows in the transcript tail.
 * A trailing user-role row (a prompt or a tool result, both recorded as role
 * 'user' by Claude Code) means a turn is in flight and the cache is being
 * refreshed, so report { isWorking: true }. Once an assistant row has ended
 * the turn, the countdown anchors on the newest assistant row whose request
 * actually read or wrote the cache.
 * The tail read grows until a relevant record fits in view, so a trailing
 * record larger than the initial read still resolves to a state.
 */
function getTranscriptState(transcriptPath: string): TranscriptState {
    for (let bytes = INITIAL_TAIL_BYTES; ; bytes *= 2) {
        const tail = readFileTail(transcriptPath, bytes);
        if (!tail || tail.text.length === 0) {
            return { isWorking: false, lastAssistant: null };
        }
        const state = scanTailForState(tail.text);
        if (state) {
            return state;
        }
        if (tail.isComplete) {
            return { isWorking: false, lastAssistant: null };
        }
    }
}

// Scan the tail's lines newest-first for the state; null means no relevant
// record was found (so a larger tail may still surface one).
function scanTailForState(tail: string): TranscriptState | null {
    const lines = tail.split('\n').reverse();
    // Set once an assistant row is seen: the turn is over, so any older user
    // row belongs to a previous exchange and must not report HOT while the
    // scan keeps looking for the newest row with real cache activity.
    let turnFinished = false;
    let working = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const entry = JSON.parse(trimmed) as TranscriptEntry;
            // Sidechain (subagent) traffic runs against its own prompt prefix
            // and never touches this conversation's cache.
            if (entry.isSidechain === true) {
                continue;
            }
            if (entry.type === 'assistant') {
                turnFinished = true;
                // Synthetic API-error rows and requests with no cache reads
                // or writes (caching disabled or unsupported) refreshed
                // nothing: they end the in-flight state but must not anchor
                // the countdown. A malformed timestamp is likewise no anchor.
                if (entry.isApiErrorMessage !== true && hasCacheActivity(entry) && entry.timestamp) {
                    const parsed = new Date(entry.timestamp);
                    if (!Number.isNaN(parsed.getTime())) {
                        const detectedTtl = detectTtlSeconds(entry);
                        return working
                            ? { isWorking: true, detectedTtl }
                            : { isWorking: false, lastAssistant: parsed, detectedTtl };
                    }
                }
                continue;
            }
            // In flight: keep scanning only to learn the TTL tier from the
            // previous anchor, so a working turn can show the full TTL.
            if (entry.type === 'user' && !turnFinished) {
                working = true;
            }
        } catch {
            continue;
        }
    }
    return working ? { isWorking: true } : null;
}

// The configured TTL in seconds. When unset, the tier detected from the
// transcript wins, else 5 minutes; the (t)tl keybind cycles 5m/1h, and any
// other positive value can be set directly in settings.json.
function getTtlSeconds(item: WidgetItem, detectedTtl?: number): number {
    const raw = item.metadata?.[TTL_METADATA_KEY];
    if (raw === undefined) {
        return detectedTtl ?? DEFAULT_TTL_SECONDS;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > SAFETY_MARGIN ? parsed : DEFAULT_TTL_SECONDS;
}

function cycleTtl(item: WidgetItem): WidgetItem {
    const current = getTtlSeconds(item);
    const index = (TTL_OPTIONS as readonly number[]).indexOf(current);
    const next = TTL_OPTIONS[(index + 1) % TTL_OPTIONS.length] ?? DEFAULT_TTL_SECONDS;
    if (next === DEFAULT_TTL_SECONDS) {
        return removeMetadataKeys(item, [TTL_METADATA_KEY]);
    }
    return {
        ...item,
        metadata: {
            ...item.metadata,
            [TTL_METADATA_KEY]: String(next)
        }
    };
}

function formatTtlLabel(ttlSeconds: number): string {
    return ttlSeconds % 3600 === 0 ? `${ttlSeconds / 3600}h` : `${Math.round(ttlSeconds / 60)}m`;
}

function getRemainingSeconds(lastAssistant: Date, ttlSeconds: number): number {
    const elapsedSeconds = (Date.now() - lastAssistant.getTime()) / 1000;
    return ttlSeconds - SAFETY_MARGIN - elapsedSeconds;
}

function formatCountdown(remaining: number): string {
    if (remaining <= 0) {
        return 'COLD';
    }
    const m = Math.floor(remaining / 60);
    const s = Math.floor(remaining % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// The glyph for the current drain state (excluding HOT, handled in render).
function getStateSymbol(item: WidgetItem, remaining: number, ttlSeconds: number): string {
    if (remaining <= 0) {
        return getSlotSymbol(item, COLD_SLOT);
    }
    const pct = remaining / (ttlSeconds - SAFETY_MARGIN);
    if (pct > 0.5) {
        return getSlotSymbol(item, FRESH_SLOT);
    }
    if (pct > 0.2) {
        return getSlotSymbol(item, DRAINING_SLOT);
    }
    return getSlotSymbol(item, URGENT_SLOT);
}

// Fork default display (deliberate deviation from upstream): whole minutes
// only, no glyph and no HOT word (mid-turn shows the full TTL, expired shows
// COLD), `Cache: 42 min` longhand or `C: 42m` on narrow terminals, turning red
// once the remaining time drops to the warn threshold. The threshold defaults
// to 5 minutes on a 1h cache and 2 minutes on a 5m cache; `warnSeconds` in
// metadata overrides it and the (w)arn keybind cycles the presets.
// Upstream's emoji countdown is opt-in: metadata display: 'glyphs', toggled
// with the (g)lyphs keybind.
const DISPLAY_METADATA_KEY = 'display';
const GLYPHS_DISPLAY = 'glyphs';
const TOGGLE_GLYPHS_ACTION = 'toggle-glyphs';
const WARN_METADATA_KEY = 'warnSeconds';
const WARN_OPTIONS = [60, 120, 300, 600] as const;
const TOGGLE_WARN_ACTION = 'toggle-warn';
const COMPACT_WIDTH_THRESHOLD = 178;
const ANSI_RED = '\x1b[31m';
const ANSI_FG_RESET = '\x1b[39m';

function isMinutesDisplay(item: WidgetItem): boolean {
    return item.metadata?.[DISPLAY_METADATA_KEY] !== GLYPHS_DISPLAY;
}

function toggleGlyphs(item: WidgetItem): WidgetItem {
    if (!isMinutesDisplay(item)) {
        return removeMetadataKeys(item, [DISPLAY_METADATA_KEY]);
    }
    return {
        ...item,
        metadata: {
            ...item.metadata,
            [DISPLAY_METADATA_KEY]: GLYPHS_DISPLAY
        }
    };
}

function getWarnSeconds(item: WidgetItem, ttlSeconds: number): number {
    const parsed = Number.parseInt(item.metadata?.[WARN_METADATA_KEY] ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return ttlSeconds >= 3600 ? 300 : 120;
}

function cycleWarn(item: WidgetItem): WidgetItem {
    const raw = item.metadata?.[WARN_METADATA_KEY];
    const index = raw === undefined ? -1 : (WARN_OPTIONS as readonly number[]).indexOf(Number.parseInt(raw, 10));
    const next = WARN_OPTIONS[index + 1];
    if (next === undefined) {
        return removeMetadataKeys(item, [WARN_METADATA_KEY]);
    }
    return {
        ...item,
        metadata: {
            ...item.metadata,
            [WARN_METADATA_KEY]: String(next)
        }
    };
}

function renderMinutes(item: WidgetItem, context: RenderContext, value: string, warn: boolean): string {
    const width = context.terminalWidth ?? 0;
    const compact = width > 0 && width < COMPACT_WIDTH_THRESHOLD;
    const text = compact ? value.replace(' min', 'm') : value;
    const colored = warn ? `${ANSI_RED}${text}${ANSI_FG_RESET}` : text;
    if (item.rawValue) {
        return colored;
    }
    return `${compact ? 'C: ' : 'Cache: '}${colored}`;
}

function parsePayloadTtl(ttl: string | null | undefined): number | undefined {
    if (ttl === '1h') {
        return 3600;
    }
    if (ttl === '5m') {
        return 300;
    }
    return undefined;
}

// Claude Code reports its own cache expiry in the status payload
// (prompt_cache.expires_at, unix seconds). When present it is exact, so it
// beats the transcript estimate; undefined means "no payload data, fall back".
function renderFromPromptCache(item: WidgetItem, context: RenderContext): string | undefined {
    const cache = context.data?.prompt_cache;
    const expiresAt = cache?.expires_at;
    if (typeof expiresAt !== 'number') {
        return undefined;
    }
    const ttlSeconds = parsePayloadTtl(cache?.ttl) ?? getTtlSeconds(item);
    const remaining = expiresAt - Date.now() / 1000;
    const warn = remaining > 0 && remaining <= getWarnSeconds(item, ttlSeconds);
    return renderMinutes(item, context, formatMinutes(remaining), warn);
}

function formatMinutes(remaining: number): string {
    return remaining <= 0 ? 'COLD' : `${Math.ceil(remaining / 60)} min`;
}

// Joins a glyph to its countdown; a blanked glyph collapses the leading space.
function withGlyph(symbol: string, text: string): string {
    return symbol.length > 0 ? `${symbol} ${text}` : text;
}

export class CacheTimerWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows minutes left on the prompt cache (TTL auto-detected, red near expiry)'; }
    getDisplayName(): string { return 'Cache Timer'; }
    getCategory(): string { return 'Session'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const modifiers: string[] = [];

        const ttlSeconds = getTtlSeconds(item);
        if (ttlSeconds !== DEFAULT_TTL_SECONDS) {
            modifiers.push(`ttl ${formatTtlLabel(ttlSeconds)}`);
        }
        const warnRaw = item.metadata?.[WARN_METADATA_KEY];
        if (warnRaw !== undefined) {
            modifiers.push(`warn ${formatTtlLabel(Number.parseInt(warnRaw, 10))}`);
        }
        return {
            displayText: this.getDisplayName(),
            modifierText: makeModifierText(modifiers)
        };
    }

    getHideableStates(): HideableState[] {
        return [CACHE_EMPTY_HIDEABLE_STATE];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === TOGGLE_TTL_ACTION) {
            return cycleTtl(item);
        }
        if (action === TOGGLE_WARN_ACTION) {
            return cycleWarn(item);
        }
        if (action === TOGGLE_GLYPHS_ACTION) {
            return toggleGlyphs(item);
        }

        return null;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const hideWhenEmpty = isHidden(item, CACHE_EMPTY_HIDEABLE_STATE.key);

        const minutes = isMinutesDisplay(item);

        if (context.isPreview) {
            if (minutes) {
                return renderMinutes(item, context, '42 min', false);
            }
            return formatRawOrLabeledValue(item, 'Cache: ', withGlyph(getSlotSymbol(item, FRESH_SLOT), '4:52'));
        }

        // The number-only display never shows a word for missing data: it hides.
        const hideEmpty = hideWhenEmpty || minutes;

        if (minutes) {
            const fromPayload = renderFromPromptCache(item, context);
            if (fromPayload !== undefined) {
                return fromPayload;
            }
        }

        const transcriptPath = context.data?.transcript_path;
        if (!transcriptPath) {
            return hideEmpty ? null : formatRawOrLabeledValue(item, 'Cache: ', 'n/a');
        }

        const state = getTranscriptState(transcriptPath);

        if (state.isWorking) {
            if (minutes) {
                // Mid-turn the cache was just refreshed: the full TTL is left.
                const ttlSeconds = getTtlSeconds(item, state.detectedTtl);
                return renderMinutes(item, context, formatMinutes(ttlSeconds - SAFETY_MARGIN), false);
            }
            return formatRawOrLabeledValue(item, 'Cache: ', withGlyph(getSlotSymbol(item, HOT_SLOT), 'HOT'));
        }

        const { lastAssistant } = state;
        if (!lastAssistant) {
            return hideEmpty ? null : formatRawOrLabeledValue(item, 'Cache: ', 'n/a');
        }

        const ttlSeconds = getTtlSeconds(item, state.detectedTtl);
        const remaining = getRemainingSeconds(lastAssistant, ttlSeconds);
        if (minutes) {
            const warn = remaining > 0 && remaining <= getWarnSeconds(item, ttlSeconds);
            return renderMinutes(item, context, formatMinutes(remaining), warn);
        }
        const glyph = getStateSymbol(item, remaining, ttlSeconds);

        return formatRawOrLabeledValue(item, 'Cache: ', withGlyph(glyph, formatCountdown(remaining)));
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 't', label: '(t)tl', action: TOGGLE_TTL_ACTION },
            { key: 'w', label: '(w)arn', action: TOGGLE_WARN_ACTION },
            { key: 'e', label: '(e)moji', action: TOGGLE_GLYPHS_ACTION },
            getSymbolKeybind()
        ];
    }

    renderEditor(props: WidgetEditorProps) {
        return renderSymbolSlotsEditor(props, SYMBOL_SLOTS);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
