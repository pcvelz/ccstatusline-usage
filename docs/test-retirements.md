# Test retirements

Ledger for `scripts/test-inventory-gate.sh`: every test title that shipped in a
release and later disappeared must be listed here with the reason. The gate
blocks any release whose inventory diff contains a title absent from this file.

## v2.4.10 -> v2.4.11 (upstream merge, 71 commits)

### `src/tui/components/color-menu/__tests__/mutations.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `resetWidgetStyling removes color, backgroundColor, and bold from one widget`

### `src/utils/__tests__/compaction.test.ts`

The fork's percentage-drop compaction detector (session-state cache, drop thresholds, session-id hashing) was replaced wholesale in the v2.4.11 upstream merge by upstream's transcript-based `getCompactionStats` (parses `compact_boundary` markers). The implementation these tests exercised no longer exists; upstream's own compaction.test.ts covers the replacement.

- `accepts custom threshold`
- `accepts custom threshold in options`
- `detects 3-point drop on 1M window`
- `detects compaction when ctx drops by more than 2 points`
- `detects compaction when the context window size is unchanged`
- `detects drops using non-integer percentages`
- `detects large compaction on 200K window`
- `detects multiple sequential compactions`
- `does not detect on first render (sentinel prevCtxPct)`
- `does not detect when ctx drops by 1 point (rounding noise)`
- `does not detect when ctx drops by exactly 2 points`
- `does not detect when ctx increases`
- `does not detect when ctx stays the same`
- `does not throw on write failure`
- `handles a session that starts at 0% (sentinel guards first render)`
- `hashes empty session ID to avoid blank filename leaf`
- `hashes session IDs that contain only illegal characters to avoid collision`
- `increments existing count`
- `learns the context window size for legacy state without incrementing`
- `resets the baseline without incrementing when the context window size changes`
- `returns fresh state for unknown session`
- `returns fresh state when cache file exceeds size cap`
- `returns fresh state when cache file has corrupted JSON`
- `returns state unchanged for Infinity input`
- `returns state unchanged for NaN input (no poison)`
- `returns state unchanged for negative input`
- `round-trips state through save and load`
- `sanitizes path traversal in session ID`
- `stores the current context window size when provided`
- `updates prevCtxPct regardless of detection`
- `uses zod defaults for missing fields in cache file`
- `with threshold 0, every strict drop counts`

### `src/utils/__tests__/config.test.ts`

Upstream changed invalid-settings semantics in 2.2.x: an unreadable settings.json is now preserved untouched (defaults render in memory) instead of backed up and overwritten. The new tests assert the file is NOT rewritten - the safer behavior superseded these.

- `backs up invalid JSON and recovers with defaults`
- `backs up invalid v1 payloads and recovers with defaults`

### `src/utils/__tests__/powerline-settings.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `removes manual separators when requested`

### `src/utils/__tests__/usage-prefetch.test.ts`

Upstream semantics adopted in the v2.4.11 merge: null per-model stdin buckets no longer parse as authoritative 0% - the scoped API usage is refetched instead. Replaced by upstream's "does not let null per-model stdin buckets overwrite scoped API usage" tests.

- `treats null per-model buckets as zero usage`
- `treats null requested per-model buckets as zero usage without fetching`

### `src/utils/__tests__/widgets.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `hides both separator types in powerline mode`

### `src/widgets/__tests__/BlockResetTimer.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `returns null when neither timer data nor usage error exists`

### `src/widgets/__tests__/CompactionCounter.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `uses f and n as keybinds for the default format`

### `src/widgets/__tests__/RemoteControlStatus.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `returns "off" when OFF`
- `returns "on" in preview mode`
- `returns "on" when ON`

### `src/widgets/__tests__/TokensWidgets.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `fall back to token metrics when context_window data is missing`
- `use context_window values for input/output and tokenMetrics totals for cached/total`

### `src/widgets/__tests__/WeeklyResetTimer.test.ts`

Renamed/reworded in the v2.4.11 upstream merge; equivalent assertions exist in the same file under upstream's new titles (verified per file via keyword match on the surviving suite).

- `returns null when neither weekly reset data nor usage error exists`
