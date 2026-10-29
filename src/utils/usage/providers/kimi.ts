import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

import { getClaudeConfigDir } from '../../claude-settings';
import type {
    UsageData,
    UsageError
} from '../../usage-types';
import type { UsageProvider } from '../types';

const CACHE_MAX_AGE = 180;
const LOCK_MAX_AGE = 30;
const MAX_LOCK_HORIZON = 24 * 60 * 60;
const DEFAULT_RATE_LIMIT_BACKOFF = 300;
const REQUEST_TIMEOUT_MS = 5000;

export interface KimiProviderConfig {
    apiKey: string;
    baseUrl: string;
    cacheDir?: string;
}

const KimiDetailSchema = z.looseObject({
    limit: z.string().nullable().optional(),
    used: z.string().nullable().optional(),
    resetTime: z.string().nullable().optional()
}).nullable().optional();

const KimiRatioWindowSchema = z.looseObject({
    used_ratio: z.number().nullable().optional(),
    reset_time: z.string().nullable().optional()
}).nullable().optional();

const KimiResponseSchema = z.looseObject({
    usage: KimiDetailSchema,
    limits: z.array(z.looseObject({
        window: z.looseObject({
            duration: z.number().nullable().optional(),
            timeUnit: z.string().nullable().optional()
        }).nullable().optional(),
        detail: KimiDetailSchema
    })).nullable().optional(),
    usages: z.looseObject({
        limit_5h: KimiRatioWindowSchema,
        limit_7d: KimiRatioWindowSchema
    }).nullable().optional()
});

const CachedKimiUsageSchema = z.looseObject({
    sessionUsage: z.number().optional(),
    sessionResetAt: z.string().optional(),
    weeklyUsage: z.number().optional(),
    weeklyResetAt: z.string().optional(),
    provider: z.literal('kimi').optional(),
    tokenHash: z.string().optional()
});

const KimiLockSchema = z.object({
    blockedUntil: z.number(),
    error: z.enum(['timeout', 'rate-limited', 'parse-error']).optional()
});

type KimiLockError = z.infer<typeof KimiLockSchema>['error'];
type KimiFetchResult = { kind: 'success'; body: string }
    | { kind: 'rate-limited'; retryAfterSeconds: number }
    | { kind: 'error' };

interface CachedKimiUsage {
    data: UsageData;
    fetchedAtMs: number;
}

function ratioPercentage(ratio: number | null | undefined): number | undefined {
    return typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0 ? ratio * 100 : undefined;
}

function detailPercentage(detail: z.infer<typeof KimiDetailSchema>): number | undefined {
    if (!detail?.used || !detail.limit) {
        return undefined;
    }
    const used = Number(detail.used);
    const limit = Number(detail.limit);
    return Number.isFinite(used) && Number.isFinite(limit) && used >= 0 && limit > 0
        ? (used / limit) * 100
        : undefined;
}

export function parseKimiUsageResponse(rawJson: string): UsageData | null {
    let parsed: z.infer<typeof KimiResponseSchema>;
    try {
        const result = KimiResponseSchema.safeParse(JSON.parse(rawJson));
        if (!result.success) {
            return null;
        }
        parsed = result.data;
    } catch {
        return null;
    }

    const sessionFallback = parsed.limits?.find(limit => (
        limit.window?.duration === 300 && limit.window.timeUnit === 'TIME_UNIT_MINUTE'
    ))?.detail;
    const sessionWindow = parsed.usages?.limit_5h;
    const weeklyWindow = parsed.usages?.limit_7d;
    const data: UsageData = {
        sessionUsage: ratioPercentage(sessionWindow?.used_ratio) ?? detailPercentage(sessionFallback),
        sessionResetAt: sessionWindow?.reset_time ?? sessionFallback?.resetTime ?? undefined,
        weeklyUsage: ratioPercentage(weeklyWindow?.used_ratio) ?? detailPercentage(parsed.usage),
        weeklyResetAt: weeklyWindow?.reset_time ?? parsed.usage?.resetTime ?? undefined,
        provider: 'kimi'
    };

    return data.sessionUsage === undefined && data.weeklyUsage === undefined ? null : data;
}

function normalizeBaseUrl(baseUrl: string): string {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Kimi base URL must use HTTP or HTTPS');
    }
    url.hash = '';
    url.search = '';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url.toString();
}

function fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function parseRetryAfterSeconds(headerValue: string | string[] | undefined, nowMs = Date.now()): number | null {
    const rawValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const trimmedValue = rawValue?.trim();
    if (!trimmedValue) {
        return null;
    }
    if (/^\d+$/.test(trimmedValue)) {
        const seconds = Number.parseInt(trimmedValue, 10);
        return seconds > 0 ? seconds : null;
    }
    const retryAtMs = Date.parse(trimmedValue);
    if (Number.isNaN(retryAtMs)) {
        return null;
    }
    const retryAfterSeconds = Math.ceil((retryAtMs - nowMs) / 1000);
    return retryAfterSeconds > 0 ? retryAfterSeconds : null;
}

async function fetchFromKimiApi(url: URL, apiKey: string): Promise<KimiFetchResult> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result: KimiFetchResult) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(deadline);
            resolve(result);
        };
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(url, {
            method: 'GET',
            headers: { 'x-api-key': apiKey },
            timeout: REQUEST_TIMEOUT_MS
        }, (response) => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => { data += chunk; });
            response.on('end', () => {
                if (response.statusCode === 200 && data) {
                    finish({ kind: 'success', body: data });
                    return;
                }
                if (response.statusCode === 429) {
                    finish({
                        kind: 'rate-limited',
                        retryAfterSeconds: parseRetryAfterSeconds(response.headers['retry-after']) ?? DEFAULT_RATE_LIMIT_BACKOFF
                    });
                    return;
                }
                finish({ kind: 'error' });
            });
        });
        request.on('error', () => { finish({ kind: 'error' }); });
        request.on('timeout', () => {
            request.destroy();
            finish({ kind: 'error' });
        });
        const deadline = setTimeout(() => {
            request.destroy();
            finish({ kind: 'error' });
        }, REQUEST_TIMEOUT_MS);
        request.end();
    });
}

export function createKimiProvider(config: KimiProviderConfig): UsageProvider {
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const usageUrl = new URL('v1/usages', baseUrl);
    const cacheDir = config.cacheDir ?? path.join(os.homedir(), '.cache', 'ccstatusline');
    const cacheKey = fingerprint(`${path.resolve(getClaudeConfigDir())}\n${baseUrl}`);
    const cacheFile = path.join(cacheDir, `kimi-usage-${cacheKey}.json`);
    const lockFile = path.join(cacheDir, `kimi-usage-${cacheKey}.lock`);
    const tokenHash = config.apiKey ? fingerprint(config.apiKey) : null;
    let memoryCache: { data: UsageData; maxAge: number; time: number } | null = null;

    const cacheData = (data: UsageData, now: number, maxAge = CACHE_MAX_AGE): UsageData => {
        memoryCache = { data, maxAge, time: now };
        return data;
    };

    const readCache = (): CachedKimiUsage | null => {
        try {
            const rawCache = fs.readFileSync(cacheFile, 'utf8');
            const result = CachedKimiUsageSchema.safeParse(JSON.parse(rawCache));
            if (!result.success || (tokenHash !== null && result.data.tokenHash !== tokenHash)) {
                return null;
            }
            return {
                data: {
                    sessionUsage: result.data.sessionUsage,
                    sessionResetAt: result.data.sessionResetAt,
                    weeklyUsage: result.data.weeklyUsage,
                    weeklyResetAt: result.data.weeklyResetAt,
                    provider: 'kimi'
                },
                fetchedAtMs: fs.statSync(cacheFile).mtimeMs
            };
        } catch {
            return null;
        }
    };

    const staleOrError = (error: UsageError, now: number, maxAge = LOCK_MAX_AGE): UsageData => {
        const stale = readCache();
        if (stale) {
            return cacheData(stale.data, now);
        }
        return cacheData({ error, provider: 'kimi' }, now, maxAge);
    };

    const ensureCacheDir = (): void => {
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
    };

    const writeCache = (data: UsageData): void => {
        try {
            ensureCacheDir();
            fs.writeFileSync(cacheFile, JSON.stringify({ ...data, tokenHash: tokenHash ?? undefined }));
        } catch {
            // Cache writes are best-effort, matching the Anthropic provider.
        }
    };

    const writeLock = (blockedUntil: number, error: NonNullable<KimiLockError>): string => {
        const contents = JSON.stringify({ blockedUntil, error });
        try {
            ensureCacheDir();
            fs.writeFileSync(lockFile, contents);
        } catch {
            // Lock writes are best-effort, matching the Anthropic provider.
        }
        return contents;
    };

    const clearOwnLock = (ownContents: string): void => {
        try {
            if (fs.readFileSync(lockFile, 'utf8') === ownContents) {
                fs.rmSync(lockFile, { force: true });
            }
        } catch {
            // Ignore lock cleanup errors.
        }
    };

    const readActiveLock = (now: number): { blockedUntil: number; error: NonNullable<KimiLockError> } | null => {
        try {
            const rawLock = fs.readFileSync(lockFile, 'utf8');
            const result = KimiLockSchema.safeParse(JSON.parse(rawLock));
            if (result.success) {
                if (result.data.blockedUntil > now && result.data.blockedUntil <= now + MAX_LOCK_HORIZON) {
                    return { blockedUntil: result.data.blockedUntil, error: result.data.error ?? 'timeout' };
                }
                return null;
            }
        } catch {
            // Fall through to the legacy mtime lock.
        }
        try {
            const blockedUntil = Math.floor(fs.statSync(lockFile).mtimeMs / 1000) + LOCK_MAX_AGE;
            return blockedUntil > now ? { blockedUntil, error: 'timeout' } : null;
        } catch {
            return null;
        }
    };

    return {
        name: 'kimi',
        async fetchUsage(): Promise<UsageData> {
            const now = Math.floor(Date.now() / 1000);
            if (memoryCache && now - memoryCache.time < memoryCache.maxAge) {
                return memoryCache.data;
            }

            const cached = readCache();
            if (cached && Math.abs(now - Math.floor(cached.fetchedAtMs / 1000)) < CACHE_MAX_AGE) {
                return cacheData(cached.data, now);
            }

            if (!config.apiKey) {
                return staleOrError('no-credentials', now);
            }

            const activeLock = readActiveLock(now);
            if (activeLock) {
                return staleOrError(activeLock.error, now, Math.max(1, activeLock.blockedUntil - now));
            }

            const inFlightLock = writeLock(now + LOCK_MAX_AGE, 'timeout');
            try {
                const response = await fetchFromKimiApi(usageUrl, config.apiKey);
                if (response.kind === 'rate-limited') {
                    writeLock(now + response.retryAfterSeconds, 'rate-limited');
                    return staleOrError('rate-limited', now, response.retryAfterSeconds);
                }
                if (response.kind === 'error') {
                    return staleOrError('api-error', now);
                }

                const data = parseKimiUsageResponse(response.body);
                if (!data) {
                    writeLock(now + LOCK_MAX_AGE, 'parse-error');
                    return staleOrError('parse-error', now);
                }

                writeCache(data);
                clearOwnLock(inFlightLock);
                return cacheData(data, now);
            } catch {
                writeLock(now + LOCK_MAX_AGE, 'parse-error');
                return staleOrError('parse-error', now);
            }
        }
    };
}
