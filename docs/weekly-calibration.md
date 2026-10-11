# Weekly calibration

The status line shows the weekly % with a decimal. The API value is an integer, so the
decimal is an estimate:

    weekly = last integer step + rate * session % since that step   (capped below the next integer)

`rate` is weekly % per five-hour session %: the ratio of the two Anthropic limits.

## Files

Both live under `~/.cache/ccstatusline/`.

| File | Contents | Written by |
|------|----------|------------|
| `usage-samples.jsonl` | One row per sampler tick (about 2 min): weekly and five-hour usage, or an `{ts, error}` row | `scripts/usage-sampler.ts` only |
| `weekly-calibration.json` | Derived store: the last 50 step observations, plus drift metadata | `scripts/usage-sampler.ts` only |

- The render path only reads. It never writes either file.
- Both files are written atomically (write `*.tmp`, then rename), because status lines read concurrently.
- The calibration store is derived. Deleting it is safe: the next successful tick rebuilds it from the sample file.
- When the sample file grows past 1 MiB, the sampler prunes it to the last 14 days.

## Observations

An observation is one pair of consecutive integer weekly steps inside one weekly window:

- `sessionSpan` is the session % used between the two steps. A five-hour reset adds its
  post-reset usage, so the span accumulates across resets.
- `rate` is (weekly gain) / `sessionSpan`.
- Skipped when `sessionSpan` is below 5 session %. Too little usage makes the rate noise.
- Skipped when a **lossy reset** sits between the steps. A reset is lossy when the last sample
  before it was taken more than 6 min before its five-hour block ended: the usage in that gap was
  never sampled. A reset whose last sample is within 6 min of the block end is not lossy.

## Which rate the estimate uses

1. The stored rate: the median of the last 5 observation rates (needs at least 2 observations).
2. Otherwise the last observation in the live weekly window (the old two-step behaviour).
3. Otherwise no estimate: the status line shows the integer only.

## Drift and limit changes

Anthropic can change the limits, which changes the rate. Each merge runs a change-point check on
the sorted observations:

- Take the last 3 rates. If all three deviate from the median of the 5 rates before them by
  more than 25%, in the same direction, that is a change point.
- Mixed directions are noise and do not count.
- On a change point the older observations are dropped and `rebasedAt` is set to the merge time.
  `rebasedAt` is the visible trace of a limit change.
- The sample file still holds the dropped steps, so every tick re-extracts them. `rebaseCutoff`
  (the time of the first surviving observation) makes the merge ignore anything at or before it,
  so the dropped observations never come back.

## Store format (version 1)

```json
{
  "version": 1,
  "observations": [
    { "at": "2026-10-10T19:37:00.000Z", "weeklyResetAt": "2026-10-17T13:00:00.000+00:00",
      "fromWeekly": 4, "toWeekly": 5, "sessionSpan": 25, "rate": 0.04 }
  ],
  "rebasedAt": null,
  "rebaseCutoff": null,
  "updatedAt": "2026-10-10T20:00:00.000Z"
}
```

- A missing, corrupt, or unknown-version file reads as no store. The estimate then falls back to
  the window rate.
- Observations are deduplicated by `at` (the stored copy wins) and sorted; the newest 50 are kept.

## Inspecting

```bash
cat ~/.cache/ccstatusline/weekly-calibration.json | jq '{rebasedAt, rebaseCutoff, n: (.observations | length)}'
tail -3 ~/.cache/ccstatusline/usage-samples.jsonl
```
