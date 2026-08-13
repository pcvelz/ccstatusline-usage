import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    getContextConfig,
    getModelContextIdentifier
} from '../model-context';

describe('getContextConfig', () => {
    describe('Status JSON context window size override', () => {
        it('should use context_window_size as max tokens when provided', () => {
            const config = getContextConfig('claude-3-5-sonnet-20241022', 1000000);

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should prioritize context_window_size over [1m] model suffix', () => {
            const config = getContextConfig('claude-sonnet-4-5-20250929[1m]', 200000);

            expect(config.maxTokens).toBe(200000);
            expect(config.usableTokens).toBe(160000);
        });

        it('should prefer a non-default live size over the family mapping (384K local Qwen)', () => {
            const config = getContextConfig('Qwen3.6-35B-A3B-APEX-I-Balanced-384K', 393216);

            expect(config.maxTokens).toBe(393216);
        });

        it('should fall back to the mapping when the live size is the 200000 CLI default', () => {
            const config = getContextConfig('qwen3-coder:30b', 200000);

            expect(config.maxTokens).toBe(262144);
        });
    });

    describe('Models with [1m] suffix', () => {
        it('should return 1M context window for claude-sonnet-4-5 with [1m] suffix', () => {
            const config = getContextConfig('claude-sonnet-4-5-20250929[1m]');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 1M context window for claude-opus-4-7 with [1m] suffix', () => {
            const config = getContextConfig('claude-opus-4-7[1m]');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 1M context window for AWS Bedrock format with [1m] suffix', () => {
            const config = getContextConfig(
                'us.anthropic.claude-sonnet-4-5-20250929-v1:0[1m]'
            );

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 1M context window with uppercase [1M] suffix', () => {
            const config = getContextConfig('claude-sonnet-4-5-20250929[1M]');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 1M context window for model IDs with 1M context label', () => {
            const config = getContextConfig('Opus 4.7 (1M context)');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 1M context window for model IDs with 1M token context label', () => {
            const config = getContextConfig('Claude Opus 4.7 - 1M token context');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 1M context window for model IDs with 1M in parentheses', () => {
            const config = getContextConfig('Opus 4.7 (1M)');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 1M context window for model IDs with 1M in square brackets', () => {
            const config = getContextConfig('Opus 4.5 [1M]');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });
    });

    describe('Models without [1m] suffix', () => {
        it('should return 1M context window for claude-fable-5 without [1m] suffix', () => {
            const config = getContextConfig('claude-fable-5');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('should return 200k context window for claude-sonnet-4-5 without [1m] suffix', () => {
            const config = getContextConfig('claude-sonnet-4-5-20250929');

            expect(config.maxTokens).toBe(200000);
            expect(config.usableTokens).toBe(160000);
        });

        it('should return 200k context window for AWS Bedrock format without [1m] suffix', () => {
            const config = getContextConfig(
                'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
            );

            expect(config.maxTokens).toBe(200000);
            expect(config.usableTokens).toBe(160000);
        });
    });

    describe('Older/default models', () => {
        it('should return 200k context window for older Sonnet 3.5 model', () => {
            const config = getContextConfig('claude-3-5-sonnet-20241022');

            expect(config.maxTokens).toBe(200000);
            expect(config.usableTokens).toBe(160000);
        });

        it('should return 200k context window when model ID is undefined', () => {
            const config = getContextConfig(undefined);

            expect(config.maxTokens).toBe(200000);
            expect(config.usableTokens).toBe(160000);
        });

        it('should return 200k context window for unknown model ID', () => {
            const config = getContextConfig('claude-unknown-model');

            expect(config.maxTokens).toBe(200000);
            expect(config.usableTokens).toBe(160000);
        });
    });

    describe('Third-party models', () => {
        it('should return 200k context window for glm-5.1', () => {
            const config = getContextConfig('glm-5.1');

            expect(config.maxTokens).toBe(204800);
            expect(config.usableTokens).toBe(163840);
        });

        it('should return 200k context window for minimax-m2.7', () => {
            const config = getContextConfig('minimax-m2.7');

            expect(config.maxTokens).toBe(204800);
            expect(config.usableTokens).toBe(163840);
        });

        it('should return 256k context window for kimi-for-coding', () => {
            const config = getContextConfig('kimi-for-coding');

            expect(config.maxTokens).toBe(262144);
            expect(config.usableTokens).toBe(209715);
        });
    });

    describe('CCSTATUSLINE_CONTEXT_SIZE_FALLBACK override', () => {
        afterEach(() => {
            delete process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK;
        });

        it('uses the env value as the fallback when no window size is otherwise known', () => {
            process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = '1000000';
            const config = getContextConfig('claude-sonnet-4-5-20250929');

            expect(config.maxTokens).toBe(1000000);
            expect(config.usableTokens).toBe(800000);
        });

        it('uses the env value as the fallback when the model is unknown', () => {
            process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = '500000';
            const config = getContextConfig(undefined);

            expect(config.maxTokens).toBe(500000);
            expect(config.usableTokens).toBe(400000);
        });

        it('falls back to 200k when the env value is non-numeric', () => {
            process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = 'not-a-number';
            const config = getContextConfig('claude-3-5-sonnet-20241022');

            expect(config.maxTokens).toBe(200000);
            expect(config.usableTokens).toBe(160000);
        });

        it('falls back to 200k when the env value is zero or negative', () => {
            process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = '0';
            expect(getContextConfig(undefined).maxTokens).toBe(200000);

            process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = '-5';
            expect(getContextConfig(undefined).maxTokens).toBe(200000);
        });

        it('does not override the live context_window_size from the status JSON', () => {
            process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = '500000';
            const config = getContextConfig('claude-3-5-sonnet-20241022', 1000000);

            expect(config.maxTokens).toBe(1000000);
        });

        it('does not override a [1m] model-name hint', () => {
            process.env.CCSTATUSLINE_CONTEXT_SIZE_FALLBACK = '500000';
            const config = getContextConfig('claude-sonnet-4-5-20250929[1m]');

            expect(config.maxTokens).toBe(1000000);
        });
    });
});

describe('getModelContextIdentifier', () => {
    it('returns string model identifier unchanged', () => {
        expect(getModelContextIdentifier('claude-sonnet-4-5-20250929[1m]')).toBe('claude-sonnet-4-5-20250929[1m]');
    });

    it('prefers both id and display name when available', () => {
        expect(getModelContextIdentifier({
            id: 'claude-opus-4-7',
            display_name: 'Opus 4.7 (1M context)'
        })).toBe('claude-opus-4-7 Opus 4.7 (1M context)');
    });

    it('returns display name when id is missing', () => {
        expect(getModelContextIdentifier({ display_name: 'Opus 4.7 (1M context)' })).toBe('Opus 4.7 (1M context)');
    });

    it('returns undefined when no model value exists', () => {
        expect(getModelContextIdentifier(undefined)).toBeUndefined();
        expect(getModelContextIdentifier({})).toBeUndefined();
    });
});
