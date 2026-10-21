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

## Limit changes

A plan or limit change (for example Max 5 to Max 20) moves the rate and the offset, and the
weekly value drops while its reset time stays the same. Inside one weekly window a weekly
value lower than the previous valid sample is therefore a limit change:

- It starts a new stretch, exactly like a lossy reset. Crossings after it have their own
  stretch id and `cLo`/`cHi` relative to the limit-change sample.
- `latestLimitChange` returns the ts of the most recent one across all windows. A drop across
  different weekly windows is a normal weekly reset, not a limit change.
- The store records it as `limitChangeAt`, and the stored fit only uses crossings from then on.
- The live estimate only uses points from the latest limit change on, including the
  window-fit fallback, so pre-change data never leaks into the rate.

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
- `fit`: `fitRate` over the last 40 crossings at or after `limitChangeAt`, so a limit change
  rebases the fit immediately.
- `limitChangeAt`: ts of the latest limit change (see below), or null. The later of the stored
  value and the one found in the samples wins. Files without the field read as null.
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
