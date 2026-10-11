# Weekly calibration

The API reports the weekly % as an integer. The status line adds a decimal estimated from the
five-hour session %.

## Model

    W = offset + rate * C        rate = five-hour limit / weekly limit

- `W` is the true weekly %, `C` the cumulative session % within one weekly window.
- The API reports floor(W).
- Each weekly level crossed is known only to lie between two session readings. That interval
  is a crossing: `[cLo, cHi]` is the session % before and at the step, relative to the first
  sample of the stretch.
- A stretch is a run of samples with no lossy five-hour reset (a reset whose previous sample
  was more than 6 min before the block ended). Inside a stretch nothing is lost, so crossings
  of one stretch share one offset. Crossings of different stretches never mix.

## Fitting the rate

The weekly counter trails the session counter by a varying amount, so step-to-step rates
disagree. `fitRate` (src/utils/weekly-estimate.ts) is a minimax fit:

- Find the smallest lag `tau` (session %) such that every pair of same-stretch crossings
  allows one common rate. Each crossing may sit up to `tau` outside its interval.
- The rate is the midpoint of the feasible range at that `tau`.
- `rate * tau` is the error bar of the decimal.
- Long spans pin the rate. Short jitter only raises `tau`.

## Store (version 2)

`~/.cache/ccstatusline/weekly-calibration.json`, written only by `scripts/usage-sampler.ts`.

- `crossings`: keyed by weekly reset (rounded to the minute) and level, so one crossing per
  level per week. The newest 200 are kept.
- `fit`: `fitRate` over the last 40 crossings. A limit change therefore works through within
  about 40 weekly points.
- Written atomically (`*.tmp`, then rename). The render path only reads it.
- Deleting it is safe. The sampler rebuilds it from `usage-samples.jsonl`. A missing, corrupt
  or v1 file reads as no store.

## Live estimate

Computed on each render from the sample tail plus the live snapshot:

1. Take the live weekly window and its last stretch. No crossing there means no estimate.
2. `offset` = mean over the stretch's crossings of `level - rate * (cLo + cHi) / 2`.
3. `now` = session % used since the stretch started, including the live five-hour value.
4. Value = `offset + rate * now`, clamped to `[API value, API value + 0.999]`, so the whole
   digit always matches the API.

The rate is the stored fit when present. Otherwise `fitRate` runs on the live window.

## Inspecting

```bash
cat ~/.cache/ccstatusline/weekly-calibration.json | jq '{version, n: (.crossings | length), fit: .fit}'
tail -3 ~/.cache/ccstatusline/usage-samples.jsonl
```
