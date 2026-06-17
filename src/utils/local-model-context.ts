import * as fs from 'fs';

/**
 * Single source of truth for LOCAL (llama.cpp / llama-swap) model context
 * windows: llama-cm's models.json. The statusline receives the model NAME equal
 * to a model's `gguf_basename` (e.g. "Qwen3.6-35B-A3B-APEX-I-Balanced", passed
 * via `--model`), so we resolve a fresh-session fallback context by matching that
 * basename against models.json and reading the matching entry's `default_ctx`.
 *
 * This file deliberately holds NO context numbers. The previous duplicate table
 * in model-context.json drifted out of sync with models.json (the canonical
 * source); reading models.json directly removes that whole class of bug.
 */

// Canonical manifest = llama-cm's models.json, reached through a repo-local
// SYMLINK (llama-cm-models.json -> llama-cm/llama/models.json). The symlink is
// machine-specific and gitignored (~/.gitignore), so it is never committed — it
// keeps the cross-repo coupling a first-class, visible filesystem link instead of
// a hardcoded llama-cm path. Overridable via CCSTATUSLINE_MODELS_JSON (tests can
// point at a fixture); if the link is absent, readFileSync throws and we fall back
// gracefully (empty map -> caller's non-local resolution + sane default).
const DEFAULT_MODELS_JSON_PATH = '/Users/peter/Documents/Code/ccstatusline-usage/llama-cm-models.json';

function getModelsJsonPath(): string {
    const override = process.env.CCSTATUSLINE_MODELS_JSON;
    return override && override.length > 0 ? override : DEFAULT_MODELS_JSON_PATH;
}

// models.json shape we depend on: a flat map of alias -> entry, where local
// entries carry a `gguf_basename` (the name the statusline sees) and a numeric
// `default_ctx`. Non-local aliases (remote/Scaleway/Kimi/etc.) omit one or both
// and are ignored here — their context resolution stays in model-context.json.
interface ModelsJsonEntry {
    gguf_basename?: unknown;
    default_ctx?: unknown;
}

let cachedBasenameToCtx: Map<string, number> | null = null;
let cacheLoaded = false;

function buildBasenameToCtx(raw: unknown): Map<string, number> {
    const map = new Map<string, number>();
    if (typeof raw !== 'object' || raw === null) {
        return map;
    }

    for (const value of Object.values(raw as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) {
            continue;
        }

        const entry = value as ModelsJsonEntry;
        const basename = entry.gguf_basename;
        const ctx = entry.default_ctx;
        if (typeof basename !== 'string' || basename.length === 0) {
            continue;
        }
        if (typeof ctx !== 'number' || !Number.isFinite(ctx) || ctx <= 0) {
            continue;
        }

        // Ambiguity rule: a single gguf_basename can be shared by several aliases
        // with DIFFERENT default_ctx (e.g. I-Compact is cq35l=262144 and
        // cq35c=131072; Q5_K_XL is cq27=196608 and cq27l=32768). The statusline
        // only ever sees the basename, so we deterministically keep the LARGEST
        // default_ctx among matches — it reflects the largest-context strain the
        // user can launch under that basename, and degrades gracefully (an
        // under-launched smaller-ctx session just shows headroom it won't use,
        // rather than over-reporting fullness on the large strain).
        const key = basename.toLowerCase();
        const existing = map.get(key);
        if (existing === undefined || ctx > existing) {
            map.set(key, ctx);
        }
    }

    return map;
}

function loadBasenameToCtx(): Map<string, number> {
    if (cacheLoaded && cachedBasenameToCtx !== null) {
        return cachedBasenameToCtx;
    }

    cacheLoaded = true;
    try {
        const raw = JSON.parse(fs.readFileSync(getModelsJsonPath(), 'utf-8')) as unknown;
        cachedBasenameToCtx = buildBasenameToCtx(raw);
    } catch {
        // Missing / unreadable / malformed models.json must NEVER crash the
        // statusline (it renders on every prompt). Fall through to an empty map
        // so the caller drops back to its own non-local resolution + sane default.
        cachedBasenameToCtx = new Map<string, number>();
    }

    return cachedBasenameToCtx;
}

/**
 * Resolve a LOCAL model's fresh-session context window from llama-cm models.json
 * by matching the incoming model identifier against `gguf_basename`
 * (case-insensitive). Returns the matching entry's `default_ctx`, or null when
 * the identifier is not a known local basename (so the caller can keep handling
 * non-local / Anthropic models exactly as before).
 *
 * Matching is by substring (the identifier may be `id + display_name`, or carry
 * a suffix), longest basename first so a more specific basename wins over a
 * shorter one it contains.
 */
export function getLocalModelContext(modelIdentifier?: string): number | null {
    if (!modelIdentifier) {
        return null;
    }

    const normalized = modelIdentifier.toLowerCase();
    const map = loadBasenameToCtx();
    if (map.size === 0) {
        return null;
    }

    let best: { length: number; ctx: number } | null = null;
    for (const [basename, ctx] of map) {
        if (!normalized.includes(basename)) {
            continue;
        }
        if (best === null || basename.length > best.length) {
            best = { length: basename.length, ctx };
        }
    }

    return best?.ctx ?? null;
}

/**
 * Test-only: drop the in-process cache so a test can point at a different
 * models.json (or simulate a missing file) between cases. Not used in the
 * render path — each `bun run` is a fresh process, so the cache is naturally
 * one-render-scoped in production.
 */
export function __resetLocalModelContextCache(): void {
    cachedBasenameToCtx = null;
    cacheLoaded = false;
}
