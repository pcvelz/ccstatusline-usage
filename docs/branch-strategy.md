# Branch Strategy

## Future Branch Workflow

`main` is the production branch. `future` is a long-lived branch that contains Kimi-specific customizations (widgets, usage provider, and bash scripts). `future` is **never merged into `main`**.

### Branch Guard

The `future` branch registers a PreToolUse hook in `.claude/settings.json` that blocks the Bash tool when the current branch is `future`. This prevents accidental merges, force-pushes, or direct shell modifications on the isolated branch.

If you need to run shell commands on `future`, do so manually outside of Claude Code, or temporarily disable the guard (not recommended without a specific reason).

### Adding Code to `future`

- Use Write/Edit/Agent tools for source changes.
- Keep Kimi-specific code in dedicated files (`src/widgets/KimiUsage.tsx` for the Kimi widgets, `src/utils/usage/providers/kimi.ts`, `scripts/kimi-usage.sh`) so pulling `main` into `future` produces minimal conflicts.
- Do not change `main`-branch behavior; `future` should only add files or extend types in backward-compatible ways.

### Release Flow

1. Run `/release` from `main`. The skill publishes to npm and GitHub.
2. At the end of `/release`, the skill runs `git checkout future`.
3. Manually sync `future` with the latest `main`:
   ```bash
   git pull origin main
   ```
4. Re-link the `~/.claude/` ccstatusline plugin path to the current working directory (the `future` checkout):
   ```bash
   ln -sfn "$(pwd)" ~/.claude/ccstatusline-usage
   ```
   Adjust the target inside `~/.claude/` to match your local plugin/skill layout.

### Kimi Setup

1. Retrieve the Kimi API key via Chrome MCP and save it to `.kimi.env`:
   ```bash
   KIMI_AUTH_TOKEN=<token from Chrome MCP>
   ```
2. `.kimi.env` is gitignored and must never be committed.
3. The status line will show `Kimi Weekly` / `KW` and `Kimi Monthly` / `KM` widgets when the active model is a Kimi model.
