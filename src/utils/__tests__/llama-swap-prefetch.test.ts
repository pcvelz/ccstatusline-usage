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

import type { WidgetItem } from '../../types/Widget';
import { prefetchLlamaSwapData } from '../llama-swap-prefetch';

const SESSION = 'aeabe08a-1f98-4e11-8e8d-38f0dff60803';
const MODEL = 'Test-Local-27B-Q5';

const LINES: WidgetItem[][] = [
    [{ id: '1', type: 'slot-status' }]
];

function sseSnapshot(overrides: Record<string, unknown> = {}): string {
    const request = {
        id: 'req-1',
        model: MODEL,
        resp_bytes: 0,
        resp_tokens: 0,
        elapsed_ms: 5000,
        metadata: { session_id: SESSION, slot_granted: '1' },
        ...overrides
    };
    const payload = { operation: 'snapshot', requests: [request] };
    return `event:message\ndata:${JSON.stringify({ type: 'inflight', data: JSON.stringify(payload) })}\n\n`;
}

function slotsResponse(rawSlot: Record<string, unknown>): string {
    return JSON.stringify({ models: [{ model: MODEL, state: 'ready', slots: [rawSlot] }] });
}

describe('prefetchLlamaSwapData - context-used cache accounting', () => {
    let tmpHome: string;
    let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
    const savedEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-llama-swap-test-'));
        vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        process.env.LLAMA_SWAP_URL = 'http://127.0.0.1:8001';
        fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        globalThis.fetch = originalFetch;
        process.env = { ...savedEnv };
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    function mockBackend(rawSlot: Record<string, unknown>, requestOverrides: Record<string, unknown> = {}): void {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/api/events'))
                return Promise.resolve(new Response(sseSnapshot(requestOverrides), { status: 200 }));
            if (url.includes('/api/slots'))
                return Promise.resolve(new Response(slotsResponse(rawSlot), { status: 200 }));
            return Promise.reject(new Error(`unexpected fetch: ${url}`));
        });
    }

    it('includes the reused KV-cache prefix in contextUsed on a cache-resumed prefill retry', async () => {
        // Live slot mid-prefill after a cache-resumed retry, reported live
        // 2026-09-18: the old code showed "Prefill: 6k/102k (6%)" while the
        // real position was ~96k+6k of 102k.
        mockBackend({
            id: 0,
            is_processing: true,
            n_prompt_tokens: 102_200,
            n_prompt_tokens_processed: 5_912,
            n_prompt_tokens_cache: 96_266,
            n_decoded: 20
        });

        const result = await prefetchLlamaSwapData(LINES, {
            session_id: SESSION,
            context_window: { current_usage: 102_200 }
        });

        expect(result?.lane?.contextUsed).toBe(96_266 + 5_912 + 20);
    });

    it('falls back to cache 0 when the /api/slots payload omits n_prompt_tokens_cache (older llama.cpp build)', async () => {
        mockBackend({
            id: 0,
            is_processing: true,
            n_prompt_tokens: 106_000,
            n_prompt_tokens_processed: 54_000,
            n_decoded: 0
        });

        const result = await prefetchLlamaSwapData(LINES, {
            session_id: SESSION,
            context_window: { current_usage: 106_000 }
        });

        expect(result?.lane?.contextUsed).toBe(54_000);
    });

    it('keeps counting the cache prefix once decode starts after a cached prefill', async () => {
        mockBackend({
            id: 0,
            is_processing: true,
            n_prompt_tokens: 102_200,
            n_prompt_tokens_processed: 5_912,
            n_prompt_tokens_cache: 96_266,
            n_decoded: 500
        }, { resp_tokens: 500 });

        const result = await prefetchLlamaSwapData(LINES, {
            session_id: SESSION,
            context_window: { current_usage: 102_200 }
        });

        expect(result?.lane?.word).toBe('DECODE');
        expect(result?.lane?.contextUsed).toBe(96_266 + 5_912 + 500);
    });
});
