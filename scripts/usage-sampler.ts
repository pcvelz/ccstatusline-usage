#!/usr/bin/env bun

// One API call per run: records the weekly and five-hour usage from /api/oauth/usage
// to ~/.cache/ccstatusline/usage-samples.jsonl. Meant to run every 120s from launchd.
//
// Calls the API directly (no shared cache), so every run is a fresh value. Singleton:
// a PID lock makes an overlapping tick exit at once. After each sample the calibration
// store (weekly-calibration.json) is rebuilt from the sample file. This script is the only
// writer of both files; the render path only reads them.

import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'fs';
import https from 'https';
import { join } from 'path';

import { CACHE_DIR } from '../src/utils/rate-limit-snapshot';
import {
    getUsageToken,
    parseUsageApiResponse
} from '../src/utils/usage-fetch';
import {
    mergeObservations,
    pruneSamples,
    readCalibration,
    writeCalibration
} from '../src/utils/weekly-calibration';
import {
    USAGE_SAMPLE_FILE,
    extractObservations,
    parseSampleLines
} from '../src/utils/weekly-estimate';

const LOCK_FILE = join(CACHE_DIR, 'usage-sampler.pid');
const TIMEOUT_MS = 10_000;
// Above this the sample file is pruned to the retention window. 14 days of 2-min rows is
// ~1.7 MB, so the cap sits well above it: a prune runs every few days, not every tick.
const MAX_SAMPLE_FILE_BYTES = 4 * 1024 * 1024;

function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

// wx = O_EXCL: atomic. A lock whose holder PID is dead is stale and taken over.
function acquireLock(): boolean {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
            return true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
                throw err;
            const holder = Number(readFileSync(LOCK_FILE, 'utf8').trim());
            if (isProcessAlive(holder))
                return false;
            rmSync(LOCK_FILE, { force: true });
        }
    }
    return false;
}

function releaseLock(): void {
    try {
        if (readFileSync(LOCK_FILE, 'utf8').trim() === String(process.pid)) {
            rmSync(LOCK_FILE, { force: true });
        }
    } catch {
        // Lock already gone
    }
}

// Returns the raw body, or throws with the HTTP status / network error
function fetchUsageBody(token: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname: 'api.anthropic.com',
            path: '/api/oauth/usage',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'anthropic-beta': 'oauth-2025-04-20'
            },
            timeout: TIMEOUT_MS
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => { body += chunk; });
            response.on('end', () => {
                if (response.statusCode === 200)
                    resolve(body);
                else
                    reject(new Error(`HTTP ${response.statusCode}`));
            });
        });
        request.on('error', reject);
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.end();
    });
}

// Prunes the sample file past the size cap, then rebuilds the calibration store from it.
// Best-effort: a failure here must never break sampling.
function recalibrate(): void {
    try {
        let text = readFileSync(USAGE_SAMPLE_FILE, 'utf8');
        if (Buffer.byteLength(text) > MAX_SAMPLE_FILE_BYTES) {
            text = pruneSamples(text, new Date());
            // Write-then-rename so a reader never sees a half-pruned file
            const tmp = `${USAGE_SAMPLE_FILE}.tmp`;
            writeFileSync(tmp, text);
            renameSync(tmp, USAGE_SAMPLE_FILE);
        }
        const store = mergeObservations(readCalibration(), extractObservations(parseSampleLines(text)), new Date());
        writeCalibration(store);
    } catch {
        // Ignore calibration errors
    }
}

async function main(): Promise<void> {
    mkdirSync(CACHE_DIR, { recursive: true });

    if (!acquireLock()) {
        console.log('usage-sampler: another instance is running, skipping tick');
        return;
    }
    process.on('exit', releaseLock);

    const ts = new Date().toISOString();
    const token = getUsageToken();
    if (!token) {
        appendFileSync(USAGE_SAMPLE_FILE, `${JSON.stringify({ ts, error: 'no-credentials' })}\n`);
        return;
    }

    try {
        const parsed = parseUsageApiResponse(await fetchUsageBody(token));
        if (parsed?.weeklyUsage === undefined) {
            appendFileSync(USAGE_SAMPLE_FILE, `${JSON.stringify({ ts, error: 'parse-error' })}\n`);
            return;
        }
        const sample = {
            ts,
            session: parsed.sessionUsage ?? null,
            sessionResetAt: parsed.sessionResetAt ?? null,
            weekly: parsed.weeklyUsage,
            weeklyResetAt: parsed.weeklyResetAt ?? null
        };
        appendFileSync(USAGE_SAMPLE_FILE, `${JSON.stringify(sample)}\n`);
        recalibrate();
        console.log(JSON.stringify(sample));
    } catch (err) {
        appendFileSync(USAGE_SAMPLE_FILE, `${JSON.stringify({ ts, error: (err as Error).message })}\n`);
    }
}

await main();
