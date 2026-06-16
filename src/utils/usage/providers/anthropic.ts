import { fetchUsageData as fetchAnthropicUsage } from '../../usage-fetch';
import type {
    FetchUsageDataOptions,
    UsageData
} from '../../usage-types';
import type { UsageProvider } from '../types';

export const anthropicProvider: UsageProvider = {
    name: 'anthropic',
    async fetchUsage(options?: FetchUsageDataOptions): Promise<UsageData> {
        const data = await fetchAnthropicUsage(options);
        return { ...data, provider: 'anthropic' };
    }
};
