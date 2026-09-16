// Shared types for llama-swap widget integration.
// Vocabulary mirrors the llama-swap-macos-extended menu bar
// (macos-menu/Sources/LlamaSwapMenuCore) and its shell session-throughput reader.

/**
 * Slot state keyword. NONE/PARKED/PREFILL/DECODE/FLAT/UNKNOWN come from
 * session-throughput.sh; TURN is the menu bar's word for a lane held across
 * a turn boundary (client running a local tool, no request in flight).
 */
export type SlotWord = 'NONE' | 'TURN' | 'PARKED' | 'PREFILL' | 'DECODE' | 'FLAT' | 'UNKNOWN';

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
    /** How far the slot has progressed: n_prompt_tokens_processed + n_decoded */
    contextUsed: number | null;
    /** The original context size: the slot's full n_prompt_tokens */
    contextTotal: number | null;
    /** Measured counter rate in tokens/second; null when no rate is truthful */
    tokensPerSecond: number | null;
    /** Epoch ms when this readout was last measured live */
    at: number;
}

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
