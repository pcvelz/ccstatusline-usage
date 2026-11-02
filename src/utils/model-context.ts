import modelContextData from './model-context.json';

interface ModelContextConfig {
    maxTokens: number;
    usableTokens: number;
}

interface ModelIdentifier {
    id?: string;
    display_name?: string;
}

export interface AutoCompactConfig {
    enabled?: boolean;
    windowSize?: number;
}

const DEFAULT_CONTEXT_WINDOW_SIZE = 200000;
const USABLE_CONTEXT_RATIO = 0.8;
const CONTEXT_WINDOW_ENV_VAR = 'CCSTATUSLINE_CONTEXT_WINDOW_SIZE';
const CONTEXT_SIZE_FALLBACK_ENV_VAR = 'CCSTATUSLINE_CONTEXT_SIZE_FALLBACK';

// User-configurable last-resort fallback window size. Mirrors CCSTATUSLINE_WIDTH:
// a positive integer read from the environment, ignored when unset or invalid.
// Defaults to 200k so behavior is unchanged unless the user opts in.
function getFallbackContextWindowSize(): number {
    const raw = process.env[CONTEXT_SIZE_FALLBACK_ENV_VAR];
    if (raw) {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return DEFAULT_CONTEXT_WINDOW_SIZE;
}

function toValidWindowSize(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }

    return value;
}

const CONTEXT_WINDOW_ENV_REGEX = /^(\d+(?:[,_]\d+)*(?:\.\d+)?)\s*([km])?$/i;

let cachedEnvRaw: string | undefined;
let cachedEnvResult: number | null = null;
let hasCachedEnv = false;

function parsePositiveWindowEnvValue(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }

    const suffixMatch = CONTEXT_WINDOW_ENV_REGEX.exec(trimmed);
    const numericPart = suffixMatch?.[1];
    if (!numericPart) {
        return null;
    }

    const numeric = Number.parseFloat(numericPart.replace(/[,_]/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }

    const unit = suffixMatch[2]?.toLowerCase();
    const multiplier = unit === 'm' ? 1000000 : unit === 'k' ? 1000 : 1;
    return toValidWindowSize(numeric * multiplier);
}

function parseContextWindowEnvValue(raw: string): number | null {
    const parsed = parsePositiveWindowEnvValue(raw);
    if (parsed === null) {
        return null;
    }
    const result = Math.round(parsed);

    // Reject nonsensical tiny windows (e.g. "1.5" without a unit rounds to 2).
    if (result < 1000) {
        return null;
    }

    return result;
}

function parseAutoCompactWindowEnvValue(raw: string): number | null {
    const parsed = parsePositiveWindowEnvValue(raw);
    // Preserve small positive values so they reach Claude Code's minimum clamp.
    return parsed === null ? null : Math.round(Math.max(100000, Math.min(1000000, parsed)));
}

export function getContextWindowEnvOverride(): number | null {
    const raw = process.env[CONTEXT_WINDOW_ENV_VAR];
    if (hasCachedEnv && raw === cachedEnvRaw) {
        return cachedEnvResult;
    }

    cachedEnvRaw = raw;
    cachedEnvResult = raw === undefined ? null : parseContextWindowEnvValue(raw);
    hasCachedEnv = true;
    return cachedEnvResult;
}

function parseContextWindowSize(modelIdentifier: string): number | null {
    const delimitedMatch = /(?:\(|\[)\s*(\d+(?:[,_]\d+)*(?:\.\d+)?)\s*([km])\s*(?:\)|\])/i.exec(modelIdentifier);
    if (delimitedMatch) {
        const delimitedValue = delimitedMatch[1];
        const delimitedUnit = delimitedMatch[2];
        if (!delimitedValue || !delimitedUnit) {
            return null;
        }

        const parsed = Number.parseFloat(delimitedValue.replace(/[,_]/g, ''));
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.round(parsed * (delimitedUnit.toLowerCase() === 'm' ? 1000000 : 1000));
        }
    }

    const contextMatch = /\b(\d+(?:[,_]\d+)*(?:\.\d+)?)\s*([km])(?:\s*(?:token\s*)?context)?\b/i.exec(modelIdentifier);
    if (!contextMatch) {
        return null;
    }

    const contextValue = contextMatch[1];
    const contextUnit = contextMatch[2];
    if (!contextValue || !contextUnit) {
        return null;
    }

    const parsed = Number.parseFloat(contextValue.replace(/[,_]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return Math.round(parsed * (contextUnit.toLowerCase() === 'm' ? 1000000 : 1000));
}

export function getModelContextIdentifier(model?: string | ModelIdentifier): string | undefined {
    if (typeof model === 'string') {
        const trimmed = model.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    if (!model) {
        return undefined;
    }

    const id = model.id?.trim();
    const displayName = model.display_name?.trim();

    if (id && displayName) {
        return `${id} ${displayName}`;
    }

    return id ?? displayName;
}

function toContextConfig(maxTokens: number, autoCompact: AutoCompactConfig): ModelContextConfig {
    return {
        maxTokens,
        usableTokens: getUsableTokens(maxTokens, autoCompact)
    };
}

function isEnabledEnv(value: string | undefined): boolean {
    return /^(1|true|yes|on)$/i.test(value?.trim() ?? '');
}

function getUsableTokens(maxTokens: number, autoCompact: AutoCompactConfig): number {
    if (autoCompact.enabled === false
        || isEnabledEnv(process.env.DISABLE_AUTO_COMPACT)
        || isEnabledEnv(process.env.DISABLE_COMPACT)) {
        return maxTokens;
    }

    const rawWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    const envWindow = rawWindow === undefined ? null : parseAutoCompactWindowEnvValue(rawWindow);
    // Claude Code bounds its compaction window to 100k–1M and the model window.
    const configuredWindow = envWindow ?? toValidWindowSize(autoCompact.windowSize);
    const windowSize = Math.min(maxTokens, configuredWindow ?? maxTokens);

    const rawPercent = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
    const percent = rawPercent === undefined ? NaN : Number(rawPercent.replace(/_/g, ''));
    // The live trigger isn't in the status payload. Retain the existing 80%
    // estimate; an explicit percentage can lower it, never raise it.
    const ratio = Number.isFinite(percent) && percent >= 1 && percent <= 100
        ? Math.min(USABLE_CONTEXT_RATIO, percent / 100)
        : USABLE_CONTEXT_RATIO;
    return Math.max(1, Math.floor(windowSize * ratio));
}

export function getContextConfig(
    modelIdentifier?: string,
    contextWindowSize?: number | null,
    autoCompact: AutoCompactConfig = {}
): ModelContextConfig {
    // The env override is upstream's highest-precedence source; it only applies when set.
    const envOverride = getContextWindowEnvOverride();
    if (envOverride !== null) {
        return toContextConfig(envOverride, autoCompact);
    }

    const statusWindowSize = toValidWindowSize(contextWindowSize);
    const normalizedModel = modelIdentifier?.toLowerCase().trim() ?? '';

    // A live context_window_size wins whenever it differs from the CLI's
    // built-in 200000 default. At exactly 200000 the CLI may be echoing its
    // fallback rather than the session's real window - observed for custom ids
    // (Ollama) AND for first-party 1M models (Fable 5 sessions reported
    // 200000 while their real usage sat at 381k, rendering "381k/200k
    // (191%)"), so the JSON mapping below gets to correct the echo for any
    // model it knows. Models WITHOUT a mapping entry (e.g. a gated
    // sonnet[1m] account genuinely capped at 200k) keep the live 200000 via
    // the sentinel return further down.
    const liveSizeIsAuthoritative = statusWindowSize !== null
        && statusWindowSize !== DEFAULT_CONTEXT_WINDOW_SIZE;
    if (statusWindowSize !== null && liveSizeIsAuthoritative) {
        return toContextConfig(statusWindowSize, autoCompact);
    }

    // Last-resort fallback when neither the live status window size nor a
    // model-name hint is available. Defaults to 200k, overridable via
    // CCSTATUSLINE_CONTEXT_SIZE_FALLBACK.
    const fallbackWindowSize = getFallbackContextWindowSize();
    const defaultConfig = toContextConfig(fallbackWindowSize, autoCompact);

    if (!modelIdentifier) {
        return defaultConfig;
    }

    // Check against JSON family/pattern mappings (matched via .includes()).
    // An authoritative live context_window_size already won above; this is the
    // fresh-session fallback, and the correction for the CLI's 200000 default.
    for (const entry of modelContextData.mappings) {
        if (normalizedModel.includes(entry.pattern)) {
            return toContextConfig(entry.contextSize, autoCompact);
        }
    }

    // Live 200000 sentinel with no mapping match: keep the live value rather
    // than guessing from the model name (a [1m]-suffixed id at a gated 200k
    // window must not be inflated back to 1M by the name parser).
    if (statusWindowSize !== null) {
        return toContextConfig(statusWindowSize, autoCompact);
    }

    const inferredWindowSize = parseContextWindowSize(modelIdentifier);
    if (inferredWindowSize !== null) {
        return toContextConfig(inferredWindowSize, autoCompact);
    }

    return defaultConfig;
}
