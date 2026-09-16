import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    LLAMA_SWAP_FALLBACK_PORTS,
    classifyWord,
    decodeInflightSse,
    findLaneEntry,
    formatCompactTokens,
    formatRate,
    isLlamaSwapBackend,
    isParked,
    joinSlot,
    llamaSwapBaseUrl,
    updateLaneSample
} from '../../utils/llama-swap';
import type {
    InflightEntry,
    LaneSample,
    ModelSlots,
    SlotCounters
} from '../../utils/llama-swap-types';

const SESSION = 'aeabe08a-1f98-4e11-8e8d-38f0dff60803';
const MODEL = 'Test-Local-27B-Q5';

function entry(overrides: Partial<InflightEntry> = {}): InflightEntry {
    return {
        id: 'req-1',
        model: MODEL,
        resp_bytes: 0,
        resp_tokens: 0,
        elapsed_ms: 5000,
        metadata: { session_id: SESSION, slot_granted: '1' },
        ...overrides
    };
}

function slot(overrides: Partial<SlotCounters> = {}): SlotCounters {
    return {
        id: 0,
        is_processing: true,
        n_prompt_tokens: 106_000,
        n_prompt_tokens_processed: 54_000,
        n_decoded: 0,
        ...overrides
    };
}

function sseFrame(payload: object): string {
    return `event:message\ndata:${JSON.stringify({ type: 'inflight', data: JSON.stringify(payload) })}\n\n`;
}

describe('decodeInflightSse', () => {
    it('decodes a snapshot frame (double-encoded payload)', () => {
        const raw = sseFrame({ operation: 'snapshot', requests: [entry()] });
        const result = decodeInflightSse(raw);
        expect(result).toHaveLength(1);
        expect(result?.[0]?.id).toBe('req-1');
    });

    it('merges upserts onto the snapshot instead of losing the set', () => {
        const raw = sseFrame({ operation: 'snapshot', requests: [entry()] })
            + sseFrame({ operation: 'upsert', request: entry({ resp_tokens: 42 }) });
        const result = decodeInflightSse(raw);
        expect(result).toHaveLength(1);
        expect(result?.[0]?.resp_tokens).toBe(42);
    });

    it('applies remove frames', () => {
        const raw = sseFrame({ operation: 'snapshot', requests: [entry()] })
            + sseFrame({ operation: 'remove', id: 'req-1' });
        expect(decodeInflightSse(raw)).toEqual([]);
    });

    it('skips non-inflight envelopes', () => {
        const raw = `data:${JSON.stringify({ type: 'logData', data: '{}' })}\n\n${sseFrame({ operation: 'snapshot', requests: [entry()] })}`;
        expect(decodeInflightSse(raw)).toHaveLength(1);
    });

    it('returns null when no inflight frame was seen', () => {
        expect(decodeInflightSse('data:{"type":"logData","data":"{}"}\n\n')).toBeNull();
        expect(decodeInflightSse('')).toBeNull();
    });
});

describe('findLaneEntry', () => {
    it('matches on metadata.session_id', () => {
        const entries = [entry(), entry({ id: 'req-2', metadata: { session_id: 'other' } })];
        expect(findLaneEntry(entries, SESSION)?.id).toBe('req-1');
    });

    it('returns null when the session has no in-flight entry', () => {
        expect(findLaneEntry([entry({ metadata: { session_id: 'other' } })], SESSION)).toBeNull();
    });
});

describe('isParked', () => {
    it('is parked when kv_parked=1 even with a slot granted', () => {
        expect(isParked(entry({ metadata: { kv_parked: '1', slot_granted: '1' } }))).toBe(true);
    });

    it('is parked when slot_granted is absent', () => {
        expect(isParked(entry({ metadata: { session_id: SESSION } }))).toBe(true);
    });

    it('is not parked with a granted slot', () => {
        expect(isParked(entry())).toBe(false);
    });
});

describe('classifyWord', () => {
    const now = 100_000;

    it('PARKED wins before any byte/token heuristic', () => {
        expect(classifyWord(entry({ resp_tokens: 50, metadata: { kv_parked: '1' } }), null, undefined, now)).toBe('PARKED');
        expect(classifyWord(entry({ resp_bytes: 500, metadata: {} }), null, undefined, now)).toBe('PARKED');
    });

    it('resp_tokens > 0 is DECODE (ping-immune)', () => {
        expect(classifyWord(entry({ resp_tokens: 7 }), null, undefined, now)).toBe('DECODE');
    });

    it('granted with no output yet reads PREFILL', () => {
        expect(classifyWord(entry(), null, undefined, now)).toBe('PREFILL');
    });

    it('a moving n_decoded counter outranks a zero resp_tokens', () => {
        const prev: LaneSample = { prefillProcessed: 54_000, decoded: 10, at: now - 2000, lastChangeAt: now - 2000, lastRate: null, lastRateAt: 0 };
        expect(classifyWord(entry(), slot({ n_decoded: 30 }), prev, now)).toBe('DECODE');
    });

    it('counters stale past the flat window read FLAT', () => {
        const prev: LaneSample = { prefillProcessed: 54_000, decoded: 0, at: now - 61_000, lastChangeAt: now - 61_000, lastRate: null, lastRateAt: 0 };
        expect(classifyWord(entry(), slot(), prev, now)).toBe('FLAT');
    });
});

describe('joinSlot', () => {
    const models: ModelSlots[] = [
        { model: MODEL, state: 'ready', slots: [slot({ id: 0, is_processing: false }), slot({ id: 1 })] }
    ];

    it('returns null for a parked entry (affinity is stamped on parked requests too)', () => {
        const parked = entry({ metadata: { session_id: SESSION, slot_affinity: '1' } });
        expect(joinSlot(parked, models)).toBeNull();
    });

    it('joins via slot_affinity', () => {
        const e = entry({ metadata: { session_id: SESSION, slot_granted: '1', slot_affinity: '1' } });
        expect(joinSlot(e, models)?.id).toBe(1);
    });

    it('falls back to the single processing slot', () => {
        expect(joinSlot(entry(), models)?.id).toBe(1);
    });

    it('uses metadata.resolved_model over entry.model', () => {
        const e = entry({ model: 'some-alias', metadata: { session_id: SESSION, slot_granted: '1', resolved_model: MODEL } });
        expect(joinSlot(e, models)?.id).toBe(1);
    });

    it('returns null when the model has no slots view', () => {
        expect(joinSlot(entry(), [])).toBeNull();
    });
});

describe('updateLaneSample', () => {
    const t0 = 1_000_000;

    it('first sample has no rate', () => {
        const { rate } = updateLaneSample(undefined, slot(), t0);
        expect(rate).toBeNull();
    });

    it('measures the decode counter over the span since the last move', () => {
        const prev: LaneSample = { prefillProcessed: 54_000, decoded: 100, at: t0, lastChangeAt: t0, lastRate: null, lastRateAt: 0 };
        const { rate } = updateLaneSample(prev, slot({ n_prompt_tokens_processed: 106_000, n_decoded: 150 }), t0 + 5000);
        expect(rate).toBeCloseTo(10); // 50 tokens over 5s
    });

    it('measures the prefill counter when decode has not started', () => {
        const prev: LaneSample = { prefillProcessed: 54_000, decoded: 0, at: t0, lastChangeAt: t0 - 10_000, lastRate: null, lastRateAt: 0 };
        const { rate } = updateLaneSample(prev, slot({ n_prompt_tokens_processed: 55_000 }), t0);
        expect(rate).toBeCloseTo(100); // 1000 tokens over the 10s since the last move
    });

    it('holds the last rate instead of measuring over a sub-second span', () => {
        // Two renders 160ms apart straddling one ubatch step: 389 tokens over
        // 0.16s would print 2400 t/s (seen live 2026-09-16). Too short to
        // measure; keep the previous rate and the previous baseline.
        const prev: LaneSample = { prefillProcessed: 7_773, decoded: 0, at: t0, lastChangeAt: t0, lastRate: 300, lastRateAt: t0 };
        const { sample, rate } = updateLaneSample(prev, slot({ n_prompt_tokens_processed: 8_162, n_decoded: 0 }), t0 + 160);
        expect(rate).toBe(300);
        expect(sample.lastChangeAt).toBe(t0);
        expect(sample.prefillProcessed).toBe(7_773);
    });

    it('holds the last real rate while the slot is processing', () => {
        const prev: LaneSample = { prefillProcessed: 54_000, decoded: 100, at: t0, lastChangeAt: t0, lastRate: 42, lastRateAt: t0 };
        const { rate } = updateLaneSample(prev, slot({ n_prompt_tokens_processed: 54_000, n_decoded: 100 }), t0 + 2000);
        expect(rate).toBe(42);
    });

    it('re-baselines on counter reset (new request), dropping the held rate', () => {
        const prev: LaneSample = { prefillProcessed: 106_000, decoded: 800, at: t0, lastChangeAt: t0, lastRate: 42, lastRateAt: t0 };
        const { sample, rate } = updateLaneSample(prev, slot({ n_prompt_tokens_processed: 2000, n_decoded: 0 }), t0 + 1000);
        expect(rate).toBeNull();
        expect(sample.lastRate).toBeNull();
        expect(sample.prefillProcessed).toBe(2000);
    });
});

describe('backend gate', () => {
    const saved = { ...process.env };

    afterEach(() => {
        process.env = { ...saved };
    });

    it('accepts every llama-swap control-plane port', () => {
        for (const port of LLAMA_SWAP_FALLBACK_PORTS) {
            process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}/`;
            delete process.env.LLAMA_SWAP_URL;
            expect(isLlamaSwapBackend({})).toBe(true);
            expect(llamaSwapBaseUrl()).toBe(`http://127.0.0.1:${port}`);
        }
    });

    it('rejects a loopback URL on a non-llama-swap port', () => {
        process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:8111/';
        delete process.env.LLAMA_SWAP_URL;
        expect(isLlamaSwapBackend({})).toBe(false);
        expect(llamaSwapBaseUrl()).toBeNull();
    });

    it('rejects a remote Anthropic URL', () => {
        process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
        delete process.env.LLAMA_SWAP_URL;
        expect(isLlamaSwapBackend({})).toBe(false);
    });

    it('LLAMA_SWAP_URL overrides everything', () => {
        process.env.LLAMA_SWAP_URL = 'http://127.0.0.1:9000';
        delete process.env.ANTHROPIC_BASE_URL;
        expect(isLlamaSwapBackend({})).toBe(true);
        expect(llamaSwapBaseUrl()).toBe('http://127.0.0.1:9000');
    });
});

describe('formatting', () => {
    it('formats compact token counts', () => {
        expect(formatCompactTokens(54_000)).toBe('54.0k');
        expect(formatCompactTokens(105_200)).toBe('105.2k');
        expect(formatCompactTokens(1_200_000)).toBe('1.2M');
        expect(formatCompactTokens(800)).toBe('800');
    });

    it('formats rates', () => {
        expect(formatRate(53.94)).toBe('53.9 t/s');
    });
});
