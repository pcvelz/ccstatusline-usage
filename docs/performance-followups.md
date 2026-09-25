# Performance follow-ups: llama-swap slot widgets (post v2.4.17)

Status: open. Pick up at the start of the next session. Origin: v2.4.17 release
(2026-09-16), read-only adversarial audit of the llama-swap slot-widget path plus
an instrumented render (every fetch, socket and child process logged).

## Verified as fine

- Not on a llama-swap backend (no `ANTHROPIC_BASE_URL`, `api.anthropic.com`, or a
  loopback URL on a non-llama-swap port): zero network, zero filesystem, zero
  process spawns from this path. Four pure in-memory gates in
  `src/utils/llama-swap-prefetch.ts` return before any I/O.
- On llama-swap: exactly two HTTP requests per render (`/api/events`,
  `/api/slots`). Module load adds nothing heavy.

## The structural fix (do this first)

The proxy (llama-swap-macos-extended) already owns everything the client
recomputes: the inflight entry, real output tokens counted on the hot path,
the affinity slot, and it can sample the child's `/slots` once for all
consumers. Move the lane classification server-side:

```
GET /api/lanes            (or /api/lanes/<session_id>)
{"session_id": "...", "word": "PREFILL", "model": "...", "slot": 1,
 "prompt_processed": 57731, "prompt_total": 69787, "decoded": 0,
 "tokens_per_second": 256.4, "age_ms": 120}
```

Rules to port (single classifier, tested once): PARKED first
(`kv_parked=1` or no `slot_granted`), `resp_tokens > 0` or a moving
`n_decoded` = DECODE, granted without output = PREFILL, no counter motion for
60 s = FLAT, rate over the span since a counter last moved (never under 1 s),
30 s rate hold while `is_processing`.

Consumers after the change:

- ccstatusline: `src/utils/llama-swap.ts` (SSE decode, PARKED rules, slot
  join, rate sampling) and the per-session state files under
  `~/.cache/ccstatusline/llama-swap/` go away. One GET, one timeout, run in
  parallel with the other prefetches, plus a skip-after-failure marker.
- Menu bar (`macos-menu/Sources/LlamaSwapMenuCore`): drop `SessionThroughput`,
  `joinedSlot`, `SlotSample`; one row per lane straight from the endpoint.
- The shell session-throughput reader can read the same endpoint.

Ship as llama-swap change first, then ccstatusline v2.4.18.

## Audit findings on the current client (all resolved by the fix above; patch
## only if the fix is postponed)

1. HIGH `src/utils/llama-swap-prefetch.ts` (`prefetchLlamaSwapData`): the two
   fetches are sequential inside the `Promise.all` that gates the whole status
   line (`src/ccstatusline.ts` `renderMultipleLines`). Worst case 2.4 s stall per
   render instead of 1.2 s. Fix: `Promise.all([fetchEventsBatch, fetchSlots])`.
2. MEDIUM no backoff when `/api/events` is down: every 2 s render pays the full
   timeout until the proxy recovers. Fix: persist a "failed at" marker and skip
   fetching for 30 s.
3. LOW per-session state files are never pruned. Fix: delete files older than
   one day when writing (cheap, one `readdir`).
4. LOW state file rewritten every render even when unchanged. Fix: compare with
   the previous readout and skip the write.
5. Design note: `slot-status` and `slot-throughput` sit in the default layout for
   every npm user (`src/types/Settings.ts`). Zero cost off llama-swap, but
   opt-out rather than opt-in; consider removing them from the default layout
   and documenting how to add them.

## How to verify

- Instrumented render: preload a script that wraps `fetch`,
  `net.Socket.prototype.connect`, `tls.connect` and `child_process.*` to log
  to stderr, then `echo '<payload>' | bun --preload=<script> src/ccstatusline.ts`
  under each backend environment. Non-llama-swap runs must log no llama-swap
  calls.
- Live: `bash scripts/harness.sh <tmux-session> --seconds 60 --interval 3`
  must stay MATCH through PREFILL and DECODE with `refreshInterval: 2` set.
