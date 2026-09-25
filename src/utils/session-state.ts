// Pure logic for the `llama-swap.sessions/v1` session-state contract:
// body validation, session lookup, and the mapping to the widgets' existing
// LaneReadout shape. NO phase/context/rate math happens here - every number
// in the mapped LaneReadout is copied straight from the contract body.
// Contract spec: owned by the llama-swap backend configuration.

import type { LaneReadout } from './llama-swap-types';
import {
    SESSION_STATE_SCHEMA,
    type SessionEntry,
    type SessionStateBody
} from './session-state-types';

/**
 * Structural validation only (no library dependency): the body must carry
 * the expected schema tag and a sessions array. Anything else - a 404 body,
 * an older/incompatible schema, a malformed JSON shape - is treated as "the
 * contract endpoint is not available yet", which sends the caller to the
 * fallback path per invariant 5 (clients ignore unknown fields, but an
 * entirely wrong shape is not "unknown fields", it is not this contract).
 */
export function parseSessionStateBody(raw: unknown): SessionStateBody | null {
    if (!raw || typeof raw !== 'object')
        return null;
    const body = raw as Record<string, unknown>;
    if (body.schema !== SESSION_STATE_SCHEMA)
        return null;
    if (!Array.isArray(body.sessions))
        return null;
    return body as unknown as SessionStateBody;
}

/** The session's own entry, by Claude Code session id. Sessions the box has
 *  dropped (IDLE past its 60s hold, or never seen) simply have no entry. */
export function findSessionEntry(sessions: SessionEntry[], sessionId: string): SessionEntry | null {
    return sessions.find(s => s.sessionId === sessionId) ?? null;
}

/**
 * Map one contract session entry straight onto the widgets' LaneReadout -
 * every field is a direct copy, never recomputed. `entry === null` means the
 * box currently reports nothing for this session (its own NONE reading, not
 * a fetch failure - the caller applies the read-hold windows on top of this
 * the same way it already does for the /api/slots fallback).
 */
export function mapSessionEntryToLane(entry: SessionEntry | null, sessionId: string, now: number): LaneReadout {
    if (!entry) {
        return {
            sessionId,
            word: 'NONE',
            model: '',
            contextUsed: null,
            contextTotal: null,
            tokensPerSecond: null,
            at: now,
            source: 'contract'
        };
    }

    return {
        sessionId,
        word: entry.phase as LaneReadout['word'],
        model: entry.model,
        contextUsed: entry.context.used,
        contextTotal: entry.context.window,
        tokensPerSecond: entry.rate.tokensPerSecond,
        at: now,
        source: 'contract',
        progress: entry.progress,
        rateKind: entry.rate.kind,
        priority: entry.priority,
        parkReason: entry.parkReason,
        sessionShort: entry.sessionShort,
        promptTotal: entry.context.promptTotal
    };
}
