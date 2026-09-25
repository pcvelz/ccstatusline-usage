/**
 * Types for the `llama-swap.sessions/v1` session-state contract.
 * The contract spec and its canonical fixtures live with the llama-swap
 * backend configuration. llama-swap computes phase/context/rate ONCE server-side;
 * this client only renders the body - see session-state.ts.
 */

export type SessionPhase = 'PARKED' | 'LOADING' | 'PREFILL' | 'DECODE' | 'HOT' | 'IDLE';

export type ParkReason = 'cap' | 'kv' | 'busy' | 'cooldown' | 'loading' | 'rank' | 'swap-collision' | 'memory-brake';

export type RateKind = 'prefill' | 'decode';

export interface ResidentInfo {
    model: string;
    alias: string;
    state: 'loading' | 'ready' | 'stopping';
    window: number;
    slots: number;
}

export interface QueueInfo {
    waiting: number;
    byTier: Record<string, number>;
}

export type CooldownInfo = Record<string, unknown>;

export interface MemoryBrakeInfo {
    enabled: boolean;
    holding: boolean;
    remainingSeconds: number;
}

export interface SessionContext {
    used: number;
    cached: number;
    processed: number;
    decoded: number;
    promptTotal: number;
    window: number;
}

export interface SessionRate {
    kind: RateKind | null;
    tokensPerSecond: number | null;
    windowSeconds: number;
}

export interface SessionEntry {
    sessionId: string;
    sessionShort: string;
    requestId: string | null;
    model: string;
    alias: string;
    tier: string;
    priority: number;
    /** One of SessionPhase's known values, but invariant 5 requires
     *  tolerating and rendering an unknown one verbatim - so this stays a
     *  plain string rather than the closed union. */
    phase: string;
    /** One of ParkReason's known values (only set when phase === 'PARKED'),
     *  same verbatim-unknown tolerance as phase. */
    parkReason: string | null;
    slot: number | null;
    context: SessionContext;
    progress: number | null;
    rate: SessionRate;
    elapsedMs: number;
    phaseSinceMs: number;
    respTokens: number;
}

export interface SessionStateBody {
    schema: string;
    generatedAt: string;
    resident: ResidentInfo | null;
    queue: QueueInfo;
    cooldown: CooldownInfo | null;
    memoryBrake: MemoryBrakeInfo;
    sessions: SessionEntry[];
}

export const SESSION_STATE_SCHEMA = 'llama-swap.sessions/v1';
