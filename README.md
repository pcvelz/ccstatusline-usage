<pre>
              _        _             _ _            
  ___ ___ ___| |_ __ _| |_ _   _ ___| (_)_ __   ___ 
 / __/ __/ __| __/ _` | __| | | / __| | | '_ \ / _ \
| (_| (__\__ \ || (_| | |_| |_| \__ \ | | | | |  __/
 \___\___|___/\__\__,_|\__|\__,_|___/_|_|_| |_|\___|
                                                     
</pre>

# ccstatusline-usage

**🎨 A highly customizable status line formatter for Claude Code CLI**
*Display model info, git branch, token usage, API usage, and other metrics in your terminal*

> Fork of [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) with added **API usage widgets** (session/weekly utilization bars, reset timer, context bar).

[![npm version](https://img.shields.io/npm/v/ccstatusline-usage.svg)](https://www.npmjs.com/package/ccstatusline-usage)
[![npm downloads](https://img.shields.io/npm/dm/ccstatusline-usage.svg)](https://www.npmjs.com/package/ccstatusline-usage)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/pcvelz/ccstatusline-usage/blob/main/LICENSE)
[![Node.js Version](https://img.shields.io/node/v/ccstatusline-usage.svg)](https://nodejs.org)
[![install size](https://packagephobia.com/badge?p=ccstatusline-usage)](https://packagephobia.com/result?p=ccstatusline-usage)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/pcvelz/ccstatusline-usage/graphs/commit-activity)

[![Mentioned in Awesome Claude Code](https://awesome.re/mentioned-badge.svg)](https://github.com/hesreallyhim/awesome-claude-code)
[![ClaudeLog - A comprehensive knowledge base for Claude](https://claudelog.com/img/claude_log_badge.svg)](https://claudelog.com/)

## Fork Enhancements

This fork adds API-based usage widgets beyond the upstream:

- **Session/Weekly Usage** - Real utilization from Anthropic API with progress bars
- **Weekly Pace** - Pendulum bar showing if you're ahead or behind expected usage pace (optional Off Hours window subtracts sleep time from the expected % calc)
- **Reset Timer** - Time until weekly reset (when at 100% / on a charged model); otherwise time until 5-hour session window resets
- **Context Window Display** - Visual bar showing context usage
- **Off Peak** - Shows peak/off-peak status with countdown timer (peak hours drain sessions faster)
- **Two-line Layout** - Session info on line 1, context on line 2
- **Multi-provider routing** - Usage widgets dispatch per model: Anthropic models hit the usage API; opencode/local models (GLM, Kimi, MiniMax, Qwen, Ollama) skip the fetch and gracefully hide usage bars while keeping the real-time context bar.

### Multi-Provider Routing (Opencode / Local Models)

Claude Code can route individual prompts to non-Anthropic backends via opencode or a local Ollama runtime. The status line reads the `model.id` that Claude Code sends on stdin each render and dispatches through a per-provider resolver (`src/utils/usage/resolver.ts`):

- **Anthropic** (`opus`, `sonnet`, `haiku`, `fable` in the id) — fetches Session/Weekly/Reset from the usage API.
- **Opencode** (`glm`, `kimi`, `minimax`, `mm-`, `qwen`, `owen`, `mimo`) — no usage API call; Session/Weekly/Reset widgets hide themselves. Context Bar still renders when `context_window` is in the payload.
- **Unknown model id** — same behavior as opencode (hides usage widgets).

This means opencode-routed turns don't trigger pointless Anthropic API calls or rate-limiting during heavy local usage.

Example — configure Claude Code to route a model through opencode (edit `~/.claude/settings.json`):

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "npx -y ccstatusline-usage@latest",
    "padding": 0
  },
  "model": "glm-5.1"   // or "kimi-k2.6", "minimax-m2.7", "qwen-3.6-plus", "qwen3.6:35b-a3b-q4_K_M" for local Ollama
}
```

What the status line renders per model:

```
# Anthropic (opus / sonnet / haiku / fable)
Session: [████░░░░░░░░░░░] 27.0% | Weekly: [████░░░░░░░░░░░] 34.0% | 2:03 hr | Model: Fable 5
  Context: [██████░░░░░░░░░] 389k/1M (39%) | Pace: [░░░░░░█|░░░░░░░] D4/7 -8% | Off-peak (4:03 hr)

# Opencode / local (glm-5.1, kimi, qwen, …)
Model: glm-5.1 | Off-peak (4:03 hr)
  Context: [██░░░░░░░░░░░░░] 50k/200k (25%)
```

### Enhanced Status Line Preview

```
Session: [████░░░░░░░░░░░] 27.0% | Weekly: [████░░░░░░░░░░░] 34.0% | 2:03 hr | Model: Fable 5 | Session ID: 0109b99d...
  Context: [██████░░░░░░░░░] 389k/1M (39%) | Pace: [░░░░░░█|░░░░░░░] D4/7 -8% | Off-peak (4:03 hr)
```

![Demo](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/demo.gif)

<br />

## 📚 Table of Contents

- [Recent Updates](#-recent-updates)
- [Features](#-features)
- [Localizations](#-localizations)
- [Quick Start](#-quick-start)
- [Windows Support](docs/WINDOWS.md)
- [Usage](docs/USAGE.md)
- [Development](docs/DEVELOPMENT.md)
- [Contributing](#-contributing)
- [Uninstall](#️-uninstall)
- [License](#-license)
- [Related Projects](#-related-projects)

<br />

## 🆕 Recent Updates

### [v2.4.6](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.4.6) - Fable 5 model support

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Fable 5 usage provider routing** — `fable` model ids now route to the Anthropic usage provider, so the Session, Weekly, and Reset Timer widgets render real usage data instead of hiding when a Fable model is active. The `[1m]` suffix already maps the Context Bar to a 1M window.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Compact names for single-version model ids** — mobile/compact mode now renders `claude-fable-5[1m]` as `M: f5[1m]`; previously the id failed to compact and the `[1m]` suffix was duplicated.

### [v2.4.5](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.4.5) - Upstream sync (both widget sets working) + context-bar zero fallback

- [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline): **Upstream sync** — 18 commits merged through 2.2.19: Windows npm shim fix, Remote Control status widget, weekly-reset weekday display mode, `CCSTATUSLINE_WIDTH` override, git lock avoidance (`--no-optional-locks`) + persistent git cache, older-git compatibility, and npm provenance attestations.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Hybrid usage retrieval — both widget sets work** — Adopted upstream's declarative usage-prefetch pipeline (`getMissingFetchFields`/`mergeUsageData`) while keeping the fork's `resolveProvider()` fetch seam. Upstream's new Extra Usage Utilization / Extra Usage Remaining widgets now populate generically, and all existing fork widgets (Session, Weekly, Reset Timer, Context Bar, Weekly Pace, per-model Sonnet/Opus) keep working. The fork's usage-prefetch shrank from a parallel implementation to a single provider seam.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Context bar zero-usage fallback** — When Claude Code reports all-zero token usage mid-turn (common with local models before token accounting flushes), the Context Bar now falls back to transcript-based metrics instead of flashing `0k/200k`. Applied in both `getContextWindowMetrics` and `ContextBarWidget`. Default bar width nudged 15 → 16.

### [v2.4.4](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.4.4) - Session extra usage dollar amount fix

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Session widget shows extra usage amounts** — When session hits 100% and extra usage is active (weekly still below 100%), the split bar now renders the actual dollar amount (`$0.97/$419.00`) instead of falling back to `100.0%`. The `SessionUsageWidget` was already drawing the split bar but wasn't passing `extraUsed`/`extraLimit` to `formatSplitUsageBar`; this fix completes the conditional chain so the amount always appears alongside the overdraft indicator.

### [v2.4.3](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.4.3) - Off Hours for Weekly Pace

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Off Hours configuration for Weekly Pace** — Optional recurring window (e.g. `22:00 → 07:00`) that Weekly Pace subtracts from both sides of its expected-% calculation, so the delta doesn't drift negative while you sleep. Wall-clock `dayOfWeek` still tracks calendar (D4/7 = Wednesday regardless of off-hours state). New TUI menu: `(e)` toggle, `(s)` / `(n)` edit start/end, `(r)` reset. Off by default — existing configs parse unchanged. Thanks to @BenIsLegit ([#4](https://github.com/pcvelz/ccstatusline-usage/pull/4)).

### [v2.4.2](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.4.2) - Upstream sync + Reset Timer editor + JSON model config + provider gate

- [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline): **Upstream sync** — 34 commits merged, including Jujutsu VCS widgets (`jj-branch`, `jj-changes`, `jj-conflicts`, `jj-description`), Voice Status widget, separate Weekly Sonnet and Weekly Opus usage widgets, short bar mode for timer widgets, pinned global install support, context percentage label fixes, and separator collapse improvements.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Off-peak widget provider gate** — Hides the Anthropic-only peak-hours indicator for non-Anthropic models (Kimi, GLM, Qwen, MiniMax, …). Introduces optional `getSupportedProviders()` on the Widget interface, with the gate enforced once in `renderer.preRenderAllWidgets()` — declarative per-widget routing that stays clean as new providers are added.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Reset Timer editor actions** — `t` toggles date mode, `h` toggles hour format, `l` edits locale, `z` edits timezone directly in the TUI item editor.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **JSON-driven model context** — Third-party model context window sizes (Kimi, GLM, MiniMax, Qwen, Devstral, etc.) moved from hardcoded TypeScript to `src/utils/model-context.json` for easier updates and community contributions.

### [v2.4.1](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.4.1) - Weekly Pace: showPercent toggle + decimal precision

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **`%` keybind — always show delta on `On Pace`** — Previously `On Pace` was the only pace band that hid its delta. Toggle `showPercent` in the editor to render `D4/7: On Pace +3%` (or `-2%`, or `+0%`) so you can see how close to a band edge you are.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **`.` keybind — decimal precision** — Cycles 0 → 1 → 2 → 3 → 0 decimal places for all deltas (Warm/Cool/Overcooking/Underusing, `On Pace` when `showPercent` is on, and the pendulum bar). Replaces `Math.round()` with `toFixed(decimals)` in a shared `formatDelta` helper.
- Both toggles are metadata-gated and orthogonal — omitted keys behave identically to before.
- Thanks to @BenIsLegit ([#3](https://github.com/pcvelz/ccstatusline-usage/pull/3)).

### [v2.4.0](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.4.0) - Multi-provider router for usage widgets

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Provider pattern end-to-end** — Usage widgets now dispatch through `resolveProvider(modelId)` in `src/utils/usage/resolver.ts`. Anthropic models (`opus`/`sonnet`/`haiku`) fetch from the usage API; opencode/local models (`glm`, `kimi`, `minimax`, `mm-`, `qwen`, `owen`, `mimo`) skip the fetch entirely so heavy local-model sessions no longer trigger needless Anthropic API calls or rate-limiting.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): The prefetch layer (`usage-prefetch.ts`) now reads `data.model.id` from the payload and dispatches via `provider.fetchUsage()` instead of the hardcoded Anthropic path. `opencodeProvider` / `nullProvider` return empty `UsageData`, so Session/Weekly/Reset widgets hide themselves naturally.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Context Bar stays backend-agnostic** — renders whenever `context_window` is present in the payload, regardless of which provider handled the turn.
- See the new [Multi-Provider Routing](#multi-provider-routing-opencode--local-models) section under Fork Enhancements for example config.

### [v2.3.17](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.17) - Local model fallback for API usage widgets

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Local model fallback** — When the active model is not Opus/Sonnet/Haiku (e.g. a local Ollama model like `qwen3-coder:30b`), the Session, Weekly, and Context widgets now render empty-bar placeholders (`[░░░░░░░░░░░░░░░] -.0%`) and the Reset Timer shows `-:00 hr` instead of misleading Claude API values.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): Qwen models keep showing real context usage when `context_window` is present in the payload.

### [v2.3.16](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.16) - Reset Timer fix + model ref updates + upstream sync

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Reset Timer fix** — When session hits 100% but weekly is still below 100%, the Reset Timer now correctly shows the session reset countdown (5-hour window) instead of the weekly reset time. Previously it jumped to the weekly timer as soon as session filled up.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): Updated all Opus 4.6 references to Opus 4.7 throughout docs, examples, and test data.
- Upstream sync (5 commits): refreshInterval configuration for Claude Code status line (#297), xhigh thinking effort level (#314), dev-dependency bumps.

### [v2.3.15](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.15) - Move extra amounts into Weekly bar, Reset Timer shows weekly reset time

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Extra amounts in Weekly bar** — When at 100% / on a charged model, the split bar now shows `€spent/€limit` after the bar instead of `100.0%`. Mobile shows the spent amount only.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Reset Timer shows weekly reset time** — When extra usage is active the timer now counts down to the weekly reset instead of showing the `Extra: €X/€Y` spending (which moved to the Weekly bar). Falls back to session timer if no weekly reset data is available.

### [v2.3.14](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.14) - Drop extraUsageBalance setting

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): Removed the `extraUsageBalance` setting introduced in v2.3.12. `Extra: €X/€Y` now uses the API's monthly limit directly — stable, no config, no drift.

### [v2.3.13](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.13) - Fix timer color regression from v2.3.12

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Fix timer color** — In v2.3.12, the Reset Timer widget color setting was applied to both the `Extra: €X/€Y` output and the countdown timer (e.g. `4:28 hr`), causing the timer to appear red. The dark red is now applied inline only to the `Extra:` path; the countdown timer respects the widget's configured color as before.

### [v2.3.12](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.12) - Split bar for extra usage, stable effective-total, 100% clamp

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Split bar at 100%** — Session and Weekly usage bars switch to a split display when the limit is reached and extra usage is active: left half (full) shows the base usage, right half (dark red) shows how much of the extra budget has been spent.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Stable effective-total** — Set `extraUsageBalance` (cents) in `~/.config/ccstatusline/settings.json` to your spending ceiling (`spent + account_balance` at config time, e.g. €153.23 + €56.06 → `20929`). The denominator stays fixed as spending continues, capped at the API monthly limit. Without this setting, the monthly limit is used directly.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Extra usage color via config** — The `Extra: €X/€Y` Reset Timer output color is now driven by the widget's color setting (configurable in TUI or settings.json) instead of being hardcoded.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Usage clamped to 100%** — Session and Weekly bars and percentage labels cap at 100% even if the API returns values above 100.

### [v2.3.11](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.11) - Fix dual-cache drift between Weekly Usage and Weekly Pace

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Unified usage data source** — Session Usage, Weekly Usage, and Reset Timer widgets now read from the shared `context.usageData` pipeline instead of maintaining a separate API cache. Previously, around the weekly reset boundary the two caches could drift and show contradictory data (e.g. `Weekly: 99%` alongside `Pace: D1/7 +2%`). Deleted ~330 lines of duplicate fetching/caching infrastructure from `ApiUsage.tsx` (556 → 227 lines). Upstream merge: #278 (JSONL token overcounting fix), #283 (model display name parenthetical strip — integrated into fork's existing `[1m]`-aware display logic).

### [v2.3.10](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.10) - Extra usage on session limit, fix empty separator for null widgets

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Extra usage on session limit** — Reset Timer now shows extra usage spending when session limit reaches 100% (not just weekly limit or charged 1M model).
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Fix empty separator for null widgets** — Separators adjacent to widgets that return null (e.g. Battery when charging) are now suppressed correctly. Previously showed a visible `|  |` gap.

### [v2.3.9](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.9) - Medium display size for mid-width terminals

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Three-tier display sizing** — New medium display size for terminals between 134–177 chars wide. Progress bars render at 8 chars (between mobile's 4 and full's 15). Model and Session ID use compact format in medium mode. Weekly Pace pendulum bar scales to halfWidth=4 in medium.

### [v2.3.8](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.8) - Fix off-peak countdown + Windows EEXIST fix

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Off-peak countdown fix** — Friday evening now correctly counts to Monday peak instead of Saturday noon. Added test coverage for the off-peak time calculation logic.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Windows EEXIST fix** — Handle `mkdir` throwing EEXIST on Windows junction points/symlinks when saving config ([#2](https://github.com/pcvelz/ccstatusline-usage/pull/2), thanks [@BenIsLegit](https://github.com/BenIsLegit))

### [v2.3.7](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.7) - Weekly Pace as default layout

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Default layout update** — Weekly Pace widget (pendulum mode) is now included in the default status line layout on line 2, between the context bar and off-peak indicator. Model widget color changed to magenta.

### [v2.3.6](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.6) - Remove expired 2x promo code

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Off-Peak cleanup** — Removed expired March 2026 promo (2x) code path, leaving only the permanent peak/off-peak indicator

### [v2.3.5](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.5) - Upstream sync + permanent peak/off-peak widget

- [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline): **Major upstream sync** — 180 commits merged, including Weekly Reset Timer widget, new test infrastructure, Windows support, and various improvements
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Permanent Off-Peak widget** — Widget no longer disappears after the March 28 promo ends; shows peak/off-peak status permanently with countdown timer (Anthropic confirmed peak hours continue to drain sessions faster)
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **README fork branding fix** — Fixed upstream package name references in Windows install commands, WSL section, and dev setup

### [v2.3.4](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.4) - Upstream sync + extra usage fix

- [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline): **Native rate_limits support** — Upstream now uses Claude Code 2.1.80's native `rate_limits` field for usage data
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Extra usage regression fix** — Reset timer widget now supplements native `rate_limits` data with API fetch for extra usage fields that upstream's pipeline omits

### [v2.3.3](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.3) - CI pipeline fix

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **CI pipeline fix** — Fixed TypeScript errors (model union type narrowing, missing `extraUsageBalance` setting), disabled broken `import/order` ESLint rule (incompatible with ESLint 10), resolved all remaining lint errors in fork-specific files
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Release workflow** — Added mandatory CI pipeline check before tagging/releasing

### [v2.3.2](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.2) - Off Peak widget + WeeklyPace compact fix

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Off Peak widget** — New widget showing `Off peak: Off-peak 2x` or `Off peak: Peak` during the Anthropic March 2026 Spring Break promotion (off-peak = weekdays outside 8 AM–2 PM ET, weekends all day). Widget automatically hides after March 28, 2026 23:59 PT.
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **WeeklyPace compact fix** — Pendulum bar now falls back to text mode (`D6/7: -18%`) on narrow terminals (< 80 chars)
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Sonnet [1m] extra usage fix** — Extra usage spending now shown when a charged `[1m]` model (e.g. Sonnet) is active, regardless of weekly limit status

### [v2.3.1](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.1) - Weekly Pace widget

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Weekly Pace widget** — New widget showing if weekly usage pace is on track, with pendulum bar or text display mode (PR #1 by @BenIsLegit)

### [v2.3.0](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.3.0) - Upstream sync + Vim Mode widget

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Upstream sync** — Merged 14 upstream commits: Vim Mode widget, hyperlink support for GitBranch/GitRootDir, ESLint 10 upgrade, timer day display fix (≥24h), macOS keychain token fallback, ink-gradient 4.0.0
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Version scheme** — Switched to staying one minor version ahead of upstream (upstream 2.2.x → fork 2.3.x)

### [v2.1.17](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.17) - Upstream sync + 1M context display

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Upstream sync** — Merged 46 upstream commits: new widgets (Skills, ThinkingEffort, InputSpeed, OutputSpeed, TotalSpeed, Link, GitInsertions, GitDeletions, WeeklyResetTimer), CI pipeline, Dependabot, --config flag, --hook mode, usage API proxy support, 429 backoff, CoercedNumberSchema
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **1M context display** — Context bar now shows `68k/1M` instead of `68k/1000k` for 1M context models
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Keychain file fallback** — On macOS, usage widget falls back to `~/.claude/.credentials.json` when Keychain is unavailable (tmux/SSH sessions)

### [v2.1.16](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.16) - Show [1m] suffix on model widget for 1M context models

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **1M context indicator** — Model widget now appends `[1m]` when a 1M context model is active, both in full (`Model: claude-sonnet-4-6 [1m]`) and compact (`M: s4.6[1m]`) display modes
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Revert extra usage on 1M** — Removed the v2.1.15 trigger that showed extra usage spending on 1M models. 1M context is not included in Max without extra usage — the `[1m]` suffix on the Model widget now makes this visible, so the Reset Timer no longer needs to duplicate that awareness

### [v2.1.15](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.15) - Show extra usage Kelp on 1M context models

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Extra usage on 1M models** — Reset Timer widget now shows extra usage spending (`Extra: €X.XX/€Y.YY`) whenever a 1M context model is active (Opus/Sonnet with 1M context window), in addition to the existing trigger when weekly limit reaches 100%. *Reverted in v2.1.16.*

### [v2.1.14](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.14) - Reduce API polling frequency to prevent rate limiting

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Reduced polling** — API cache extended from 3 to 10 minutes (~6 calls/hr instead of ~20), verified over 6 hours with zero 429 rate limit errors
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Always serve stale cache** — When API is unavailable, stale data is served indefinitely instead of showing `[Timeout]` — old usage percentages are more useful than an error

### [v2.1.13](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.13) - Fix stale API cache causing stuck usage display

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Stale cache expiry** — API usage data older than 10 minutes is now discarded instead of served indefinitely, preventing frozen percentage displays
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **429 rate limit handling** — Properly detects HTTP 429 responses and backs off for 120s instead of hammering the API every 30s
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Token cache invalidation** — Automatically re-reads OAuth token from Keychain/disk when stale cache expires, recovering from expired tokens

### [v2.1.12](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.12) - Remove thinking effort bars from model widget

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Remove thinking effort bars** — Claude Code now shows thinking intensity natively in its own UI, so the `▌▌▌` bars after the model name have been removed from the Model widget

### [v2.1.11](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.11) - Configurable extra usage Kelp

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Configurable extra usage Kelp** — Add `extraUsageBalance` setting (in cents) to `~/.config/ccstatusline/settings.json` to override the API's monthly limit with your actual prepaid Kelp (e.g., `"extraUsageBalance": 5000` shows `Extra: €0.00/€50.00`)

### [v2.1.8](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.8) - Windows support for API usage widgets

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Windows compatibility** — API usage widgets now work on Windows by using `os.homedir()` instead of `process.env.HOME` for credential and cache file paths

### [v2.1.7](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.7) - Battery widget, extra usage fix & upstream sync

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Battery widget** — shows `B: xx%` on macOS and Linux when on battery power (hidden when charging)
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Extra usage conditional display** — Extra spending widget now only appears when the weekly budget is fully used (100%), instead of always when extra usage is enabled
- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Upstream sync** — Memory Usage widget (v2.0.29)

### [v2.1.6](https://github.com/pcvelz/ccstatusline-usage/releases/tag/v2.1.6) - Upstream sync

- [pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage): **Upstream sync** — merged 9 upstream commits: Session Name widget, Git Root Dir widget, CWD home abbreviation, block timer caching, git widget refactor, Windows UTF-8 fix, widget picker UX, TUI editor input fix

### v2.2.0 - v2.2.6 - Speed, widgets, links, and reliability updates

- **🚀 New Token Speed widgets** - Added three widgets: **Input Speed**, **Output Speed**, and **Total Speed**.
  - Each speed widget supports a configurable window of `0-120` seconds in the widget editor (`w` key).
  - `0` disables window mode and uses a full-session average speed.
  - `1-120` calculates recent speed over the selected rolling window.
- **🧩 New Skills widget controls (v2.2.1)** - Added configurable Skills modes (last/count/list), optional hide-when-empty behavior, and list-size limiting with most-recent-first ordering.
- **🌐 Usage API proxy support (v2.2.2)** - Usage widgets honor the uppercase `HTTPS_PROXY` environment variable for their direct API call to Anthropic.
- **🧠 New Thinking Effort widget (v2.2.4)** - Added a widget that shows the current Claude Code thinking effort level.
- **🍎 Better macOS usage lookup reliability (v2.2.5)** - Improved reliability when loading usage API tokens on macOS.
- **⌨️ New Vim Mode widget (v2.2.5)** - Added a widget that shows the current vim mode, with ASCII and optional Nerd Font icon display.
- **🔗 Git widget link modes (v2.2.6)** - `Git Branch` can render clickable GitHub branch links, and `Git Root Dir` can render clickable IDE links for VS Code and Cursor.
- **🤝 Better subagent-aware speed reporting** - Token speed calculations continue to include referenced subagent activity so displayed speeds better reflect actual concurrent work.

### v2.2.9 - v2.2.12 - GitLab support, reset timers, context, compaction, and git widgets

- **🦊 GitLab PR/MR support** - `Git Branch` and `Git PR/MR` now support GitHub, GitLab, and compatible self-hosted remotes, using `gh` or `glab` as appropriate.
- **🔄 Status line refresh interval** - Installed configs can set Claude Code's `statusLine.refreshInterval` from the TUI when Claude Code >=2.1.97 supports it.
- **🧭 Wrap-around TUI navigation** - Menu/list navigation and move/reorder modes now wrap at the first and last items.
- **📋 Clone widget shortcut** - Press `k` in the item editor to duplicate the selected widget, with fresh Powerline background color for cloned Powerline items.
- **📊 Short bar display modes** - Context percentage, Context Bar, Session Usage, Weekly Usage, Block Timer, and reset timer widgets can use compact bar variants.
- **⏱️ Usage time cursor** - Session Usage and Weekly Usage progress bars can show the elapsed time position within the current usage window.
- **🕒 Reset timer timestamps** - Block and Weekly Reset Timer widgets can show exact reset timestamps with compact formatting, 12/24-hour display, IANA time zones, and locale selection.
- **🪟 Context Window widget** - Added a `Context Window` widget for total model window size, keeping `Context Length` focused on current context usage.
- **🔁 Compaction Counter widget** - Added a `Compaction Counter` widget that tracks session context compactions, with icon/text/number formats, optional Nerd Font icon, and hide-when-zero behavior.
- **🧮 Git file status widgets** - Added `Git Staged Files`, `Git Unstaged Files`, `Git Untracked Files`, and `Git Clean Status` for file counts and clean/dirty state.
- **🏷️ Clear context percentage labels** - `Context %` and `Context % (usable)` now label rendered values as used or left when toggling used/remaining mode.
- **⚡ More Powerline caps** - The Powerline separator editor now supports more than three start/end caps.
- **🧠 Thinking Effort updates** - Added `xhigh`, show `default` when no effort is set, mark unknown future effort levels with `?`, and track live status JSON plus `/effort` command changes.
- **🧮 More accurate token counts** - Streaming duplicate JSONL entries are deduped so token widgets do not overcount live Claude Code output.
- **🏷️ Cleaner model display** - The Model widget strips trailing context suffixes like `(1M context)`; use `Context Window` when you want the total window size shown.
- **🧹 Cleaner empty-widget separators** - Manual separators now collapse around widgets that render empty, avoiding dangling separators when hide-when-empty widgets disappear.
- **🧱 More resilient Git helpers** - Git widgets handle missing or unusual git command output more defensively.

### v2.2.8 - Git widgets, smarter picker search, and minimalist mode

- **🌿 Git widgets** - Added `Git Branch`, `Git Insertions`, `Git Deletions`, `Git Changes`, `Git PR/MR`, and `Git Worktree` widgets for repository status.
- **🔎 Smarter widget picker** - Category-based browsing, ranked fuzzy search, and recent/frequent shortcuts make finding and adding widgets faster.
- **🎨 Minimalist mode** - Global option to strip icons, labels, and extra formatting for a cleaner status line.

<br />
<details>
<summary><b>Older updates (v2.1.10 and earlier)</b></summary>

### v2.1.0 - v2.1.10 - Usage widgets, links, new git insertions / deletions widgets, and reliability fixes

- **🧩 New Usage widgets (v2.1.0)** - Added **Session Usage**, **Weekly Usage**, **Block Reset Timer**, and **Context Bar** widgets.
- **📊 More accurate counts (v2.1.0)** - Usage/context widgets now use new statusline JSON metrics when available for more accurate token and context counts.
- **🪟 Windows empty file bug fix (v2.1.1)** - Fixed a Windows issue that could create an empty `c:\dev\null` file.
- **🔗 New Link widget (v2.1.3)** - Added a new **Link** widget with clickable OSC8 rendering, preview parity, and raw mode support.
- **➕ New Git Insertions widget (v2.1.4)** - Added a dedicated Git widget that shows only uncommitted insertions (e.g., `+42`).
- **➖ New Git Deletions widget (v2.1.4)** - Added a dedicated Git widget that shows only uncommitted deletions (e.g., `-10`).
- **🧠 Context format fallback fix (v2.1.6)** - When `context_window_size` is missing, context widgets now infer 1M models from long-context labels such as `[1m]` and `1M context` in model identifiers.
- **⏳ Weekly reset timer split (v2.1.7)** - Added a separate `Weekly Reset Timer` widget.
- **⚙️ Custom config file flag (v2.1.8)** - Added `--config <path>` support so ccstatusline can load/save settings from a custom file location.
- **🔣 Unicode separator hex input upgrade (v2.1.9)** - Powerline separator hex input now supports 4-6 digits (full Unicode code points up to `U+10FFFF`).
- **🌳 Bare repo worktree detection fix (v2.1.10)** - `Git Worktree` now correctly detects linked worktrees created from bare repositories.

### v2.0.26 - v2.0.29 - Performance, git internals, and workflow improvements

- **🧠 Memory Usage widget (v2.0.29)** - Added a new widget that shows current system memory usage (`Mem: used/total`).
- **⚡ Block timer cache (v2.0.28)** - Cache block timer metrics to reduce JSONL parsing on every render, with per-config hashed cache files and automatic 5-hour block invalidation.
- **🧱 Git widget command refactor (v2.0.28)** - Refactored git widgets to use shared git command helpers and expanded coverage for failure and edge-case tests.
- **🪟 Windows UTF-8 piped output fix (v2.0.28)** - Sets the Windows UTF-8 code page for piped status line rendering.
- **📁 Git Root Dir widget (v2.0.27)** - Added a new Git widget that shows the repository root directory name.
- **🏷️ Session Name widget (v2.0.26)** - Added a new widget that shows the current Claude Code session name from `/rename`.
- **🏠 Current Working Directory home abbreviation (v2.0.26)** - Added a `~` abbreviation option for CWD display in both preview and live rendering.
- **🧠 Context model suffix fix (v2.0.26)** - Context widgets now recognize the `[1m]` suffix across models, not just a single model path.
- **🧭 Widget picker UX updates (v2.0.26)** - Improved widget discovery/navigation and added clearer, safer clear-line behavior.
- **⌨️ TUI editor input fix (v2.0.26)** - Prevented shortcut/input leakage into widget editor flows.
- **📄 Repo docs update (v2.0.26)** - Migrated guidance from `CLAUDE.md` to `AGENTS.md` (with symlink compatibility).

### v2.0.16 - Add fish style path abbreviation toggle to Current Working Directory widget

### v2.0.15 - Block Timer calculation fixes

- Fix miscalculation in the block timer

### v2.0.14 - Add remaining mode toggle to Context Percentage widgets

- **Remaining Mode** - You can now toggle the Context Percentage widgets between usage percentage and remaining percentage when configuring them in the TUI by pressing the 'u' key.

### v2.0.12 - Custom Text widget now supports emojis

- **👾 Emoji Support** - You can now paste emoji into the custom text widget. You can also turn on the merge option to get emoji labels for your widgets like this:
  
![Emoji Support](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/emojiSupport.png)

### v2.0.11 - Unlimited Status Lines

- **🚀 No Line Limit** - Configure as many status lines as you need - the 3-line limitation has been removed

### v2.0.10 - Git Updates

- **🌳 Git Worktree widget** - Shows the active worktree name when working with git worktrees
- **👻 Hide 'no git' message toggle** - Git widgets now support hiding the 'no git' message when not in a repository (toggle with 'h' key while editing the widget)

### v2.0.8 - Powerline Auto-Alignment

![Powerline Auto-Alignment](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/autoAlign.png)

- **🎯 Widget Alignment** - Auto-align widgets across multiple status lines in Powerline mode for a clean, columnar layout (toggle with 'a' in Powerline Setup)

### v2.0.7 - Current Working Directory & Session Cost

![Current Working Directory and Session Cost](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/cwdAndSessionCost.png)

- **📁 Current Working Directory** - Display the current working directory with configurable segment display
  - Set the number of path segments to show (e.g., show only last 2 segments: `.../Personal/ccstatusline`)
  - Supports raw value mode for compact display
  - Automatically truncates long paths with ellipsis
- **💰 Session Cost Widget** - Track your Claude Code session costs (requires Claude Code 1.0.85+)
  - Displays total session cost in USD
  - Supports raw value mode (shows just `$X.YZ` vs `Cost: $X.YZ`)
  - Real-time cost tracking from Claude Code session data
  - Note: Cost may not update properly when using `/resume` (Claude Code limitation)
- **🐛 Bug Fixes**
  - Fixed Block Timer calculations for accurate time tracking across block boundaries
  - Improved widget editor stability with proper Ctrl+S handling
  - Enhanced cursor display in numeric input fields

### v2.0.2 - Block Timer Widget

![Block Timer](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/blockTimerSmall.png)

- **⏱️ Block Timer** - Track your progress through 5-hour Claude Code blocks
  - Displays time elapsed in current block as hours/minutes (e.g., "3hr 45m")
  - Progress bar mode shows visual completion percentage
  - Two progress bar styles: full width (32 chars) or compact (16 chars)
  - Automatically detects block boundaries from transcript timestamps

### v2.0.0 - Powerline Support & Enhanced Themes
- **⚡ Powerline Mode** - Beautiful Powerline-style status lines with arrow separators and customizable caps
- **🎨 Built-in Themes** - Multiple pre-configured themes that you can copy and customize
- **🌈 Advanced Color Support** - Basic (16), 256-color (with custom ANSI codes), and truecolor (with hex codes) modes
- **🔗 Widget Merging** - Merge multiple widgets together with or without padding for seamless designs
- **📦 Easy Installation** - Install directly with `npx` or `bunx` - no global package needed
- **🔤 Custom Separators** - Add multiple Powerline separators with custom hex codes for font support
- **🚀 Auto Font Install** - Automatic Powerline font installation with user consent

</details>

<br />

## ✨ Features

- **📊 Real-time Metrics** - Display model name, git branch, token usage, per-model weekly usage, extra usage limits, voice input state, session duration, compaction count, block timer, and more
- **📈 API Usage Tracking** - Real-time 5-hour session and weekly utilization from Anthropic API with progress bars
- **⏱️ Reset Timer** - Countdown to when your 5-hour session window resets
- **🎨 Fully Customizable** - Choose what to display and customize colors for each element
- **⚡ Powerline Support** - Beautiful Powerline-style rendering with arrow separators, caps, and custom fonts
- **📐 Multi-line Support** - Configure multiple independent status lines
- **🖥️ Interactive TUI** - Built-in configuration interface using React/Ink
- **🔎 Fast Widget Picker** - Add/change widgets by category with search and ranked matching
- **⚙️ Global Options** - Apply consistent formatting across all widgets (padding, separators, bold, minimalist mode, and color overrides)
- **🚀 Cross-platform** - Works seamlessly with both Bun and Node.js
- **🔧 Flexible Configuration** - Supports custom Claude Code config directory via `CLAUDE_CONFIG_DIR` environment variable
- **📏 Smart Width Detection** - Automatically adapts to terminal width with flex separators
- **⚡ Zero Config** - Sensible defaults that work out of the box

<br />

## 🌐 Localizations

The localizations in this section are third-party forks maintained outside this repository. They are not maintained, reviewed, or endorsed by this repository, so review their code and releases before using them.

- 🌏 **中文版 (Chinese):** [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh)

<br />

## 🚀 Quick Start

### No installation needed! Use directly with npx or bunx:

```bash
# Run the configuration TUI with npm
npx -y ccstatusline-usage@latest

# Or with Bun (faster)
bunx -y ccstatusline-usage@latest
```

Both commands launch the same TUI. During the initial setup flow, choose **Pinned global install** if you want Claude Code to stay on the ccstatusline version you are running instead of following `@latest`; the TUI will install that version globally with npm or Bun and write the pinned `ccstatusline` command to Claude Code settings. After a pinned install, you can run `ccstatusline` directly to launch the TUI in the future.

<br />
<details>
<summary><b>Configure ccstatusline</b></summary>

The interactive configuration tool provides a terminal UI where you can:
- Configure multiple separate status lines
- Add/remove/reorder status line widgets
- Customize colors for each widget
- Configure flex separator behavior
- Configure Claude Code status line refresh interval when supported
- Edit custom text widgets
- Install/uninstall to Claude Code settings
- Preview your status line in real-time

> 💡 **Tip:** Your settings are automatically saved to `~/.config/ccstatusline/settings.json`

> 🔧 **Custom Claude Config:** If your Claude Code configuration is in a non-standard location, set the `CLAUDE_CONFIG_DIR` environment variable:
> ```bash
> # Linux/macOS
> export CLAUDE_CONFIG_DIR=/custom/path/to/.claude
> ```

> 🌐 **Usage API proxy:** Usage widgets honor the uppercase `HTTPS_PROXY` environment variable for their direct API call to Anthropic.

> 🪟 **Windows Support:** PowerShell examples, installation notes, fonts, troubleshooting, WSL, and Windows Terminal configuration are in [docs/WINDOWS.md](docs/WINDOWS.md).

</details>

<details>
<summary><b>Claude Code settings.json format</b></summary>

When you install from the TUI, ccstatusline writes a `statusLine` command object to your Claude Code settings:

```json
{
  "statusLine": {
    "type": "command",
    "command": "npx -y ccstatusline-usage@latest",
    "padding": 0,
    "refreshInterval": 10
  }
}
```

`refreshInterval` is written only when your Claude Code version supports it (>=2.1.97). The TUI can set it to `1-60` seconds, or remove it by leaving the input empty.

Other supported command values are:
- `bunx -y ccstatusline-usage@latest`
- `ccstatusline` (for self-managed/global installs)

---

## 🪟 Windows Support

ccstatusline works seamlessly on Windows with full feature compatibility across PowerShell (5.1+ and 7+), Command Prompt, and Windows Subsystem for Linux (WSL).

### Installation on Windows

#### Option 1: Using Bun (Recommended)
```powershell
# Install Bun for Windows
irm bun.sh/install.ps1 | iex

# Run ccstatusline
bunx -y ccstatusline-usage@latest
```

#### Option 2: Using Node.js
```powershell
# Using npm
npx -y ccstatusline-usage@latest

# Or with Yarn
yarn dlx ccstatusline-usage@latest

# Or with pnpm
pnpm dlx ccstatusline-usage@latest
```

### Windows-Specific Features

#### Powerline Font Support
For optimal Powerline rendering on Windows:

**Windows Terminal** (Recommended):
- Supports Powerline fonts natively
- Download from [Microsoft Store](https://aka.ms/terminal)
- Auto-detects compatible fonts

**PowerShell/Command Prompt**:
```powershell
# Install JetBrains Mono Nerd Font via winget
winget install DEVCOM.JetBrainsMonoNerdFont

# Or download manually from: https://www.nerdfonts.com/font-downloads

# Alternative: Download and install base JetBrains Mono font
# from [JetBrains](https://www.jetbrains.com/lp/mono/)
# or [GitHub](https://github.com/JetBrains/JetBrainsMono)
# or [Google Fonts](https://fonts.google.com/specimen/JetBrains+Mono)
```

#### Path Handling
ccstatusline automatically handles Windows-specific paths:
- Git repositories work with both `/` and `\` path separators
- Current Working Directory widget displays Windows-style paths correctly
- Full support for mapped network drives and UNC paths
- Handles Windows drive letters (C:, D:, etc.)

### Windows Troubleshooting

#### Common Issues & Solutions

**Issue**: Powerline symbols showing as question marks or boxes
```powershell
# Solution: Install a compatible Nerd Font
winget install DEVCOM.JetBrainsMonoNerdFont
# Then set the font in your terminal settings
```

**Issue**: Git commands not recognized
```powershell
# Check if Git is installed and in PATH
git --version

# If not found, install Git:
winget install Git.Git
# Or download from: https://git-scm.com/download/win
```

**Issue**: Permission errors during installation
```powershell
# Use non-global installation (recommended)
npx -y ccstatusline-usage@latest

# Or run PowerShell as Administrator for global install
```

**Issue**: "Execution Policy" errors in PowerShell
```powershell
# Temporarily allow script execution
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Issue**: Windows Defender blocking execution
```powershell
# If Windows Defender flags the binary:
# 1. Open Windows Security
# 2. Go to "Virus & threat protection"
# 3. Add exclusion for the ccstatusline binary location
# Or use temporary bypass (not recommended for production):
Add-MpPreference -ExclusionPath "$env:USERPROFILE\.bun\bin"
```

#### Windows Subsystem for Linux (WSL)
ccstatusline works perfectly in WSL environments:

```bash
# Install in WSL Ubuntu/Debian
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bunx -y ccstatusline-usage@latest
```

**WSL Benefits**:
- Native Unix-style path handling
- Better font rendering in WSL terminals
- Seamless integration with Linux development workflows

### Windows Terminal Configuration

For the best experience, configure Windows Terminal with these recommended settings:

#### Terminal Settings (settings.json)
```json
{
  "profiles": {
    "defaults": {
      "font": {
        "face": "JetBrainsMono Nerd Font",
        "size": 12
      },
      "colorScheme": "One Half Dark"
    }
  }
}
```

#### Claude Code Integration
Configure ccstatusline in your Claude Code settings:

**Settings Location:**
- Default: `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`)
- Custom: Set `CLAUDE_CONFIG_DIR` environment variable to use a different directory

**For Bun users**:
```json
{
  "statusLine": {
    "type": "command",
    "command": "bunx -y ccstatusline-usage@latest",
    "padding": 0
  }
}
```

**For npm users**:
```json
{
  "statusLine": {
    "type": "command",
    "command": "npx -y ccstatusline-usage@latest",
    "padding": 0
  }
}
```

> 💡 **Custom Config Directory:** If you use a non-standard Claude Code configuration directory, set the `CLAUDE_CONFIG_DIR` environment variable before running ccstatusline. The tool will automatically detect and use your custom location.

### Performance on Windows

ccstatusline includes Windows-specific runtime behavior:
- **UTF-8 piped output fix**: In piped mode, it attempts to set code page `65001` for reliable symbol rendering
- **Path compatibility**: Git and CWD widgets handle both `/` and `\` separators
- **Block timer cache**: Cached block metrics reduce repeated JSONL scanning

### Windows-Specific Widget Behavior

Some widgets have Windows-specific optimizations:

- **Current Working Directory**: Displays Windows drive letters and UNC paths
- **Git Widgets**: Handle Windows line endings (CRLF) automatically  
- **Custom Commands**: Support both PowerShell and cmd.exe commands
- **Block Timer**: Accounts for Windows timezone handling

---

## 📖 Usage

Once configured, ccstatusline automatically formats your Claude Code status line. The status line appears at the bottom of your terminal during Claude Code sessions.

### Runtime Modes

- **Interactive mode (TUI)**: Launches when there is no stdin input
- **Piped mode (renderer)**: Parses Claude Code status JSON from stdin and prints one or more formatted lines

```bash
# Interactive TUI
bun run start

# Piped mode with example payload
bun run example
```

### 📊 Available Widgets

- **Model** - Displays the Claude model name (e.g., "Claude 3.5 Sonnet")
- **Output Style** - Shows the current Claude Code output style
- **Git Branch** - Shows the current git branch name
- **Git Changes** - Shows git changes count (`+insertions`, `-deletions`)
- **Git Insertions** - Shows git insertions count
- **Git Deletions** - Shows git deletions count
- **Git Root Dir** - Shows the git repository root directory name
- **Git Worktree** - Shows the current git worktree name
- **Current Working Dir** - Shows current working directory with segment limit, fish-style abbreviation, and optional `~` home abbreviation
- **Tokens Input** - Shows input token count for the current session
- **Tokens Output** - Shows output token count for the current session
- **Tokens Cached** - Shows cached token count for the current session
- **Tokens Total** - Shows total token count (`input + output + cache`) for the current session
- **Input Speed** - Shows session-average input token speed (`tokens/sec`) with optional per-widget window (`0-120` seconds; `0` = full-session average)
- **Output Speed** - Shows session-average output token speed (`tokens/sec`) with optional per-widget window (`0-120` seconds; `0` = full-session average)
- **Total Speed** - Shows session-average total token speed (`tokens/sec`) with optional per-widget window (`0-120` seconds; `0` = full-session average)
- **Context Length** - Shows the current context window size in tokens
- **Context %** - Shows percentage of context window used or remaining
- **Context % (usable)** - Shows percentage of usable context used or remaining (80% of max before auto-compact)
- **Session Clock** - Shows elapsed time since current session started
- **Session Cost** - Shows the total session cost in USD
- **Block Timer** - Shows current 5-hour block elapsed time or progress
- **Terminal Width** - Shows current terminal width in columns
- **Version** - Shows Claude Code CLI version number
- **Custom Text** - Displays user-defined custom text
- **Custom Command** - Executes a custom shell command and displays output (refreshes whenever Claude Code updates the status line)
- **Link** - Displays a clickable terminal hyperlink using OSC 8
- **Claude Session ID** - Shows the current Claude Code session ID from status JSON
- **Session Name** - Shows the session name set via `/rename` in Claude Code
- **Memory Usage** - Shows system memory usage (used/total)
- **Battery** *(ccstatusline-usage)* - Shows battery percentage on macOS and Linux (only visible when on battery power, hidden when charging)
- **Session Usage** - Shows daily/session API usage percentage
- **Weekly Usage** - Shows weekly API usage percentage
- **Weekly Pace** - Pendulum bar or text label showing if usage pace is on track, overcooking, or underutilized (toggle with `p` key in TUI)
- **Block Reset Timer** - Shows time remaining until current 5-hour block reset window
- **Weekly Reset Timer** - Shows time remaining until weekly usage reset
- **Context Bar** - Shows context usage as a progress bar with short/full display modes
- **Skills** - Shows skill activity as last used, total count, or unique list (with optional list limit and hide-when-empty toggle)
- **Thinking Effort** - Shows the current Claude Code thinking effort level
- **Vim Mode** - Displays current vim editor mode
- **Off Peak** *(ccstatusline-usage)* - Shows `Off-peak (X:XX hr)` or `Peak (X:XX hr)` with countdown to next status change. Peak hours (5-11 AM PT weekdays) drain sessions faster per Anthropic's permanent capacity policy
- **Separator** - Visual divider between widgets (available when Powerline mode is off and no default separator is configured)
- **Flex Separator** - Expands to fill available space (available when Powerline mode is off)

---

### Terminal Width Options
These settings affect where long lines are truncated, and where right-alignment occurs when using flex separators:
- **Full width always** - Uses full terminal width (may wrap if auto-compact message appears or IDE integration adds text)
- **Full width minus 40** - Reserves 40 characters for auto-compact message to prevent wrapping (default)
- **Full width until compact** - Dynamically switches between full width and minus 40 based on context percentage threshold (configurable, default 60%)

---

### ⚙️ Global Options

Configure global formatting preferences that apply to all widgets:

![Global Options](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/global.png)

#### Default Padding & Separators
- **Default Padding** - Add consistent padding to the left and right of each widget
- **Default Separator** - Automatically insert a separator between all widgets
  - Press **(p)** to edit padding
  - Press **(s)** to edit separator

<details>
<summary><b>Global Formatting Options</b></summary>

- **Inherit Colors** - Default separators inherit foreground and background colors from the preceding widget
  - Press **(i)** to toggle
- **Global Bold** - Apply bold formatting to all text regardless of individual widget settings
  - Press **(o)** to toggle
- **Override Foreground Color** - Force all widgets to use the same text color
  - Press **(f)** to cycle through colors
  - Press **(g)** to clear override
- **Override Background Color** - Force all widgets to use the same background color
  - Press **(b)** to cycle through colors
  - Press **(c)** to clear override

</details>

> 💡 **Note:** These settings are applied during rendering and don't add widgets to your widget list. They provide a consistent look across your entire status line without modifying individual widget configurations.

> ⚠️ **VSCode Users:** If colors appear incorrect in the VSCode integrated terminal, the "Terminal › Integrated: Minimum Contrast Ratio" (`terminal.integrated.minimumContrastRatio`) setting is forcing a minimum contrast between foreground and background colors. You can adjust this setting to 1 to disable the contrast enforcement, or use a standalone terminal for accurate colors.

### ⏱️ Block Timer Widget

The Block Timer widget helps you track your progress through Claude Code's 5-hour conversation blocks:

![Block Timer](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/blockTimer.png)

**Display Modes:**
- **Time Display** - Shows elapsed time as "3hr 45m" (default)
- **Progress Bar** - Full width 32-character progress bar with percentage
- **Progress Bar (Short)** - Compact 16-character progress bar with percentage

**Features:**
- Automatically detects block boundaries from transcript timestamps
- Floors block start time to the hour for consistent tracking
- Shows "Block: 3hr 45m" in normal mode or just "3hr 45m" in raw value mode
- Progress bars show completion percentage (e.g., "[████████████████████████░░░░░░░░] 73.9%")
- Toggle between modes with the **(p)** key in the widgets editor

### 🔤 Raw Value Mode

Some widgets support "raw value" mode which displays just the value without a label:
- Normal: `Model: Claude 3.5 Sonnet` → Raw: `Claude 3.5 Sonnet`
- Normal: `Session: 2hr 15m` → Raw: `2hr 15m`
- Normal: `Block: 3hr 45m` → Raw: `3hr 45m`
- Normal: `Ctx: 18.6k` → Raw: `18.6k`

### ⌨️ Widget Editor Keybinds

Common controls in the line editor:
- `a` add widget
- `i` insert widget
- `Enter` enter/exit move mode
- `d` delete selected widget
- `r` toggle raw value (supported widgets)
- `m` cycle merge mode (`off` → `merge` → `merge no padding`)

Widget-specific shortcuts:
- **Git widgets**: `h` toggle hide `no git` output
- **Context % widgets**: `u` toggle used vs remaining display
- **Block Timer**: `p` cycle display mode (time/full bar/short bar)
- **Block Reset Timer**: `p` cycle display mode (time/full bar/short bar)
- **Weekly Reset Timer**: `p` cycle display mode (time/full bar/short bar)
- **Weekly Pace**: `p` toggle pendulum bar / text label
- **Current Working Dir**: `h` home abbreviation, `s` segment editor, `f` fish-style path
- **Custom Command**: `e` command, `w` max width, `t` timeout, `p` preserve ANSI colors
- **Link**: `u` URL, `e` link text

---

### 🔧 Custom Widgets

#### Custom Text Widget
Add static text to your status line. Perfect for:
- Project identifiers
- Environment indicators (dev/prod)
- Personal labels or reminders

#### Custom Command Widget
Execute shell commands and display their output dynamically:
- Refreshes whenever the statusline is updated by Claude Code
- Receives the full Claude Code JSON data via stdin (model info, session ID, transcript path, etc.)
- Displays command output inline in your status line
- Configurable timeout (default: 1000ms)
- Optional max-width truncation
- Optional ANSI color preservation (`preserve colors`)
- Examples:
  - `pwd | xargs basename` - Show current directory name
  - `node -v` - Display Node.js version
  - `git rev-parse --short HEAD` - Show current commit hash
  - `date +%H:%M` - Display current time
  - `curl -s wttr.in?format="%t"` - Show current temperature
  - `npx -y ccusage@latest statusline` - Display Claude usage metrics (set timeout: 5000ms)

> ⚠️ **Important:** Commands should complete quickly to avoid delays. Long-running commands will be killed after the configured timeout. If you're not seeing output from your custom command, try increasing the timeout value (press 't' in the editor).

> 💡 **Tip:** Custom commands can be other Claude Code compatible status line formatters! They receive the same JSON via stdin that ccstatusline receives from Claude Code, allowing you to chain or combine multiple status line tools.

#### Link Widget
Create clickable links in terminals that support OSC 8 hyperlinks:
- `metadata.url` - target URL (http/https)
- `metadata.text` - optional display text (defaults to URL)
- Falls back to plain text when URL is missing or unsupported

---

### 🔗 Integration Example: ccusage

[ccusage](https://github.com/ryoppippi/ccusage) is a tool that tracks and displays Claude Code usage metrics. You can integrate it directly into your status line:

1. Add a Custom Command widget
2. Set command: `npx -y ccusage@latest statusline`
3. Set timeout: `5000` (5 seconds for initial download)
4. Enable "preserve colors" to keep ccusage's color formatting

![ccusage integration](https://raw.githubusercontent.com/sirmalloc/ccstatusline/main/screenshots/ccusage.png)

> 📄 **How it works:** The command receives Claude Code's JSON data via stdin, allowing ccusage to access session information, model details, and transcript data for accurate usage tracking.

### ✂️ Smart Truncation

When terminal width is detected, status lines automatically truncate with ellipsis (...) if they exceed the available width, preventing line wrapping.
Truncation is ANSI/OSC-aware, so preserved color output and OSC 8 hyperlinks remain well-formed.

---

## 📖 API Documentation

Complete API documentation is generated using TypeDoc and includes detailed information about:

- **Core Types**: Configuration interfaces, widget definitions, and render contexts
- **Widget System**: All available widgets and their customization options  
- **Utility Functions**: Helper functions for rendering, configuration, and terminal handling
- **Status Line Rendering**: Core rendering engine and formatting options

### Generating Documentation

To generate the API documentation locally:

```bash
# Generate documentation
bun run docs

# Clean generated documentation
bun run docs:clean
```

The documentation will be generated in the `docs/` directory and can be viewed by opening `docs/index.html` in your web browser.

### Documentation Structure

- **Types**: Core TypeScript interfaces and type definitions
- **Widgets**: Individual widget implementations and their APIs
- **Utils**: Utility functions for configuration, rendering, and terminal operations
- **Main Module**: Primary entry point and orchestration functions

---

## 🛠️ Development

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- Git
- Node.js 14+ (optional, for running the built `dist/ccstatusline.js` binary or npm publishing)

### Setup

```bash
# Clone the repository
git clone https://github.com/pcvelz/ccstatusline-usage.git
cd ccstatusline

# Install dependencies
bun install
```

### Development Commands

```bash
# Run in TUI mode
bun run start

# Test piped mode with example payload
bun run example

# Run tests
bun test

# Run typecheck + eslint checks without modifying files
bun run lint

# Apply ESLint auto-fixes intentionally
bun run lint:fix

# Build for distribution
bun run build

# Generate TypeDoc documentation
bun run docs
```

### Configuration Files

- `~/.config/ccstatusline/settings.json` - ccstatusline UI/render settings
- `~/.claude/settings.json` - Claude Code settings (`statusLine` command object)
- `~/.cache/ccstatusline/block-cache-*.json` - block timer cache (keyed by Claude config directory hash)

If you use a custom Claude config location, set `CLAUDE_CONFIG_DIR` and ccstatusline will read/write that path instead of `~/.claude`.

### Build Notes

- Build target is Node.js 14+ (`dist/ccstatusline.js`)
- During install, `ink@6.2.0` is patched to fix backspace handling on macOS terminals

### 📁 Project Structure

```
ccstatusline/
├── src/
│   ├── ccstatusline.ts         # Main entry point
│   ├── tui/                    # React/Ink configuration UI
│   │   ├── App.tsx             # Root TUI component
│   │   ├── index.tsx           # TUI entry point
│   │   └── components/         # UI components
│   │       ├── MainMenu.tsx
│   │       ├── LineSelector.tsx
│   │       ├── ItemsEditor.tsx
│   │       ├── ColorMenu.tsx
│   │       ├── PowerlineSetup.tsx
│   │       └── ...
│   ├── widgets/                # Status line widget implementations
│   │   ├── Model.ts
│   │   ├── GitBranch.ts
│   │   ├── TokensTotal.ts
│   │   ├── OutputStyle.ts
│   │   └── ...
│   ├── utils/                  # Utility functions
│   │   ├── config.ts           # Settings management
│   │   ├── renderer.ts         # Core rendering logic
│   │   ├── powerline.ts        # Powerline font utilities
│   │   ├── colors.ts           # Color definitions
│   │   └── claude-settings.ts  # Claude Code integration (supports CLAUDE_CONFIG_DIR)
│   └── types/                  # TypeScript type definitions
│       ├── Settings.ts
│       ├── Widget.ts
│       ├── PowerlineConfig.ts
│       └── ...
├── dist/                       # Built files (generated)
├── package.json
├── tsconfig.json
└── README.md
```
## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request


## 🗑️ Uninstall

```bash
npm uninstall -g ccstatusline-usage
rm -rf ~/.npm/_npx ~/.config/ccstatusline ~/.cache/ccstatusline*
jq 'del(.statusLine)' ~/.claude/settings.json > /tmp/cs.json && cat /tmp/cs.json > ~/.claude/settings.json
```


## 📄 License

[MIT](LICENSE) © Matthew Breedlove


## 👤 Author

**Matthew Breedlove**

- GitHub: [@sirmalloc](https://github.com/sirmalloc)

**PC van Velzen** ([pcvelz/ccstatusline-usage](https://github.com/pcvelz/ccstatusline-usage) fork)

- GitHub: [@pcvelz](https://github.com/pcvelz)

---

## 🔗 Related Projects

- [tweakcc](https://github.com/Piebald-AI/tweakcc) - Customize Claude Code themes, thinking verbs, and more.
- [ccusage](https://github.com/ryoppippi/ccusage) - Track and display Claude Code usage metrics.
- [codachi](https://github.com/vincent-k2026/codachi) - A tamagotchi-style statusline pet that grows with your context window.
- [AIWatch](https://ai-watch.dev) - Live status monitor for 30+ AI APIs and apps; pairs with a Custom Command widget to surface provider outages in your status line.


## 🙏 Acknowledgments

- Built for use with [Claude Code CLI](https://claude.ai/code) by Anthropic
- Powered by [Ink](https://github.com/vadimdemedes/ink) for the terminal UI
- Made with ❤️ for the Claude Code community

<br />

## Star History

<a href="https://www.star-history.com/#sirmalloc/ccstatusline&Timeline">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=sirmalloc/ccstatusline&type=Timeline&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=sirmalloc/ccstatusline&type=Timeline" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=sirmalloc/ccstatusline&type=Timeline" />
 </picture>
</a>

<div align="center">

### 🌟 Show Your Support

Give a ⭐ if this project helped you!

[![GitHub stars](https://img.shields.io/github/stars/sirmalloc/ccstatusline?style=social)](https://github.com/sirmalloc/ccstatusline/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/sirmalloc/ccstatusline?style=social)](https://github.com/sirmalloc/ccstatusline/network/members)
[![GitHub watchers](https://img.shields.io/github/watchers/sirmalloc/ccstatusline?style=social)](https://github.com/sirmalloc/ccstatusline/watchers)

[![npm version](https://img.shields.io/npm/v/ccstatusline-usage.svg)](https://www.npmjs.com/package/ccstatusline-usage)
[![npm downloads](https://img.shields.io/npm/dm/ccstatusline-usage.svg)](https://www.npmjs.com/package/ccstatusline-usage)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/pcvelz/ccstatusline-usage/blob/main/LICENSE)
[![Made with Bun](https://img.shields.io/badge/Made%20with-Bun-000000.svg?logo=bun)](https://bun.sh)

[![Issues](https://img.shields.io/github/issues/sirmalloc/ccstatusline)](https://github.com/sirmalloc/ccstatusline/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/sirmalloc/ccstatusline)](https://github.com/sirmalloc/ccstatusline/pulls)
[![Contributors](https://img.shields.io/github/contributors/sirmalloc/ccstatusline)](https://github.com/sirmalloc/ccstatusline/graphs/contributors)

### 💬 Connect

[Report Bug](https://github.com/sirmalloc/ccstatusline/issues) · [Request Feature](https://github.com/sirmalloc/ccstatusline/issues) · [Discussions](https://github.com/sirmalloc/ccstatusline/discussions)

</div>
