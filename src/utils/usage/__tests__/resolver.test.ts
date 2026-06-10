import {
    describe,
    expect,
    it
} from 'vitest';

import { resolveProvider } from '../resolver';

describe('resolveProvider', () => {
    it('routes opus to anthropic', () => {
        expect(resolveProvider('claude-opus-4-7').name).toBe('anthropic');
    });
    it('routes sonnet to anthropic', () => {
        expect(resolveProvider('claude-sonnet-4-6[1m]').name).toBe('anthropic');
    });
    it('routes fable to anthropic', () => {
        expect(resolveProvider('claude-fable-5[1m]').name).toBe('anthropic');
    });
    it('routes haiku to anthropic', () => {
        expect(resolveProvider('claude-haiku-4-5-20251001').name).toBe('anthropic');
    });
    it('routes glm-5.1 to opencode', () => {
        expect(resolveProvider('glm-5.1').name).toBe('opencode');
    });
    it('routes kimi-k2.6 to opencode', () => {
        expect(resolveProvider('kimi-k2.6').name).toBe('opencode');
    });
    it('routes minimax-m2.7 to opencode', () => {
        expect(resolveProvider('minimax-m2.7').name).toBe('opencode');
    });
    it('routes qwen 3.6 plus to opencode', () => {
        expect(resolveProvider('qwen-3.6-plus').name).toBe('opencode');
    });
    it('routes local ollama qwen to opencode (shares pattern)', () => {
        expect(resolveProvider('qwen3.6:35b-a3b-q4_K_M').name).toBe('opencode');
    });
    it('returns null for unknown model id', () => {
        expect(resolveProvider('mistral-7b').name).toBe('null');
    });
    it('returns null for empty string', () => {
        expect(resolveProvider('').name).toBe('null');
    });
    it('returns null for undefined', () => {
        expect(resolveProvider(undefined).name).toBe('null');
    });
});
