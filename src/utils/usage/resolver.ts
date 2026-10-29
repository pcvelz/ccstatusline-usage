import type { RenderContext } from '../../types/RenderContext';

import { anthropicProvider } from './providers/anthropic';
import { createKimiProvider } from './providers/kimi';
import { nullProvider } from './providers/null';
import { opencodeProvider } from './providers/opencode';
import type { UsageProvider } from './types';

const OPENCODE_PATTERN = /(?:^|[^a-z])(glm|kimi|minimax|mm-|qwen|owen|mimo)/i;
const ANTHROPIC_KEYWORDS = ['opus', 'sonnet', 'haiku', 'fable'];

export interface ProviderEnvironment {
    [key: string]: string | undefined;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_BASE_URL?: string;
}

function isKimiCodeModel(modelId: string): boolean {
    const id = modelId.toLowerCase();
    return id.startsWith('k3') || id.startsWith('kimi-for-coding');
}

function isLoopbackHostname(hostname: string): boolean {
    return hostname === 'localhost'
        || hostname === '::1'
        || hostname === '[::1]'
        || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function getKimiBaseUrl(modelId: string, env: ProviderEnvironment): string | null {
    if (!env.ANTHROPIC_BASE_URL) {
        return null;
    }
    try {
        const url = new URL(env.ANTHROPIC_BASE_URL);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        if (url.hostname === 'api.kimi.com' || (isLoopbackHostname(url.hostname) && isKimiCodeModel(modelId))) {
            return url.toString();
        }
    } catch {
        return null;
    }
    return null;
}

export function resolveProvider(modelId: string | undefined | null, env: ProviderEnvironment = process.env): UsageProvider {
    if (!modelId)
        return nullProvider;
    const id = modelId.toLowerCase();
    const kimiBaseUrl = getKimiBaseUrl(id, env);
    if (kimiBaseUrl) {
        return createKimiProvider({ baseUrl: kimiBaseUrl, apiKey: env.ANTHROPIC_API_KEY ?? '' });
    }
    if (isKimiCodeModel(id))
        return opencodeProvider;
    if (ANTHROPIC_KEYWORDS.some(k => id.includes(k)))
        return anthropicProvider;
    if (OPENCODE_PATTERN.test(id))
        return opencodeProvider;
    return nullProvider;
}

export function getModelIdFromContext(context: RenderContext): string {
    const model = context.data?.model;
    return (typeof model === 'string' ? model : model?.id) ?? '';
}
