#!/usr/bin/env bun

// One API call per run: records the weekly and five-hour usage from /api/oauth/usage
// to ~/.cache/ccstatusline/usage-samples.jsonl. Meant to run every 120s from launchd.
//
// Every run takes a fresh reading through fetchFreshUsageData, which shares the usage.lock
// rate-limit budget and refreshes the shared usage.json cache. The status line therefore
// never fetches on its own while the sampler runs, so the two cannot race for one budget.
// Singleton: a PID lock makes an overlapping tick exit at once. After each sample the
// calibration store (weekly-calibration.json) is rebuilt from the sample file. This script
// is the only writer of both files; the render path only reads them.

import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'fs';
import { join } from 'path';

import { CACHE_DIR } from '../src/utils/rate-limit-snapshot';
import { fetchFreshUsageData } from '../src/utils/usage-fetch';
import {
    mergeCrossings,
    pruneSamples,
    readCalibration,
    writeCalibration
} from '../src/utils/weekly-calibration';
import {
    USAGE_SAMPLE_FILE,
    extractCrossings,
    parseSampleLines
} from '../src/utils/weekly-estimate';

const LOCK_FILE = join(CACHE_DIR, 'usage-sampler.pid');
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
        const store = mergeCrossings(readCalibration(), extractCrossings(parseSampleLines(text)), new Date());
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

    try {
        const result = await fetchFreshUsageData();
        // A locked result means no API call was made this tick (the shared backoff is active)
        if (result.kind === 'locked') {
            appendFileSync(USAGE_SAMPLE_FILE, `${JSON.stringify({ ts, error: `locked:${result.error}` })}\n`);
            return;
        }
        if (result.kind === 'error') {
            appendFileSync(USAGE_SAMPLE_FILE, `${JSON.stringify({ ts, error: result.error })}\n`);
            return;
        }
        const parsed = result.data;
        if (parsed.weeklyUsage === undefined) {
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
