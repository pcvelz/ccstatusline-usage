import {
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync
} from 'fs';
import {
    dirname,
    join
} from 'path';

import { CACHE_DIR } from './rate-limit-snapshot';
import {
    fitRate,
    type RateFit,
    type WeeklyCrossing
} from './weekly-estimate';

// Derived store of weekly crossings. Written only by scripts/usage-sampler.ts; the render
// path reads it. Deleting it is safe: the sampler rebuilds it from the sample file.
export const CALIBRATION_FILE = join(CACHE_DIR, 'weekly-calibration.json');

export interface CalibrationStore {
    version: 2;
    crossings: WeeklyCrossing[];
    fit: RateFit | null;
    // ts of the latest limit change (a weekly drop inside one window). The fit ignores
    // crossings before it, so a plan change rebases the rate immediately.
    limitChangeAt: string | null;
    updatedAt: string;
}

const MAX_CROSSINGS = 200;
// Only recent crossings are fitted (after the latest limit change, which rebases the fit at once)
const FIT_WINDOW = 40;
const SAMPLE_MAX_AGE_DAYS = 14;

// One crossing per weekly level per week; reset times jitter, so the key rounds to the minute
function crossingKey(c: WeeklyCrossing): string {
    return `${Math.round(Date.parse(c.weeklyResetAt) / 60_000)}|${c.level}`;
}

// Incoming crossings are recomputed from the sample file every tick and replace stored ones with
// the same key; stored crossings the samples no longer cover (pruned) stay.
export function mergeCrossings(
    store: CalibrationStore | null,
    incoming: WeeklyCrossing[],
    now: Date,
    limitChangeAt: string | null = null
): CalibrationStore {
    const stored = store?.limitChangeAt ?? null;
    const effective = stored !== null && (limitChangeAt === null || Date.parse(stored) >= Date.parse(limitChangeAt))
        ? stored
        : limitChangeAt;
    const byKey = new Map<string, WeeklyCrossing>();
    for (const c of [...(store?.crossings ?? []), ...incoming])
        byKey.set(crossingKey(c), c);

    const crossings = [...byKey.values()]
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .slice(-MAX_CROSSINGS);
    const cutoff = effective === null ? -Infinity : Date.parse(effective);
    const eligible = crossings.filter(c => Date.parse(c.at) >= cutoff);
    return {
        version: 2,
        crossings,
        fit: fitRate(eligible.slice(-FIT_WINDOW)),
        limitChangeAt: effective,
        updatedAt: now.toISOString()
    };
}

// Missing, corrupt, or unknown-version (including v1 observation stores) files read as no store
export function readCalibration(file = CALIBRATION_FILE): CalibrationStore | null {
    try {
        const store = JSON.parse(readFileSync(file, 'utf8')) as Partial<CalibrationStore>;
        if (store.version !== 2 || !Array.isArray(store.crossings))
            return null;
        // Files written before limit changes were tracked lack the field
        return { ...store, limitChangeAt: store.limitChangeAt ?? null } as CalibrationStore;
    } catch {
        return null;
    }
}

export function writeCalibration(store: CalibrationStore, file = CALIBRATION_FILE): void {
    mkdirSync(dirname(file), { recursive: true });
    // Write-then-rename: status lines read this file concurrently
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(store));
    renameSync(tmp, file);
}

// Timestamp of one sample line, or NaN when the line is corrupt or has no usable ts
function lineTime(line: string): number {
    try {
        const row = JSON.parse(line) as { ts?: unknown };
        return typeof row.ts === 'string' ? Date.parse(row.ts) : NaN;
    } catch {
        return NaN;
    }
}

// Keeps the lines newer than maxAgeDays. Corrupt lines and lines without a valid ts are dropped.
export function pruneSamples(text: string, now: Date, maxAgeDays = SAMPLE_MAX_AGE_DAYS): string {
    const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
    const kept = text.split('\n').filter(line => line.trim() && lineTime(line) >= cutoff);
    return kept.length === 0 ? '' : `${kept.join('\n')}\n`;
}
