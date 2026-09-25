// Shared types for llama-swap widget integration.
// Vocabulary mirrors the llama-swap-macos-extended menu bar
// (macos-menu/Sources/LlamaSwapMenuCore) and its shell session-throughput reader.

/**
 * Slot state keyword. NONE/PARKED/PREFILL/DECODE/FLAT/UNKNOWN come from
 * session-throughput.sh; TURN is the menu bar's word for a lane held across
 * a turn boundary (client running a local tool, no request in flight).
 * LOADING/HOT/IDLE are session-state-contract phases
 * (llama-swap.sessions/v1): HOT = holds a slot with no
 * in-flight request, IDLE = known but nothing held, LOADING = granted but
 * its model is still loading.
 */
export type SlotWord = 'NONE' | 'TURN' | 'PARKED' | 'PREFILL' | 'DECODE' | 'FLAT' | 'UNKNOWN' | 'LOADING' | 'HOT' | 'IDLE';

/**
 * One in-flight request from the /api/events inflight stream (merged across
 * snapshot/upsert/remove frames). metadata carries the fork's session
 * identity contract fields: session_id, agent_id, slot_granted, slot_id,
 * slot_affinity, kv_parked, resolved_model.
 */
export interface InflightEntry {
    id: string;
    model: string;
    resp_bytes?: number;
    resp_tokens?: number;
    elapsed_ms?: number;
    metadata?: Record<string, string>;
}

/**
 * One serving slot's raw llama.cpp counters from the fork's GET /api/slots
 * (flat n_decoded - the fork flattens llama-server's next_token wrapper).
 */
export interface SlotCounters {
    id: number;
    is_processing: boolean;
    n_prompt_tokens: number;
    n_prompt_tokens_processed: number;
    /** Reused KV-cache prefix for this request (a cache-resumed retry
     *  reports this instead of re-processing it). Optional: absent on older
     *  llama.cpp builds that do not report the field - treat as 0. */
    n_prompt_tokens_cache?: number;
    n_decoded: number;
}

/** Per-model slot view from GET /api/slots, keyed by llama-swap's model ID. */
export interface ModelSlots {
    model: string;
    state: string;
    slots: SlotCounters[];
    error?: string;
}

/**
 * The resolved readout for the status line's own session lane: the word,
 * the joined slot's context size, and the measured rate. Equivalent to one
 * menu bar row's "<WORD> · <context> · <rate>".
 */
export interface LaneReadout {
    sessionId: string;
    word: SlotWord;
    /** llama-swap model ID stamped on the in-flight entry */
    model: string;
    /** How far the slot has progressed: the reused KV-cache prefix plus
     *  n_prompt_tokens_processed plus n_decoded. On a cache-resumed retry
     *  the processed counter alone reads as barely started even though the
     *  cached prefix already covers most of the prompt. */
    contextUsed: number | null;
    /** Contract mode: the slot's context window (context.window). Fallback
     *  mode: the session's own chat context accounting. */
    contextTotal: number | null;
    /** Measured counter rate in tokens/second; null when no rate is truthful */
    tokensPerSecond: number | null;
    /** Epoch ms when this readout was last measured live */
    at: number;
    /** 'contract' when this lane came straight from the session-state
     *  contract's /api/sessions body (no client-side phase/context/rate
     *  math); 'fallback' when the contract endpoint 404'd or timed out and
     *  this lane was computed client-side from /api/slots + /api/events. */
    source?: 'contract' | 'fallback';
    /** PREFILL progress from the contract, 0-1: (cached + processed) /
     *  promptTotal. Undefined in fallback mode, where the widget derives its
     *  own share from contextUsed / the chat's own context accounting. */
    progress?: number | null;
    /** What tokensPerSecond measures, from the contract's rate.kind. */
    rateKind?: RateKind | null;
    /** The contract's numeric priority (tier rank); undefined in fallback
     *  mode, where no priority signal exists. */
    priority?: number | null;
    /** Set only when word is PARKED, contract mode only. */
    parkReason?: string | null;
    /** First 8 chars of the session id (or request id), contract mode only. */
    sessionShort?: string;
    /** The full prompt size for the in-flight request (n_prompt_tokens),
     *  contract mode only. */
    promptTotal?: number | null;
}

/** What a contract-sourced rate measures: prefill counts processed tokens,
 *  decode counts generated tokens - never the reused cache prefix. */
export type RateKind = 'prefill' | 'decode';

/** llama-swap data passed to widgets via RenderContext. */
export interface LlamaSwapData {
    lane: LaneReadout | null;
    fetched: boolean;
    error?: string;
}

/**
 * Per-lane counter sample persisted across renders (the status line is a
 * fresh process per render, so the menu bar's in-memory SlotSample lives in
 * a small JSON file here). Rate is measured over the span in which a counter
 * actually MOVED, never over the poll gap - llama-server advances
 * n_prompt_tokens_processed once per ubatch, so a naive delta/poll-gap rate
 * spikes to absurd values on the step tick.
 */
export interface LaneSample {
    prefillProcessed: number;
    decoded: number;
    at: number;
    lastChangeAt: number;
    lastRate: number | null;
    lastRateAt: number;
}
