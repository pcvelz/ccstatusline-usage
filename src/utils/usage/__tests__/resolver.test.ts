import {
    describe,
    expect,
    it
} from 'vitest';

import { resolveProvider } from '../resolver';

function resolveWithoutBackend(modelId: string | undefined | null) {
    return resolveProvider(modelId, {});
}

describe('resolveProvider', () => {
    it('routes opus to anthropic', () => {
        expect(resolveWithoutBackend('claude-opus-4-7').name).toBe('anthropic');
    });
    it('routes sonnet to anthropic', () => {
        expect(resolveWithoutBackend('claude-sonnet-4-6[1m]').name).toBe('anthropic');
    });
    it('routes fable to anthropic', () => {
        expect(resolveWithoutBackend('claude-fable-5[1m]').name).toBe('anthropic');
    });
    it('routes haiku to anthropic', () => {
        expect(resolveWithoutBackend('claude-haiku-4-5-20251001').name).toBe('anthropic');
    });
    it('routes glm-5.1 to opencode', () => {
        expect(resolveWithoutBackend('glm-5.1').name).toBe('opencode');
    });
    it('routes kimi-k2.6 to opencode', () => {
        expect(resolveWithoutBackend('kimi-k2.6').name).toBe('opencode');
    });
    it('routes the direct Kimi Code host to kimi', () => {
        expect(resolveProvider('k3.1-pro[1m]', {
            ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
            ANTHROPIC_API_KEY: 'secret'
        }).name).toBe('kimi');
    });
    it('routes loopback k3 models to kimi', () => {
        expect(resolveProvider('k3.1-pro', {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8111/',
            ANTHROPIC_API_KEY: 'shim-injected'
        }).name).toBe('kimi');
    });
    it('routes loopback kimi-for-coding to kimi', () => {
        expect(resolveProvider('kimi-for-coding', {
            ANTHROPIC_BASE_URL: 'http://localhost:8111/',
            ANTHROPIC_API_KEY: 'shim-injected'
        }).name).toBe('kimi');
    });
    it('keeps k3 models on another remote backend on opencode', () => {
        expect(resolveProvider('k3.1-pro', {
            ANTHROPIC_BASE_URL: 'https://opencode.example.com/',
            ANTHROPIC_API_KEY: 'secret'
        }).name).toBe('opencode');
    });
    it('keeps kimi-for-coding on another remote backend on opencode', () => {
        expect(resolveProvider('kimi-for-coding', {
            ANTHROPIC_BASE_URL: 'https://opencode.example.com/',
            ANTHROPIC_API_KEY: 'secret'
        }).name).toBe('opencode');
    });
    it('does not route non-Kimi loopback models to kimi', () => {
        expect(resolveProvider('qwen3.6:35b-a3b-q4_K_M', {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8001/',
            ANTHROPIC_API_KEY: 'local'
        }).name).toBe('opencode');
        expect(resolveProvider('mistral-7b', {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:8001/',
            ANTHROPIC_API_KEY: 'local'
        }).name).toBe('null');
    });
    it('routes minimax-m2.7 to opencode', () => {
        expect(resolveWithoutBackend('minimax-m2.7').name).toBe('opencode');
    });
    it('routes qwen 3.6 plus to opencode', () => {
        expect(resolveWithoutBackend('qwen-3.6-plus').name).toBe('opencode');
    });
    it('routes local ollama qwen to opencode (shares pattern)', () => {
        expect(resolveWithoutBackend('qwen3.6:35b-a3b-q4_K_M').name).toBe('opencode');
    });
    it('returns null for unknown model id', () => {
        expect(resolveWithoutBackend('mistral-7b').name).toBe('null');
    });
    it('returns null for empty string', () => {
        expect(resolveWithoutBackend('').name).toBe('null');
    });
    it('returns null for undefined', () => {
        expect(resolveWithoutBackend(undefined).name).toBe('null');
    });
});
