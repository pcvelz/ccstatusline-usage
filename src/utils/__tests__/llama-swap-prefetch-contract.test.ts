// End-to-end coverage of prefetchLlamaSwapData against the session-state
// contract's own fixtures (local copies under
// __tests__/fixtures/session-state/), plus the
// graceful-degradation fallback path when /api/sessions is not available.

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

const LINES: WidgetItem[][] = [
    [{ id: '1', type: 'slot-status' }]
];

function loadFixtureRaw(name: string): string {
    return fs.readFileSync(path.join(__dirname, 'fixtures', 'session-state', name), 'utf8');
}

describe('prefetchLlamaSwapData - session-state contract fixtures', () => {
    let tmpHome: string;
    let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
    const savedEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-session-state-test-'));
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

    function mockSessions(status: number, body: string | null): void {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/api/sessions')) {
                if (body === null)
                    return Promise.reject(new Error('timed out'));
                return Promise.resolve(new Response(body, { status }));
            }
            return Promise.reject(new Error(`unexpected fetch in this test: ${url}`));
        });
    }

    /** For the fallback-path tests: /api/sessions fails per `sessionsBody`,
     *  but /api/events and /api/slots answer with an empty, valid snapshot
     *  so the fallback path runs to completion instead of also failing. */
    function mockSessionsFailingFallbackAvailable(status: number, sessionsBody: string | null): void {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/api/sessions')) {
                if (sessionsBody === null)
                    return Promise.reject(new Error('timed out'));
                return Promise.resolve(new Response(sessionsBody, { status }));
            }
            if (url.includes('/api/events'))
                return Promise.resolve(new Response('data:{"type":"inflight","data":"{\\"operation\\":\\"snapshot\\",\\"requests\\":[]}"}\n\n', { status: 200 }));
            if (url.includes('/api/slots'))
                return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
            return Promise.reject(new Error(`unexpected fetch in this test: ${url}`));
        });
    }

    it('renders the cache-resumed PREFILL fixture straight from the contract, unmassaged', async () => {
        mockSessions(200, loadFixtureRaw('prefill-cache-resumed.json'));

        const result = await prefetchLlamaSwapData(LINES, {
            session_id: '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00',
            context_window: { current_usage: 999 } // irrelevant on the contract path
        });

        expect(result?.lane).toMatchObject({
            word: 'PREFILL',
            contextUsed: 92170,
            contextTotal: 262144,
            tokensPerSecond: 50.7,
            source: 'contract',
            progress: 0.9001,
            rateKind: 'prefill',
            priority: 0,
            promptTotal: 102400
        });
    });

    it('renders the PARKED entry from the decode-parked-hot fixture', async () => {
        mockSessions(200, loadFixtureRaw('decode-parked-hot.json'));

        const result = await prefetchLlamaSwapData(LINES, { session_id: 'a1b2c3d4-1111-2222-3333-444455556666' });

        expect(result?.lane).toMatchObject({
            word: 'PARKED',
            parkReason: 'kv',
            priority: 10,
            progress: null,
            tokensPerSecond: null,
            source: 'contract'
        });
    });

    it('renders the DECODE entry from the decode-parked-hot fixture, contextUsed already includes the cached prefix', async () => {
        mockSessions(200, loadFixtureRaw('decode-parked-hot.json'));

        const result = await prefetchLlamaSwapData(LINES, { session_id: '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00' });

        expect(result?.lane).toMatchObject({
            word: 'DECODE',
            contextUsed: 102612,
            rateKind: 'decode',
            tokensPerSecond: 7.1,
            source: 'contract'
        });
    });

    it('renders the HOT entry from the decode-parked-hot fixture', async () => {
        mockSessions(200, loadFixtureRaw('decode-parked-hot.json'));

        const result = await prefetchLlamaSwapData(LINES, { session_id: '0f0e0d0c-aaaa-bbbb-cccc-dddddddddddd' });

        expect(result?.lane).toMatchObject({
            word: 'HOT',
            contextUsed: 31844,
            tokensPerSecond: null,
            source: 'contract'
        });
    });

    it('renders NONE, sourced contract, when the empty-box fixture has no session at all', async () => {
        mockSessions(200, loadFixtureRaw('empty-box.json'));

        const result = await prefetchLlamaSwapData(LINES, { session_id: 'anything' });

        expect(result?.lane).toMatchObject({ word: 'NONE', source: 'contract' });
    });

    it('falls back gracefully to a clearly-marked fallback lane on a 404 from /api/sessions', async () => {
        mockSessionsFailingFallbackAvailable(404, '');

        const result = await prefetchLlamaSwapData(LINES, { session_id: 'anything' });

        // No in-flight entry either (an empty /api/events + /api/slots
        // snapshot): NONE, but tagged fallback rather than contract.
        expect(result?.lane?.word).toBe('NONE');
        expect(result?.lane?.source).toBe('fallback');
    });

    it('falls back gracefully when /api/sessions times out', async () => {
        mockSessionsFailingFallbackAvailable(200, null);

        const result = await prefetchLlamaSwapData(LINES, { session_id: 'anything' });

        expect(result?.lane?.source).toBe('fallback');
    });

    it('falls back gracefully on a malformed/unrecognized body from /api/sessions', async () => {
        mockSessionsFailingFallbackAvailable(200, JSON.stringify({ not: 'the contract' }));

        const result = await prefetchLlamaSwapData(LINES, { session_id: 'anything' });

        expect(result?.lane?.source).toBe('fallback');
    });
});
