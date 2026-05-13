import type { OffHoursConfig } from '../types/Settings';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Returns true when the off-hours config describes a real, non-empty window
 * that should be applied. `enabled` must be true AND start !== end (equal
 * values mean zero-length / full-day, both meaningless and treated as no-op).
 */
export function isOffHoursActive(offHours: OffHoursConfig | undefined): boolean {
    return !!offHours
        && offHours.enabled
        && offHours.startMinutes !== offHours.endMinutes;
}

/**
 * Duration of the recurring daily off window, in minutes. Handles midnight
 * wrap: e.g., 22:00 -> 07:00 returns 9*60 = 540 minutes.
 * Returns 0 when start === end.
 */
export function offWindowDurationMinutes(startMinutes: number, endMinutes: number): number {
    if (startMinutes === endMinutes)
        return 0;
    return (endMinutes - startMinutes + 1440) % 1440;
}

function overlapMs(a1: number, a2: number, b1: number, b2: number): number {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * Sum of milliseconds in [startMs, endMs] that fall within the recurring
 * daily off-hours window (specified in local-time minutes-since-midnight).
 *
 * Handles:
 *   - Wrap across midnight (endMinutes < startMinutes)
 *   - Multi-day ranges (bounded iteration, one day at a time)
 *   - DST transitions: uses `Date.setHours`, which operates in local time.
 *
 * Known DST limitation: on spring-forward mornings, if the off-window
 * boundary lands inside the nonexistent hour (typically 02:00–03:00 local),
 * `setHours(2, 0, 0, 0)` gets silently normalized to 03:00, so that day's
 * off-period is counted as 1h shorter. On fall-back mornings, the repeated
 * hour (01:00–02:00) is anchored to the *second* occurrence, so the extra
 * hour is lost. The default 22:00 → 07:00 window is unaffected because
 * neither boundary touches the DST gap. Worst case is ≤1h of skew once or
 * twice per year for an early-morning window — well below the ±5% "On Pace"
 * band on a ~105h active-hours denominator. Not worth correcting today; a
 * future fix would compare the realized hour to the requested hour and
 * nudge by the DST offset.
 */
export function offMsInRange(
    startMs: number,
    endMs: number,
    startMinutes: number,
    endMinutes: number
): number {
    if (startMs >= endMs)
        return 0;

    const durationMin = offWindowDurationMinutes(startMinutes, endMinutes);
    if (durationMin === 0)
        return 0;

    const startHour = Math.floor(startMinutes / 60);
    const startMinute = startMinutes % 60;
    const wraps = endMinutes < startMinutes;
    const endHour = Math.floor(endMinutes / 60);
    const endMinute = endMinutes % 60;

    // Begin iteration one day before startMs so a wrap-past-midnight window
    // that "began yesterday and ends today" is still accounted for.
    const cursor = new Date(startMs);
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - 1);

    let total = 0;

    // Iterate day by day. The inner exit condition (`cursor.getTime() >= endMs`)
    // is the real terminator; the outer `i` cap is a pure safety rail sized
    // proportionally to the range so this helper stays correct if a future
    // caller passes something longer than the weekly window.
    const maxIterations = Math.ceil((endMs - startMs) / MS_PER_DAY) + 3;
    for (let i = 0; i < maxIterations; i++) {
        const periodStart = new Date(cursor);
        periodStart.setHours(startHour, startMinute, 0, 0);

        const periodEnd = new Date(cursor);
        periodEnd.setHours(endHour, endMinute, 0, 0);
        if (wraps) {
            periodEnd.setDate(periodEnd.getDate() + 1);
        }

        total += overlapMs(startMs, endMs, periodStart.getTime(), periodEnd.getTime());

        cursor.setDate(cursor.getDate() + 1);
        // Stop once cursor is past the end of the range — the next day's
        // period can no longer overlap [startMs, endMs].
        if (cursor.getTime() >= endMs)
            break;
    }

    return total;
}

/**
 * Compute the expected weekly-pace percentage, adjusted for off-hours.
 *
 * Without off-hours: expected% = rawElapsed / total (linear wall-clock).
 * With off-hours:    expected% = activeElapsed / activeTotal, where off-hours
 *                                ms are subtracted from both numerator and
 *                                denominator.
 *
 * The key property: while currently inside an off-hours window, the expected%
 * does not advance — it holds steady from the moment the off-window started.
 */
export function computeAdjustedExpectedPercent(
    windowStartMs: number,
    windowEndMs: number,
    nowMs: number,
    offHours: OffHoursConfig | undefined
): number {
    const totalMs = windowEndMs - windowStartMs;
    if (totalMs <= 0)
        return 0;

    const elapsedMs = Math.max(0, Math.min(totalMs, nowMs - windowStartMs));

    // Lead with `!offHours` so TS narrows the parameter to defined for the
    // rest of the function. `isOffHoursActive` already implies `!!offHours`,
    // but the narrowing doesn't flow through a helper call.
    if (!offHours || !isOffHoursActive(offHours)) {
        return (elapsedMs / totalMs) * 100;
    }

    const offInElapsed = offMsInRange(
        windowStartMs,
        windowStartMs + elapsedMs,
        offHours.startMinutes,
        offHours.endMinutes
    );
    const offInTotal = offMsInRange(
        windowStartMs,
        windowEndMs,
        offHours.startMinutes,
        offHours.endMinutes
    );

    const activeElapsedMs = elapsedMs - offInElapsed;
    const activeTotalMs = totalMs - offInTotal;

    if (activeTotalMs <= 0)
        return 0;

    return (activeElapsedMs / activeTotalMs) * 100;
}

/**
 * Active hours per full week given an off-hours config. Useful for the TUI to
 * show the user how many hours per week they'll actually be "expected" to
 * work. Unaffected by DST (uses a flat 7-day assumption).
 */
export function activeHoursPerWeek(offHours: OffHoursConfig | undefined): number {
    if (!isOffHoursActive(offHours) || !offHours)
        return 7 * 24;
    const offMinutesPerDay = offWindowDurationMinutes(offHours.startMinutes, offHours.endMinutes);
    return 7 * 24 - (7 * offMinutesPerDay) / 60;
}

/** Format minutes-since-midnight as "HH:MM" (24-hour). */
export function formatHHMM(minutes: number): string {
    const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parse an "HH:MM" string into minutes-since-midnight. Accepts "H:MM" and
 * "HH:MM". Returns null on any malformed input.
 */
export function parseHHMM(input: string): number | null {
    const trimmed = input.trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!match)
        return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m))
        return null;
    if (h < 0 || h > 23 || m < 0 || m > 59)
        return null;
    return h * 60 + m;
}

export { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE };
