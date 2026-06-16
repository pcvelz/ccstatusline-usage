import type {
    FetchUsageDataOptions,
    UsageData
} from '../usage-types';

export type ProviderName = 'anthropic' | 'opencode' | 'kimi' | 'null';

export interface UsageProvider {
    readonly name: ProviderName;
    fetchUsage(options?: FetchUsageDataOptions): Promise<UsageData>;
}
