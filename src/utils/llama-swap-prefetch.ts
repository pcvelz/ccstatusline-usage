/**
 * Prefetch llama-swap data for the slot widgets. Runs before widget
 * rendering (widget render() is synchronous), like the usage prefetch.
 *
 * PRIMARY source: GET /api/sessions - the session-state contract
 * (llama-swap.sessions/v1).
 * llama-swap computes phase/context/rate ONCE server-side; this file only
 * looks up this session's own entry and copies it onto LaneReadout - see
 * session-state.ts. Polled at most once per second via a shared snapshot
 * cache file, since every status line render is a fresh process and several
 * sessions may render at once.
 *
 * FALLBACK (contract endpoint 404s, times out, or returns an unrecognized
 * body): the pre-contract client-side computation from the two raw llama.cpp
 * endpoints - the same two the menu bar and session-throughput.sh read:
 * - GET /api/events (one SSE batch; snapshot frame is sent on connect)
 * - GET /api/slots (fork control-plane endpoint, flat n_decoded counters)
 * Every fallback-sourced lane is tagged source: 'fallback' so a widget or a
 * future debug reading can tell which path served it.
 *
 * Cross-render state (rate samples, last live readout) persists under
 * ~/.cache/ccstatusline/llama-swap/ - the status line is a fresh process per
 * render, so the menu bar's in-memory holds live there.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { StatusJSON } from '../types/StatusJSON';
import type { WidgetItem } from '../types/Widget';

import {
    classifyWord,
    decodeInflightSse,
    findLaneEntry,
    isLlamaSwapBackend,
    joinSlot,
    llamaSwapBaseUrl,
    slotContextUsed,
    updateLaneSample
} from './llama-swap';
import type {
    LaneReadout,
    LaneSample,
    LlamaSwapData,
    ModelSlots
} from './llama-swap-types';
import {
    findSessionEntry,
    mapSessionEntryToLane,
    parseSessionStateBody
} from './session-state';
import type { SessionStateBody } from './session-state-types';

const FETCH_TIMEOUT_MS = 1200;

/** How often /api/sessions itself may be polled per the contract ("poll at
 *  most 1 Hz"); a shared cache file absorbs several sessions rendering
 *  within the same second. */
const SESSIONS_POLL_MIN_INTERVAL_MS = 1_000;

/** Turn-boundary holds (menu bar slotReadoutHolds): a reading a few seconds
 *  stale is allowed; a blank is not. Within READOUT_HOLD_MS the last live
 *  readout rides verbatim; within TURN_HOLD_MS it degrades to the TURN word
 *  (client running a local tool - not a backend state); beyond that the
 *  honest word is NONE. */
const READOUT_HOLD_MS = 5_000;
const TURN_HOLD_MS = 60_000;

interface PersistedState {
    samples: Record<string, LaneSample>;
    lastLane: Record<string, LaneReadout>;
}

export function hasLlamaSwapWidgets(lines: WidgetItem[][]): boolean {
    const types = new Set(['slot-status', 'slot-throughput']);
    return lines.some(line => line.some(item => types.has(item.type)));
}

export async function prefetchLlamaSwapData(
    lines: WidgetItem[][],
    data: StatusJSON | undefined
): Promise<LlamaSwapData | null> {
    if (!hasLlamaSwapWidgets(lines))
        return null;

    const sessionId = data?.session_id;
    if (!sessionId)
        return null;

    if (!isLlamaSwapBackend({ data }))
        return null;

    const base = llamaSwapBaseUrl();
    if (!base)
        return null;

    const now = Date.now();
    const sessionState = await fetchSessionsState(base, now);
    if (sessionState)
        return resolveContractLane(sessionState, sessionId, now);

    // Contract endpoint not available yet (404, timeout, or an unrecognized
    // body): drop to the pre-contract client-side computation - see the
    // module doc's FALLBACK section.
    return prefetchLlamaSwapDataFallback(data, sessionId, base, now);
}

function resolveContractLane(sessionState: SessionStateBody, sessionId: string, now: number): LlamaSwapData {
    const state = readState(sessionId);
    const entry = findSessionEntry(sessionState.sessions, sessionId);

    let lane: LaneReadout;
    if (entry) {
        lane = mapSessionEntryToLane(entry, sessionId, now);
        state.lastLane[sessionId] = lane;
    } else {
        lane = heldOrNone(state.lastLane[sessionId], sessionId, now, 'contract');
    }

    writeState(sessionId, state);
    return { lane, fetched: true };
}

/**
 * Pre-contract computation, kept only as the fallback path: decode the raw
 * inflight/slots endpoints and derive phase, context and rate client-side
 * (the stop-gap n_prompt_tokens_cache fix from 2026-09-18 lives here). Every
 * lane this produces is tagged source: 'fallback'.
 */
async function prefetchLlamaSwapDataFallback(
    data: StatusJSON | undefined,
    sessionId: string,
    base: string,
    now: number
): Promise<LlamaSwapData | null> {
    const sseRaw = await fetchEventsBatch(base);
    if (sseRaw === null)
        return { lane: null, fetched: false, error: 'events fetch failed' };
    const models = await fetchSlots(base);

    const entries = decodeInflightSse(sseRaw) ?? [];
    const state = readState(sessionId);
    const entry = findLaneEntry(entries, sessionId);

    // The bar's "end" is the session's own current context (what the C: bar
    // already shows): the prefill processes exactly those tokens, so
    // cache+processed/current_usage reads as "how far the prefill is". As of
    // llama.cpp b11028 the slot also reports n_prompt_tokens_cache (the
    // reused KV-cache prefix on a cache-resumed retry) separately from
    // n_prompt_tokens_processed (work done this request); a full prompt can
    // still be mostly cache, so the cache field must be added in, not
    // ignored - see slotContextUsed(). n_prompt_tokens itself is the full
    // prompt size for the CURRENT request, still not necessarily equal to
    // current_usage (which is the session's own accounting).
    // current_usage can be a number or an object with token breakdown
    // (same shape the C: bar unwraps in ApiUsage ContextBarWidget).
    let sessionContext: number | null = null;
    const rawUsage = data?.context_window?.current_usage;
    if (typeof rawUsage === 'number' && Number.isFinite(rawUsage) && rawUsage >= 0) {
        sessionContext = rawUsage;
    } else if (rawUsage && typeof rawUsage === 'object') {
        const u = rawUsage as Record<string, unknown>;
        const sum = (Number(u.input_tokens) || 0)
            + (Number(u.output_tokens) || 0)
            + (Number(u.cache_creation_input_tokens) || 0)
            + (Number(u.cache_read_input_tokens) || 0);
        sessionContext = Number.isFinite(sum) && sum >= 0 ? sum : null;
    }

    let lane: LaneReadout;
    if (entry) {
        const prevSample = state.samples[sessionId];
        const slot = joinSlot(entry, models);
        const word = classifyWord(entry, slot, prevSample, now);
        const { sample, rate } = updateLaneSample(prevSample, slot, now);
        state.samples[sessionId] = sample;

        lane = {
            sessionId,
            word,
            model: entry.model,
            contextUsed: slotContextUsed(slot),
            contextTotal: sessionContext,
            tokensPerSecond: rate,
            at: now,
            source: 'fallback'
        };
        state.lastLane[sessionId] = lane;
    } else {
        lane = heldOrNone(state.lastLane[sessionId], sessionId, now, 'fallback');
    }

    writeState(sessionId, state);
    return { lane, fetched: true };
}

/**
 * No in-flight entry (or contract entry) for this session: ride the hold
 * windows, then NONE. The completed-request log (/api/metrics/activity) is
 * deliberately NOT consulted here: it records finished requests, so any rate
 * derived from it is last turn's, and with several sessions interleaved it
 * attributes the wrong turn's tokens. The only live rate is the in-flight
 * entry's (or, in contract mode, the session-state body's own rate).
 */
function heldOrNone(
    held: LaneReadout | undefined,
    sessionId: string,
    now: number,
    source: 'contract' | 'fallback'
): LaneReadout {
    if (held) {
        const age = now - held.at;
        if (age <= READOUT_HOLD_MS)
            return held;
        if (age <= TURN_HOLD_MS)
            return { ...held, word: 'TURN', tokensPerSecond: null };
    }
    return { sessionId, word: 'NONE', model: '', contextUsed: null, contextTotal: null, tokensPerSecond: null, at: now, source };
}

// ── Persistence (best-effort: a state-file failure must never crash a render) ──

/**
 * One state file PER SESSION. Every Claude Code session on the box renders
 * its own status line every refresh tick, so a single shared file is a
 * read-modify-write race between processes: a render that read the file
 * before another session's write lands overwrites that session's fresh
 * sample with its stale copy (observed 2026-09-16 as a 2407 t/s prefill rate
 * measured over a 0.16s span). A per-session file has exactly one writer.
 */
function stateFilePath(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'llama-swap', `${safe}.json`);
}

function readState(sessionId: string): PersistedState {
    try {
        const raw = fs.readFileSync(stateFilePath(sessionId), 'utf8');
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        return {
            samples: parsed.samples ?? {},
            lastLane: parsed.lastLane ?? {}
        };
    } catch {
        return { samples: {}, lastLane: {} };
    }
}

function writeState(sessionId: string, state: PersistedState): void {
    try {
        const file = stateFilePath(sessionId);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(state));
    } catch {
        // losing the next render's rate precision is a much smaller defect
        // than a status line that can abort
    }
}

// ── Session-state contract (primary path) ──

interface SessionsSnapshotCache {
    fetchedAt: number;
    body: SessionStateBody;
}

/** One shared file, not per-session: /api/sessions serves the whole box's
 *  snapshot, so every session on the box can reuse the same cached read
 *  within the 1 Hz poll budget. */
function sessionsSnapshotCachePath(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'llama-swap', 'sessions-snapshot.json');
}

function readSessionsSnapshotCache(): SessionsSnapshotCache | null {
    try {
        const raw = fs.readFileSync(sessionsSnapshotCachePath(), 'utf8');
        const parsed = JSON.parse(raw) as Partial<SessionsSnapshotCache>;
        if (typeof parsed.fetchedAt !== 'number' || !parsed.body)
            return null;
        return { fetchedAt: parsed.fetchedAt, body: parsed.body };
    } catch {
        return null;
    }
}

function writeSessionsSnapshotCache(cache: SessionsSnapshotCache): void {
    try {
        const file = sessionsSnapshotCachePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(cache));
    } catch {
        // best-effort: a stale/missing cache just costs the next render an
        // extra network round trip, never a crash
    }
}

/**
 * GET /api/sessions, rate-limited to at most once per second across every
 * status-line render on the box (the contract's own poll budget). Returns
 * null when the endpoint is not available (404, timeout, malformed body) -
 * the caller reads that as "use the fallback path", not as an error to
 * surface.
 */
async function fetchSessionsState(base: string, now: number): Promise<SessionStateBody | null> {
    const cached = readSessionsSnapshotCache();
    if (cached && now - cached.fetchedAt < SESSIONS_POLL_MIN_INTERVAL_MS)
        return cached.body;

    try {
        const res = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok)
            return null;
        const json = await res.json();
        const parsed = parseSessionStateBody(json);
        if (!parsed)
            return null;
        writeSessionsSnapshotCache({ fetchedAt: now, body: parsed });
        return parsed;
    } catch {
        return null;
    }
}

// ── Fetchers (fallback path) ──

/**
 * Read one /api/events batch. llama-swap sends a full inflight snapshot on
 * connect, so the first complete frame is enough; the stream never closes,
 * so we stop after the first inflight frame or the timeout, whichever comes
 * first. Partial text on abort is still decodable.
 */
async function fetchEventsBatch(base: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, FETCH_TIMEOUT_MS);
    let text = '';

    try {
        const res = await fetch(`${base}/api/events`, {
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal
        });
        if (!res.ok || !res.body)
            return null;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
            const { done, value } = await reader.read() as { done: boolean; value?: Uint8Array };
            if (done)
                break;
            text += decoder.decode(value, { stream: true });
            // one complete frame (blank-line delimited) carrying inflight data
            if (text.includes('\n\n') && text.includes('"inflight"'))
                break;
        }
        return text || null;
    } catch {
        return text || null;
    } finally {
        clearTimeout(timer);
        if (!controller.signal.aborted)
            controller.abort();
    }
}

interface RawModelSlots {
    model: string;
    state: string;
    slots?: {
        id: number;
        is_processing: boolean;
        n_prompt_tokens?: number;
        n_prompt_tokens_processed?: number;
        /** Absent on llama.cpp builds older than b11028: treat as 0. */
        n_prompt_tokens_cache?: number;
        n_decoded?: number;
    }[];
    error?: string;
}

async function fetchSlots(base: string): Promise<ModelSlots[]> {
    try {
        const res = await fetch(`${base}/api/slots`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok)
            return [];
        const body = (await res.json()) as { models?: RawModelSlots[] };
        return (Array.isArray(body.models) ? body.models : []).map(m => ({
            model: m.model,
            state: m.state,
            slots: (Array.isArray(m.slots) ? m.slots : []).map(s => ({
                id: s.id,
                is_processing: s.is_processing,
                n_prompt_tokens: s.n_prompt_tokens ?? 0,
                n_prompt_tokens_processed: s.n_prompt_tokens_processed ?? 0,
                n_prompt_tokens_cache: s.n_prompt_tokens_cache ?? 0,
                n_decoded: s.n_decoded ?? 0
            })),
            error: m.error
        }));
    } catch {
        return [];
    }
}
