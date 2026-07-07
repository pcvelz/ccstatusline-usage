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

    // A live context_window_size wins whenever the CLI actually knows the
    // window: always for first-party claude-* ids (catalog-backed), and for
    // custom ids whenever it differs from the CLI's built-in 200000 default.
    // At exactly 200000 on a custom id the CLI is echoing its fallback (it has
    // no knowledge of the served model, e.g. Ollama), so the JSON mapping below
    // gets to correct it.
    const liveSizeIsAuthoritative = statusWindowSize !== null
        && (normalizedModel.startsWith('claude-')
            || statusWindowSize !== DEFAULT_CONTEXT_WINDOW_SIZE);
    if (statusWindowSize !== null && liveSizeIsAuthoritative) {
        return toContextConfig(statusWindowSize);
    }

    // Default to 200k for older models
    const defaultConfig = toContextConfig(DEFAULT_CONTEXT_WINDOW_SIZE);

    if (!modelIdentifier) {
        return defaultConfig;
    }

    // Check against JSON family/pattern mappings (matched via .includes()).
    // An authoritative live context_window_size already won above; this is the
    // fresh-session fallback, and the correction for the CLI's 200000 default.
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
