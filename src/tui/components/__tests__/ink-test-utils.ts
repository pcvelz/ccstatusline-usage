/**
 * Shared timing helpers for Ink component tests.
 *
 * Every Ink test file used to carry its own `flushInk()` - a fixed 25ms sleep.
 * That is a race: when vitest runs several component files in parallel, Ink has
 * not necessarily re-rendered within 25ms, so the assertion right after the
 * sleep reads stale output. The failure moves between files depending on which
 * ones happen to share a worker, which is what made it look like cross-file
 * state leakage.
 *
 * `waitFor` replaces the guesswork: it polls until the condition the test is
 * actually waiting for holds, so a slow render costs a few extra milliseconds
 * instead of a spurious failure.
 */

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Yield to Ink's render loop. Kept for the many call sites that only need to
 * let a render settle before reading output, with a longer budget than the
 * original 25ms so it does not lose the race under parallel load.
 */
export async function flushInk(): Promise<void> {
    await delay(50);
}

/**
 * Poll `predicate` until it returns true, or throw once `timeout` elapses.
 * Prefer this over `flushInk()` whenever the test knows what it is waiting for
 * (rendered text, a mock having been called).
 */
export async function waitFor(predicate: () => boolean, options: { timeout?: number; interval?: number; message?: string } = {}): Promise<void> {
    const { timeout = 2000, interval = 10, message = 'condition not met' } = options;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (predicate())
            return;

        await delay(interval);
    }

    if (predicate())
        return;

    throw new Error(`waitFor: ${message} within ${timeout}ms`);
}

/** Wait until `getOutput()` contains `text`. */
export async function waitForOutput(getOutput: () => string, text: string, timeout = 2000): Promise<void> {
    await waitFor(() => getOutput().includes(text), { timeout, message: `output never contained ${JSON.stringify(text)}` });
}
