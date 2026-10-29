import type { FetchUsageDataOptions } from '../usage-fetch';
import type { UsageData } from '../usage-types';

export type ProviderName = 'anthropic' | 'kimi' | 'opencode' | 'null';

export interface UsageProvider {
    readonly name: ProviderName;
    fetchUsage(options?: FetchUsageDataOptions): Promise<UsageData>;
}
