// Fixtures here are copies of the contract's canonical fixtures (model
// aliases genericised), kept with the llama-swap backend configuration.
// Canonical source is the contract doc; keep these copies in sync with it.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    describe,
    expect,
    it
} from 'vitest';

import {
    findSessionEntry,
    mapSessionEntryToLane,
    parseSessionStateBody
} from '../session-state';
import type { SessionStateBody } from '../session-state-types';

function loadFixture(name: string): unknown {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'session-state', name), 'utf8');
    return JSON.parse(raw);
}

/** Loads and parses a fixture, failing the test loudly (never a silent
 *  undefined) when the fixture itself does not parse as a v1 body. */
function requireBody(name: string): SessionStateBody {
    const body = parseSessionStateBody(loadFixture(name));
    if (!body)
        throw new Error(`fixture ${name} did not parse as a session-state contract body`);
    return body;
}

describe('parseSessionStateBody', () => {
    it('accepts a well-formed v1 body', () => {
        expect(parseSessionStateBody(loadFixture('prefill-cache-resumed.json'))).not.toBeNull();
    });

    it('accepts an empty-box body with resident null and no sessions', () => {
        const body = parseSessionStateBody(loadFixture('empty-box.json'));
        expect(body).not.toBeNull();
        expect(body?.resident).toBeNull();
        expect(body?.sessions).toEqual([]);
    });

    it('rejects a body with the wrong schema tag', () => {
        expect(parseSessionStateBody({ schema: 'something-else', sessions: [] })).toBeNull();
    });

    it('rejects a body missing the sessions array', () => {
        expect(parseSessionStateBody({ schema: 'llama-swap.sessions/v1' })).toBeNull();
    });

    it('rejects null, primitives, and a 404 error body', () => {
        expect(parseSessionStateBody(null)).toBeNull();
        expect(parseSessionStateBody('not found')).toBeNull();
        expect(parseSessionStateBody({ error: 'not found' })).toBeNull();
    });
});

describe('findSessionEntry', () => {
    const decodeParkedHot = requireBody('decode-parked-hot.json');

    it('finds the PARKED entry by session id', () => {
        const entry = findSessionEntry(decodeParkedHot.sessions, 'a1b2c3d4-1111-2222-3333-444455556666');
        expect(entry?.phase).toBe('PARKED');
        expect(entry?.parkReason).toBe('kv');
    });

    it('finds the DECODE entry by session id', () => {
        const entry = findSessionEntry(decodeParkedHot.sessions, '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00');
        expect(entry?.phase).toBe('DECODE');
    });

    it('finds the HOT entry (no in-flight request) by session id', () => {
        const entry = findSessionEntry(decodeParkedHot.sessions, '0f0e0d0c-aaaa-bbbb-cccc-dddddddddddd');
        expect(entry?.phase).toBe('HOT');
        expect(entry?.requestId).toBeNull();
    });

    it('returns null when the box has nothing for this session (idle/dropped/never seen)', () => {
        expect(findSessionEntry(decodeParkedHot.sessions, 'no-such-session')).toBeNull();
    });

    it('returns null against an empty sessions array', () => {
        const emptyBox = requireBody('empty-box.json');
        expect(findSessionEntry(emptyBox.sessions, 'anything')).toBeNull();
    });
});

describe('mapSessionEntryToLane - direct copy, no client-side math', () => {
    const now = 1_700_000_000_000;

    it('maps a cache-resumed prefill entry field-for-field', () => {
        const body = requireBody('prefill-cache-resumed.json');
        const entry = findSessionEntry(body.sessions, '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00');
        const lane = mapSessionEntryToLane(entry, '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00', now);

        expect(lane).toEqual({
            sessionId: '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00',
            word: 'PREFILL',
            model: 'Qwen3.8-27B-UD-Q5_K_XL',
            contextUsed: 92170,
            contextTotal: 262144,
            tokensPerSecond: 50.7,
            at: now,
            source: 'contract',
            progress: 0.9001,
            rateKind: 'prefill',
            priority: 0,
            parkReason: null,
            sessionShort: '69699f8b',
            promptTotal: 102400
        });
    });

    it('maps a PARKED entry, carrying parkReason and priority verbatim', () => {
        const body = requireBody('decode-parked-hot.json');
        const entry = findSessionEntry(body.sessions, 'a1b2c3d4-1111-2222-3333-444455556666');
        const lane = mapSessionEntryToLane(entry, 'a1b2c3d4-1111-2222-3333-444455556666', now);

        expect(lane.word).toBe('PARKED');
        expect(lane.parkReason).toBe('kv');
        expect(lane.priority).toBe(10);
        expect(lane.progress).toBeNull();
        expect(lane.tokensPerSecond).toBeNull();
        expect(lane.rateKind).toBeNull();
    });

    it('maps a DECODE entry: rate.kind is decode, contextUsed includes the cached prefix', () => {
        const body = requireBody('decode-parked-hot.json');
        const entry = findSessionEntry(body.sessions, '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00');
        const lane = mapSessionEntryToLane(entry, '69699f8b-0b1e-4c3a-9f1e-2d7c5a1b9e00', now);

        expect(lane.word).toBe('DECODE');
        expect(lane.contextUsed).toBe(102612);
        expect(lane.rateKind).toBe('decode');
        expect(lane.tokensPerSecond).toBe(7.1);
        expect(lane.progress).toBeNull();
    });

    it('maps a HOT entry: no rate, no progress, but a real contextUsed', () => {
        const body = requireBody('decode-parked-hot.json');
        const entry = findSessionEntry(body.sessions, '0f0e0d0c-aaaa-bbbb-cccc-dddddddddddd');
        const lane = mapSessionEntryToLane(entry, '0f0e0d0c-aaaa-bbbb-cccc-dddddddddddd', now);

        expect(lane.word).toBe('HOT');
        expect(lane.contextUsed).toBe(31844);
        expect(lane.tokensPerSecond).toBeNull();
    });

    it('maps a missing entry (empty box) to a NONE lane, sourced contract', () => {
        const lane = mapSessionEntryToLane(null, 'anything', now);
        expect(lane.word).toBe('NONE');
        expect(lane.source).toBe('contract');
        expect(lane.contextUsed).toBeNull();
    });
});
