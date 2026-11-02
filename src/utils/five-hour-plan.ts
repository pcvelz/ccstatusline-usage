import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Detects a plan without a 5-hour limit (Ultra) from observation alone. Max 5x
// always reports a 5-hour percent above 0 once it is used; Ultra's stays at 0
// while the weekly climbs. So the bar is judged to be unlimited only after the
// weekly has risen WEEKLY_RISE_TO_HIDE points across readings where the 5-hour
// was 0 every single time. One 5-hour reading above 0 voids the span and
// starts it over.

const STATE_VERSION = 1 as const;
const WEEKLY_RISE_TO_HIDE = 2;

interface FiveHourPlanState {
    version: typeof STATE_VERSION;
    // Weekly percent at the start of the current all-zero span; null when none is open
    baselineWeekly: number | null;
    hidden: boolean;
}

const COLD_STATE: FiveHourPlanState = { version: STATE_VERSION, baselineWeekly: null, hidden: false };

function getDefaultStatePath(): string {
    // Lets the test run keep its readings out of the real cache
    const override = process.env.CCSTATUSLINE_FIVE_HOUR_PLAN_PATH;
    if (override) {
        return override;
    }
    const configDir = process.env.CLAUDE_CONFIG_DIR;
    const suffix = configDir ? `-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}` : '';
    return path.join(os.homedir(), '.cache', 'ccstatusline', `five-hour-plan${suffix}.json`);
}

function isState(value: unknown): value is FiveHourPlanState {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return candidate.version === STATE_VERSION
        && typeof candidate.hidden === 'boolean'
        && (candidate.baselineWeekly === null || typeof candidate.baselineWeekly === 'number');
}

function readState(statePath: string): FiveHourPlanState {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        return isState(parsed) ? parsed : COLD_STATE;
    } catch {
        return COLD_STATE;
    }
}

function writeState(statePath: string, state: FiveHourPlanState): void {
    try {
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        const tempPath = `${statePath}.${process.pid}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(state));
        fs.renameSync(tempPath, statePath);
    } catch {
        // Not persisting only means the span is judged again next run; the bar stays shown
    }
}

function nextState(previous: FiveHourPlanState, weekly: number, fiveHour: number): FiveHourPlanState {
    if (fiveHour > 0) {
        return COLD_STATE;
    }
    if (previous.hidden) {
        return previous;
    }
    // A weekly below the baseline is a new week: the old span means nothing
    const baseline = previous.baselineWeekly === null || weekly < previous.baselineWeekly
        ? weekly
        : previous.baselineWeekly;
    return {
        version: STATE_VERSION,
        baselineWeekly: baseline,
        hidden: weekly - baseline >= WEEKLY_RISE_TO_HIDE
    };
}

/**
 * Feeds one reading of the usage API into the detector and returns whether the
 * plan is judged to have no 5-hour limit. A reading missing either number says
 * nothing and changes nothing. Any failure to read or write state shows the bar.
 */
export function observeFiveHourPlan(
    weekly: number | undefined,
    fiveHour: number | undefined,
    statePath: string = getDefaultStatePath()
): boolean {
    const previous = readState(statePath);
    if (fiveHour === undefined) {
        return previous.hidden;
    }
    // A reading above 0 settles it without needing the weekly value
    if (weekly === undefined && fiveHour <= 0) {
        return previous.hidden;
    }

    const next = nextState(previous, weekly ?? 0, fiveHour);
    if (next.baselineWeekly !== previous.baselineWeekly || next.hidden !== previous.hidden) {
        writeState(statePath, next);
    }
    return next.hidden;
}
