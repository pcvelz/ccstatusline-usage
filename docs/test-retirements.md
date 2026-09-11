# Test retirements

Ledger for `scripts/test-inventory-gate.sh`: every test title that shipped in a
release and later disappeared must be listed here with the reason. The gate
blocks any release whose inventory diff contains a title absent from this file.
A test file whose `expect(` count went down must be listed here by its
backticked path with the reason (the `###` file headings count). Entries must
be backticked: the gate matches `` `title` `` / `` `path` ``, not bare text.

## v2.4.14 -> upstream merge, found by the widened gate

The first version of the gate only saw single-quoted `it('...')` titles and
matched ledger text by substring, so it missed `it.each(...)('$name ...')`
template titles and assertions deleted from tests that kept their title. These
come from the same #430 unified-hideable-state change as the section below. Each
one was checked against its replacement at HEAD.

### `src/widgets/__tests__/GitConflicts.test.ts` (no-git)

- `hides no git when configured`: same assertion (`render({ hideNoGit: true })` is `null`), now titled "hides no git through the shared hide state".

### `src/widgets/__tests__/GitWidgetSharedBehavior.test.ts`

- `$name should expose hide-no-git keybind`: per-widget hide keybinds were removed on purpose. "$name should not declare per-widget hide keybinds" now asserts they are gone.
- `$name should toggle hideNoGit metadata`: replaced by "$name should enable no-git via the unified hide metadata".
- `$name should show hide-no-git modifier in editor display`: the per-widget modifier text is gone. The shared hide modifier is covered in `src/widgets/shared/__tests__/hideable.test.ts` ("formats the hide modifier text from enabled state keys"). Also the reason for the expect() drop 4 -> 3.

### `src/widgets/__tests__/JjWidgetSharedBehavior.test.ts`

- `$name should expose hide-no-jj keybind`: same as the git case. "$name should not declare per-widget hide keybinds" covers it.
- `$name should toggle hideNoJj metadata`: replaced by "$name should enable no-jj via the unified hide metadata".
- `$name should show hide-no-jj modifier in editor display`: covered by the shared hideable modifier test. Also the reason for the expect() drop 4 -> 3.

### `src/widgets/__tests__/ExtraUsageUtilization.test.ts`

The `exposes and toggles hide-if-disabled configuration` test (its title is listed under ExtraUsageRemaining below) was replaced by "declares the disabled and no-data hideable states alongside display keybinds" and "hides usage errors when the no-data state is enabled". The expect() count drops 23 -> 21 because the legacy `toggle-hide-disabled` action assertions were removed with the action.

## v2.4.14 -> upstream merge (16 commits, unified hideable states #430)

Upstream PR #430 replaced per-widget ad-hoc hide flags (`hideNoGit`, `hideTitle`, `hideStatus`, hide-zero, hide-when-empty, hide-if-disabled) with a single hideable-state system driven by an `h` checklist and `metadata.hide`. The old titles tested the legacy flags/keybinds; equivalent or broader coverage exists under new titles in the same files (e.g. "hides zero conflicts through the shared hide state", "should render preview without status when the status state is hidden", "hides a zero metric value when the zero hideable state is enabled"). Verified per file against the surviving suite.

### `src/widgets/__tests__/CacheTimer.test.ts`

- `annotates the editor only when hide-when-empty is enabled`
- `exposes a hide-when-empty keybind and toggles the flag`

### `src/widgets/__tests__/ExtraUsageRemaining.test.ts`

- `exposes and toggles hide-if-disabled configuration`

### `src/widgets/__tests__/CompactionCounter.test.ts`

- `hides a zero metric value when hide zero is enabled`
- `shows hide zero in the editor display when enabled`
- `toggles hide zero metadata on and off`
- `uses only metric and hide-zero keybinds in metric mode`

### `src/widgets/__tests__/GitConflicts.test.ts`

- `renders preview content`
- `renders the conflict count`
- `renders zero conflicts instead of hiding the widget`

### `src/widgets/__tests__/GitCiStatus.test.ts`

- `returns null when hideNoGit and not in a git repo`

### `src/widgets/__tests__/GitPr.test.ts`

- `should render preview without status when hideStatus enabled`
- `should render preview without title when hideTitle enabled`
- `should return null when hideNoGit and not in git repo`

### `src/widgets/__tests__/Skills.test.ts`

- `shows hide-when-empty in editor modifier text when enabled`
- `toggles hide-when-empty metadata`

### `src/widgets/__tests__/CacheWidgets.test.ts`

- `toggles cache options via custom keybind actions`

### `src/tui/components/color-menu/__tests__/mutations.test.ts`

Same test, extended: upstream added `numberFormat` to the stripped fields and updated the title to match (`resetWidgetStyling removes color, backgroundColor, bold, dim, and numberFormat from one widget`).

- `resetWidgetStyling removes color, backgroundColor, bold, and dim from one widget`

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
