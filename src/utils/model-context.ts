import { getLocalModelContext } from './local-model-context';
import modelContextData from './model-context.json';

interface ModelContextConfig {
    maxTokens: number;
    usableTokens: number;
}

interface ModelIdentifier {
    id?: string;
    display_name?: string;
}

const DEFAULT_CONTEXT_WINDOW_SIZE = 200000;
const USABLE_CONTEXT_RATIO = 0.8;
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

function toContextConfig(maxTokens: number): ModelContextConfig {
    return {
        maxTokens,
        usableTokens: Math.floor(maxTokens * USABLE_CONTEXT_RATIO)
    };
}

export function getContextConfig(modelIdentifier?: string, contextWindowSize?: number | null): ModelContextConfig {
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
        return toContextConfig(statusWindowSize);
    }

    // Last-resort fallback when neither the live status window size nor a
    // model-name hint is available. Defaults to 200k, overridable via
    // CCSTATUSLINE_CONTEXT_SIZE_FALLBACK.
    const fallbackWindowSize = getFallbackContextWindowSize();
    const defaultConfig = {
        maxTokens: fallbackWindowSize,
        usableTokens: Math.floor(fallbackWindowSize * USABLE_CONTEXT_RATIO)
    };

    if (!modelIdentifier) {
        return defaultConfig;
    }

    // LOCAL models (llama.cpp / llama-swap) are single-sourced from llama-cm's
    // models.json by gguf_basename — never from a hardcoded duplicate. This is
    // checked BEFORE the JSON mappings so models.json is authoritative for them
    // (and so a generic mappings pattern like "qwen3.6-35b" can't shadow a local
    // basename with a stale value). Live context_window_size already won above.
    const localContextSize = getLocalModelContext(modelIdentifier);
    if (localContextSize !== null) {
        return {
            maxTokens: localContextSize,
            usableTokens: Math.floor(localContextSize * USABLE_CONTEXT_RATIO)
        };
    }

    // Check against JSON family/pattern mappings (matched via .includes()) —
    // third-party / remote / Ollama models; local llamacpp basenames are
    // resolved above. An authoritative live context_window_size already won;
    // this is the fresh-session fallback, and the correction for the CLI's
    // 200000 default.
    for (const entry of modelContextData.mappings) {
        if (normalizedModel.includes(entry.pattern)) {
            return toContextConfig(entry.contextSize);
        }
    }

    // Live 200000 sentinel with no mapping match: keep the live value rather
    // than guessing from the model name (a [1m]-suffixed id at a gated 200k
    // window must not be inflated back to 1M by the name parser).
    if (statusWindowSize !== null) {
        return toContextConfig(statusWindowSize);
    }

    const inferredWindowSize = parseContextWindowSize(modelIdentifier);
    if (inferredWindowSize !== null) {
        return {
            maxTokens: inferredWindowSize,
            usableTokens: Math.floor(inferredWindowSize * USABLE_CONTEXT_RATIO)
        };
    }

    return defaultConfig;
}
