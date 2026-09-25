// Pure llama-swap logic: backend gate, /api/events SSE decode, lane
// classification, slot join, and rate measurement. The vocabulary and
// thresholds mirror the shell session-throughput reader (the single point of
// truth) and the menu bar's SessionThroughput.swift/BackendClient.swift - reimplemented,
// never re-derived, so all three readers agree about the same request.

import type { RenderContext } from '../types/RenderContext';

import type {
    InflightEntry,
    LaneSample,
    ModelSlots,
    SlotCounters,
    SlotWord
} from './llama-swap-types';

/** How long the last real rate keeps showing while the slot reports
 *  is_processing and its counters have not moved (menu bar: 30s, sized for
 *  the one-step-per-ubatch prefill cadence). */
export const PROCESSING_RATE_HOLD_MS = 30_000;

/** Shortest span a rate may be measured over; below it the previous sample
 *  is kept so the same counter delta is measured again over a real span. */
export const MIN_RATE_SPAN_MS = 1_000;

/** Counters unchanged for this long while a request is in flight = FLAT
 *  (mirrors SESSION_THROUGHPUT_FLAT_S = 60s). */
export const FLAT_WINDOW_MS = 60_000;

/**
 * The ONE backend gate: the session's own ANTHROPIC_BASE_URL points at a
 * llama-swap port (the full tier-port array below - any of them serves the
 * same control plane), or LLAMA_SWAP_URL is set explicitly. A loopback URL
 * on any OTHER port (a local relay for a remote provider, say) is NOT
 * llama-swap and must not gate in, even when llama-swap happens to run on
 * the same box. Model-ID sniffing is deliberately not used: model names and
 * internal aliases are deployment-specific and drift.
 */
function loopbackOrigin(url: string | undefined): string | null {
    if (!url)
        return null;
    const match = /^(https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)/i.exec(url.trim());
    return match?.[1] ?? null;
}

function originPort(origin: string): number | null {
    const match = /:(\d+)$/.exec(origin);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * Every llama-swap-macos-extended control-plane port (llama-swap.yaml):
 * 8001 = implicit default tier, 8002 = priority, 8003 = background. All of
 * them are transparent proxies to the same queue and slot state, so any of
 * them answers /api/events and /api/slots.
 */
export const LLAMA_SWAP_FALLBACK_PORTS = [8001, 8002, 8003];

export function isLlamaSwapBackend(_context: RenderContext): boolean {
    if (process.env.LLAMA_SWAP_URL)
        return true;
    const origin = loopbackOrigin(process.env.ANTHROPIC_BASE_URL);
    const port = origin ? originPort(origin) : null;
    return port !== null && LLAMA_SWAP_FALLBACK_PORTS.includes(port);
}

/**
 * The base URL for control-plane endpoints: LLAMA_SWAP_URL when set, else
 * the session's own llama-swap origin (a tier port is a transparent proxy
 * to the same queue and slot state). Null when the gate would not pass.
 */
export function llamaSwapBaseUrl(): string | null {
    if (process.env.LLAMA_SWAP_URL)
        return process.env.LLAMA_SWAP_URL;
    if (!isLlamaSwapBackend({}))
        return null;
    return loopbackOrigin(process.env.ANTHROPIC_BASE_URL);
}

// ── /api/events SSE decoding ──

/**
 * Decode a raw /api/events capture to the merged in-flight set. Mirrors
 * session-throughput.sh's _stp_decode_sse: the payload is double-encoded
 * (the envelope's "data" field is a JSON STRING), non-inflight frames are
 * skipped, and the three operation shapes are replayed in order - snapshot
 * replaces the set, upsert keyed-merges one entry, remove deletes one.
 * Taking the LAST frame raw is wrong: a steady decode stream fires many
 * upserts per snapshot and an upsert has no "requests" key at all.
 */
export function decodeInflightSse(raw: string): InflightEntry[] | null {
    const byId = new Map<string, InflightEntry>();
    let seenAny = false;

    for (const line of raw.split('\n')) {
        if (!line.startsWith('data:'))
            continue;
        let envelope: { type?: string; data?: string };
        try {
            envelope = JSON.parse(line.slice(5).trim()) as { type?: string; data?: string };
        } catch {
            continue;
        }
        if (envelope.type !== 'inflight' || typeof envelope.data !== 'string')
            continue;
        let payload: {
            operation?: string;
            request?: InflightEntry;
            id?: string;
            requests?: (InflightEntry | null)[];
        };
        try {
            payload = JSON.parse(envelope.data) as typeof payload;
        } catch {
            continue;
        }

        const op = payload.operation;
        if (op === 'upsert' && typeof payload.request?.id === 'string') {
            byId.set(payload.request.id, payload.request);
            seenAny = true;
        } else if (op === 'remove' && typeof payload.id === 'string') {
            byId.delete(payload.id);
            seenAny = true;
        } else {
            // snapshot (or any older full-set shape): full replacement
            byId.clear();
            for (const r of payload.requests ?? []) {
                if (typeof r?.id === 'string')
                    byId.set(r.id, r);
            }
            seenAny = true;
        }
    }

    return seenAny ? [...byId.values()] : null;
}

// ── Lane resolution and classification ──

/** The session's in-flight entry: newest match wins (a lane's id is the
 *  lane's newest request at every turn boundary). */
export function findLaneEntry(entries: InflightEntry[], sessionId: string): InflightEntry | null {
    const matches = entries.filter(e => e.metadata?.session_id === sessionId);
    return matches.length > 0 ? (matches[matches.length - 1] ?? null) : null;
}

/** The one definition of "this request holds no slot" (menu bar
 *  BackendClient.isParked): kv-admission is holding it, or the scheduler
 *  has not granted a slot yet. PARKED wins before ANY byte/token heuristic. */
export function isParked(entry: InflightEntry): boolean {
    const md = entry.metadata ?? {};
    return md.kv_parked === '1' || md.slot_granted !== '1';
}

/**
 * Single-sample word for an in-flight entry. PARKED first, always. Then
 * ping-immune: resp_tokens counts real content tokens which a keepalive ping
 * can never produce, so tokens > 0 is DECODE outright. Below that the joined
 * slot's own counters outrank the byte heuristic (menu bar slotPhases): a
 * moving n_decoded is DECODE, a moving n_prompt_tokens_processed is PREFILL.
 * Counters stale past the flat window while the request is still tracked is
 * FLAT; otherwise granted-without-output reads PREFILL, the least-wrong
 * default inside the prefill budget.
 */
export function classifyWord(
    entry: InflightEntry,
    slot: SlotCounters | null,
    prevSample: LaneSample | undefined,
    now: number
): SlotWord {
    if (isParked(entry))
        return 'PARKED';

    if ((entry.resp_tokens ?? 0) > 0)
        return 'DECODE';

    if (slot && prevSample) {
        if (slot.n_decoded > prevSample.decoded)
            return 'DECODE';
        if (slot.n_prompt_tokens_processed > prevSample.prefillProcessed)
            return 'PREFILL';
        if (now - prevSample.lastChangeAt >= FLAT_WINDOW_MS)
            return 'FLAT';
    }

    return 'PREFILL';
}

/**
 * How far a joined slot has actually progressed. n_prompt_tokens_processed
 * alone is only the work done THIS request: a cache-resumed retry restarts
 * that counter near 0 while n_prompt_tokens_cache reports the reused prefix
 * from the KV cache, so the two must be added together (plus any decoded
 * tokens) to read as the true position in the prompt. Returns null when
 * there is no joined slot to read.
 */
export function slotContextUsed(slot: SlotCounters | null): number | null {
    if (!slot)
        return null;
    return (slot.n_prompt_tokens_cache ?? 0) + slot.n_prompt_tokens_processed + slot.n_decoded;
}

// ── Slot join (menu bar BackendClient.joinedSlot) ──

/**
 * Join an in-flight entry to its serving slot in the /api/slots view.
 * A parked request holds no slot, so there is nothing truthful to join -
 * slot_affinity is stamped on EVERY request of a lane at admission, parked
 * or granted, and joining a parked row to the busy slot prints the OTHER
 * request's total and rate. Join key order: slot_affinity, slot_id, then
 * the single-processing-slot fallback. The model whose slots answer for the
 * entry is metadata.resolved_model (a resident-alias request keeps the
 * alias as entry.model, which has no slots of its own).
 */
export function joinSlot(entry: InflightEntry, models: ModelSlots[]): SlotCounters | null {
    if (isParked(entry))
        return null;

    const modelId = entry.metadata?.resolved_model ?? entry.model;
    const modelSlots = models.find(m => m.model === modelId);
    if (!modelSlots)
        return null;

    const md = entry.metadata ?? {};
    const affinity = md.slot_affinity ?? md.slot_id;
    if (typeof affinity === 'string' && affinity !== '') {
        const id = Number.parseInt(affinity, 10);
        const slot = modelSlots.slots.find(s => s.id === id);
        if (slot)
            return slot;
    }

    const processing = modelSlots.slots.filter(s => s.is_processing);
    return processing.length === 1 ? (processing[0] ?? null) : null;
}

// ── Rate measurement (menu bar SlotSample) ──

/**
 * Fold one slot reading into the lane's persisted sample and compute the
 * rate from WHICHEVER counter moved, over the span since the last move -
 * never over the poll gap (llama-server advances n_prompt_tokens_processed
 * once per ubatch, so delta/poll-gap prints ~1000 t/s on the step tick and
 * nothing for the next four polls). When neither counter moved, the last
 * real rate holds for up to PROCESSING_RATE_HOLD_MS while the slot still
 * reports is_processing; a slot that genuinely stopped drops is_processing
 * and the hold never applies.
 */
export function updateLaneSample(
    prev: LaneSample | undefined,
    slot: SlotCounters | null,
    now: number
): { sample: LaneSample; rate: number | null } {
    const prefillProcessed = slot?.n_prompt_tokens_processed ?? 0;
    const decoded = slot?.n_decoded ?? 0;

    if (!prev) {
        return {
            sample: { prefillProcessed, decoded, at: now, lastChangeAt: now, lastRate: null, lastRateAt: 0 },
            rate: null
        };
    }

    const dPrefill = prefillProcessed - prev.prefillProcessed;
    const dDecoded = decoded - prev.decoded;

    // A counter that went DOWN means a new request re-baselined the slot
    // (counters restart on every grant): drop the stale sample entirely,
    // including its held rate - last turn's t/s is not this turn's.
    if (dDecoded < 0 || dPrefill < 0) {
        return {
            sample: { prefillProcessed, decoded, at: now, lastChangeAt: now, lastRate: null, lastRateAt: 0 },
            rate: null
        };
    }

    if (dDecoded > 0 || dPrefill > 0) {
        const delta = dDecoded > 0 ? dDecoded : dPrefill;
        const spanMs = now - prev.lastChangeAt;
        // A span shorter than one second cannot be measured: two renders
        // straddling a single ubatch step read a whole step's tokens over a
        // few ms (2407 t/s seen live). Keep the previous sample untouched so
        // the next render measures the same delta over a real span.
        if (spanMs < MIN_RATE_SPAN_MS) {
            const heldRate = slot?.is_processing && prev.lastRate !== null && now - prev.lastRateAt <= PROCESSING_RATE_HOLD_MS
                ? prev.lastRate
                : null;
            return { sample: prev, rate: heldRate };
        }
        const rate = spanMs > 0 ? delta / (spanMs / 1000) : null;
        return {
            sample: { prefillProcessed, decoded, at: now, lastChangeAt: now, lastRate: rate, lastRateAt: now },
            rate
        };
    }

    const heldRate = slot?.is_processing
        && prev.lastRate !== null
        && now - prev.lastRateAt <= PROCESSING_RATE_HOLD_MS
        ? prev.lastRate
        : null;

    return {
        sample: { prefillProcessed, decoded, at: now, lastChangeAt: prev.lastChangeAt, lastRate: prev.lastRate, lastRateAt: prev.lastRateAt },
        rate: heldRate
    };
}

// ── Formatting (menu bar CompactFormatter) ──

export function formatCompactTokens(n: number): string {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}k`;
    return `${n}`;
}

export function formatRate(tokensPerSecond: number): string {
    return `${tokensPerSecond.toFixed(1)} t/s`;
}
