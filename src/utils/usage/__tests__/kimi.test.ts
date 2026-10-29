import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    createKimiProvider,
    parseKimiUsageResponse
} from '../providers/kimi';

const LIVE_RESPONSE = {
    usage: {
        limit: '100',
        used: '10',
        remaining: '90',
        resetTime: '2026-11-02T10:38:21.579139Z'
    },
    limits: [{
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: {
            limit: '100',
            used: '19',
            remaining: '81',
            resetTime: '2026-10-29T16:38:21.579139Z'
        }
    }],
    usages: {
        limit_5h: { used_ratio: 0.1924, reset_time: '2026-10-29T16:38:21Z' },
        limit_7d: { used_ratio: 0.1017, reset_time: '2026-11-02T10:38:20Z' }
    }
};

interface TestServer {
    baseUrl: string;
    close: () => Promise<void>;
    requests: { apiKey?: string; url?: string }[];
}

const servers: TestServer[] = [];
const tempDirs: string[] = [];
const ORIGINAL_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

function createCacheDir(): string {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-kimi-test-'));
    tempDirs.push(cacheDir);
    return cacheDir;
}

async function startServer(handler: (request: http.IncomingMessage, response: http.ServerResponse) => void): Promise<TestServer> {
    const server = http.createServer(handler);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const requests: TestServer['requests'] = [];
    server.on('request', (request) => {
        requests.push({ apiKey: request.headers['x-api-key'] as string | undefined, url: request.url });
    });
    const result = {
        baseUrl: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        }),
        requests
    };
    servers.push(result);
    return result;
}

function respondJson(response: http.ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
    response.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()));
    for (const tempDir of tempDirs.splice(0)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (ORIGINAL_CONFIG_DIR === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
    } else {
        process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
    }
});

describe('parseKimiUsageResponse', () => {
    it('maps used_ratio windows to session and weekly percentages', () => {
        const result = parseKimiUsageResponse(JSON.stringify(LIVE_RESPONSE));

        expect(result?.sessionUsage).toBeCloseTo(19.24, 10);
        expect(result?.weeklyUsage).toBeCloseTo(10.17, 10);
        expect(result?.sessionResetAt).toBe('2026-10-29T16:38:21Z');
        expect(result?.weeklyResetAt).toBe('2026-11-02T10:38:20Z');
        expect(result?.provider).toBe('kimi');
    });

    it('falls back to integer limits and weekly usage when usages is absent', () => {
        const { usages: _usages, ...fallbackResponse } = LIVE_RESPONSE;
        const result = parseKimiUsageResponse(JSON.stringify(fallbackResponse));

        expect(result?.sessionUsage).toBe(19);
        expect(result?.weeklyUsage).toBe(10);
        expect(result?.sessionResetAt).toBe('2026-10-29T16:38:21.579139Z');
        expect(result?.weeklyResetAt).toBe('2026-11-02T10:38:21.579139Z');
    });

    it('rejects malformed JSON and responses without usage windows', () => {
        expect(parseKimiUsageResponse('{')).toBeNull();
        expect(parseKimiUsageResponse('{}')).toBeNull();
    });
});

describe('Kimi usage provider', () => {
    it('requests v1/usages with the x-api-key header', async () => {
        const server = await startServer((_request, response) => { respondJson(response, 200, LIVE_RESPONSE); });
        const provider = createKimiProvider({ baseUrl: server.baseUrl, apiKey: 'secret', cacheDir: createCacheDir() });

        const result = await provider.fetchUsage();

        expect(result.sessionUsage).toBeCloseTo(19.24, 10);
        expect(result.provider).toBe('kimi');
        expect(server.requests).toEqual([{ apiKey: 'secret', url: '/v1/usages' }]);
    });

    it('joins v1/usages after a direct coding base path', async () => {
        const server = await startServer((_request, response) => { respondJson(response, 200, LIVE_RESPONSE); });
        const provider = createKimiProvider({ baseUrl: `${server.baseUrl}coding/`, apiKey: 'secret', cacheDir: createCacheDir() });

        await provider.fetchUsage();

        expect(server.requests).toEqual([{ apiKey: 'secret', url: '/coding/v1/usages' }]);
    });

    it('reuses memory and disk caches in Kimi-only files', async () => {
        const cacheDir = createCacheDir();
        const server = await startServer((_request, response) => { respondJson(response, 200, LIVE_RESPONSE); });
        const config = { baseUrl: server.baseUrl, apiKey: 'secret', cacheDir };
        const provider = createKimiProvider(config);

        await provider.fetchUsage();
        await provider.fetchUsage();
        const result = await createKimiProvider(config).fetchUsage();

        expect(result.weeklyUsage).toBeCloseTo(10.17, 10);
        expect(server.requests).toHaveLength(1);
        expect(fs.readdirSync(cacheDir)).toEqual([expect.stringMatching(/^kimi-usage-[a-f0-9]{16}\.json$/)]);
    });

    it('scopes disk caches by CLAUDE_CONFIG_DIR', async () => {
        const cacheDir = createCacheDir();
        const server = await startServer((_request, response) => { respondJson(response, 200, LIVE_RESPONSE); });
        const config = { baseUrl: server.baseUrl, apiKey: 'secret', cacheDir };

        process.env.CLAUDE_CONFIG_DIR = path.join(cacheDir, 'profile-a');
        await createKimiProvider(config).fetchUsage();
        process.env.CLAUDE_CONFIG_DIR = path.join(cacheDir, 'profile-b');
        await createKimiProvider(config).fetchUsage();

        expect(server.requests).toHaveLength(2);
        expect(fs.readdirSync(cacheDir).filter(file => file.endsWith('.json'))).toHaveLength(2);
    });

    it('does not reuse cached usage across API keys', async () => {
        const cacheDir = createCacheDir();
        const server = await startServer((_request, response) => { respondJson(response, 200, LIVE_RESPONSE); });
        const baseConfig = { baseUrl: server.baseUrl, cacheDir };

        await createKimiProvider({ ...baseConfig, apiKey: 'first-key' }).fetchUsage();
        await createKimiProvider({ ...baseConfig, apiKey: 'second-key' }).fetchUsage();

        expect(server.requests.map(request => request.apiKey)).toEqual(['first-key', 'second-key']);
        expect(fs.readdirSync(cacheDir).filter(file => file.endsWith('.json'))).toHaveLength(1);
    });

    it('returns no-credentials without requesting when the API key is missing', async () => {
        const server = await startServer((_request, response) => { respondJson(response, 200, LIVE_RESPONSE); });
        const provider = createKimiProvider({ baseUrl: server.baseUrl, apiKey: '', cacheDir: createCacheDir() });

        expect(await provider.fetchUsage()).toEqual({ error: 'no-credentials', provider: 'kimi' });
        expect(server.requests).toHaveLength(0);
    });

    it('serves stale cached usage after an API error', async () => {
        const cacheDir = createCacheDir();
        let requestCount = 0;
        const server = await startServer((_request, response) => {
            requestCount += 1;
            respondJson(response, requestCount === 1 ? 200 : 500, requestCount === 1 ? LIVE_RESPONSE : 'failed');
        });
        const config = { baseUrl: server.baseUrl, apiKey: 'secret', cacheDir };
        await createKimiProvider(config).fetchUsage();
        const cacheFile = path.join(cacheDir, fs.readdirSync(cacheDir)[0] ?? '');
        const staleDate = new Date(Date.now() - 300_000);
        fs.utimesSync(cacheFile, staleDate, staleDate);

        const result = await createKimiProvider(config).fetchUsage();

        expect(result.error).toBeUndefined();
        expect(result.sessionUsage).toBeCloseTo(19.24, 10);
        expect(server.requests).toHaveLength(2);
        expect(fs.readdirSync(cacheDir).some(file => file.endsWith('.lock'))).toBe(true);
    });

    it('honors Retry-After with a rate-limit lock', async () => {
        const cacheDir = createCacheDir();
        const server = await startServer((_request, response) => { respondJson(response, 429, 'limited', { 'Retry-After': '3600' }); });
        const provider = createKimiProvider({ baseUrl: server.baseUrl, apiKey: 'secret', cacheDir });

        expect(await provider.fetchUsage()).toEqual({ error: 'rate-limited', provider: 'kimi' });
        expect(await provider.fetchUsage()).toEqual({ error: 'rate-limited', provider: 'kimi' });
        expect(server.requests).toHaveLength(1);
        const lockFile = fs.readdirSync(cacheDir).find(file => file.endsWith('.lock'));
        const lock = JSON.parse(fs.readFileSync(path.join(cacheDir, lockFile ?? ''), 'utf8')) as { blockedUntil: number; error: string };
        expect(lock.error).toBe('rate-limited');
        expect(lock.blockedUntil).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3500);
    });

    it('returns parse-error for a response without usage data', async () => {
        const server = await startServer((_request, response) => { respondJson(response, 200, {}); });
        const provider = createKimiProvider({ baseUrl: server.baseUrl, apiKey: 'secret', cacheDir: createCacheDir() });

        expect(await provider.fetchUsage()).toEqual({ error: 'parse-error', provider: 'kimi' });
        expect(server.requests).toHaveLength(1);
    });
});
