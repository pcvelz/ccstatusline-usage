import {
    execSync,
    spawnSync
} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

// Cache configuration
const CACHE_FILE = path.join(os.homedir(), '.cache', 'ccstatusline-api.json');
const LOCK_FILE = path.join(os.homedir(), '.cache', 'ccstatusline-api.lock');
const CACHE_MAX_AGE = 180; // seconds
const LOCK_MAX_AGE = 30;   // rate limit: only try API once per 30 seconds
const TOKEN_CACHE_MAX_AGE = 3600; // 1 hour
const STALE_MAX_AGE = 600; // 10 minutes: after this, stale cache is discarded

// Error types matching shell script
type ApiError = 'no-credentials' | 'timeout' | 'api-error' | 'parse-error';

interface ApiData {
    sessionUsage?: number;  // five_hour.utilization (percentage)
    sessionResetAt?: string; // five_hour.reset_at
    weeklyUsage?: number;   // seven_day.utilization (percentage)
    extraUsageEnabled?: boolean;
    extraUsageLimit?: number;      // in cents
    extraUsageUsed?: number;       // in cents
    extraUsageUtilization?: number;
    fetchedAt?: number;     // unix timestamp when data was fetched from API
    error?: ApiError;
}

// Memory caches
let cachedData: ApiData | null = null;
let cacheTime = 0;
let cachedToken: string | null = null;
let tokenCacheTime = 0;

const CRED_FILE = path.join(os.homedir(), '.claude', '.credentials.json');

function readTokenFromFile(): string | null {
    try {
        const creds = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
        return creds?.claudeAiOauth?.accessToken ?? null;
    } catch {
        return null;
    }
}

function readTokenFromKeychain(): string | null {
    try {
        const result = execSync(
            'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        const parsed = JSON.parse(result);
        return parsed?.claudeAiOauth?.accessToken ?? null;
    } catch {
        return null;
    }
}

function invalidateTokenCache(): void {
    cachedToken = null;
    tokenCacheTime = 0;
}

function getToken(): string | null {
    const now = Math.floor(Date.now() / 1000);

    // Return cached token if still valid
    if (cachedToken && (now - tokenCacheTime) < TOKEN_CACHE_MAX_AGE) {
        return cachedToken;
    }

    // macOS: try Keychain first, fall back to credentials file
    // Linux/other: read from credentials file
    let token: string | null = null;
    if (process.platform === 'darwin')
        token = readTokenFromKeychain();
    if (!token)
        token = readTokenFromFile();

    if (token) {
        cachedToken = token;
        tokenCacheTime = now;
    }
    return token;
}

function readStaleCache(): ApiData | null {
    try {
        const data: ApiData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        // Discard stale cache after STALE_MAX_AGE to prevent serving outdated data forever
        if (data.fetchedAt) {
            const age = Math.floor(Date.now() / 1000) - data.fetchedAt;
            if (age > STALE_MAX_AGE)
                return null;
        } else {
            // Legacy cache without fetchedAt: check file mtime instead
            const stat = fs.statSync(CACHE_FILE);
            const age = Math.floor(Date.now() / 1000) - Math.floor(stat.mtimeMs / 1000);
            if (age > STALE_MAX_AGE)
                return null;
        }
        return data;
    } catch {
        return null;
    }
}

// Fetch result: null = network/other error, 'auth-error' = 401, 'rate-limited' = 429, string = response body
type FetchResult = string | 'auth-error' | 'rate-limited' | null;

// Fetch API using Node's built-in https module (no curl dependency)
function fetchFromApi(token: string): FetchResult {
    // Use Node to make HTTPS request synchronously via spawnSync
    // Exit code 2 = auth error (401), exit code 1 = other error
    const script = `
        const https = require('https');
        const options = {
            hostname: 'api.anthropic.com',
            path: '/api/oauth/usage',
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + process.env.TOKEN,
                'anthropic-beta': 'oauth-2025-04-20'
            },
            timeout: 5000
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    process.stdout.write(data);
                } else if (res.statusCode === 401) {
                    process.exit(2);
                } else if (res.statusCode === 429) {
                    process.exit(3);
                } else {
                    process.exit(1);
                }
            });
        });
        req.on('error', () => process.exit(1));
        req.on('timeout', () => { req.destroy(); process.exit(1); });
        req.end();
    `;

    const result = spawnSync('node', ['-e', script], {
        encoding: 'utf8',
        timeout: 6000,
        env: { ...process.env, TOKEN: token }
    });

    if (result.error || !result.stdout) {
        if (result.status === 2)
            return 'auth-error';
        if (result.status === 3)
            return 'rate-limited';
        return null;
    }
    if (result.status !== 0) {
        if (result.status === 2)
            return 'auth-error';
        if (result.status === 3)
            return 'rate-limited';
        return null;
    }

    return result.stdout;
}

function fetchApiData(): ApiData {
    const now = Math.floor(Date.now() / 1000);

    // Check memory cache (fast path)
    if (cachedData && !cachedData.error && (now - cacheTime) < CACHE_MAX_AGE) {
        return cachedData;
    }

    // Check file cache
    try {
        const stat = fs.statSync(CACHE_FILE);
        const fileAge = now - Math.floor(stat.mtimeMs / 1000);
        if (fileAge < CACHE_MAX_AGE) {
            const fileData: ApiData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            if (!fileData.error) {
                cachedData = fileData;
                cacheTime = now;
                return fileData;
            }
        }
    } catch {
        // File doesn't exist or read error - continue to API call
    }

    // Rate limit: only try API once per 30 seconds
    try {
        const lockStat = fs.statSync(LOCK_FILE);
        const lockAge = now - Math.floor(lockStat.mtimeMs / 1000);
        if (lockAge < LOCK_MAX_AGE) {
            // Rate limited - return stale cache or timeout error
            const stale = readStaleCache();
            if (stale && !stale.error)
                return stale;
            return { error: 'timeout' };
        }
    } catch {
        // Lock file doesn't exist - OK to proceed
    }

    // Touch lock file
    try {
        const lockDir = path.dirname(LOCK_FILE);
        if (!fs.existsSync(lockDir)) {
            fs.mkdirSync(lockDir, { recursive: true });
        }
        fs.writeFileSync(LOCK_FILE, '');
    } catch {
        // Ignore lock file errors
    }

    // If stale cache is gone (expired), also invalidate token cache to force re-read
    const staleBeforeFetch = readStaleCache();
    if (!staleBeforeFetch) {
        invalidateTokenCache();
    }

    // Get token
    const token = getToken();
    if (!token) {
        const stale = readStaleCache();
        if (stale && !stale.error)
            return stale;
        return { error: 'no-credentials' };
    }

    // Fetch from API using Node's https module
    try {
        const response = fetchFromApi(token);

        // On auth error, invalidate cached token so next call re-reads from disk
        if (response === 'auth-error') {
            invalidateTokenCache();
            const stale = readStaleCache();
            if (stale && !stale.error)
                return stale;
            return { error: 'api-error' };
        }

        // On rate limit (429), extend lock to back off properly
        if (response === 'rate-limited') {
            try {
                const futureTime = new Date(Date.now() + 90_000);
                fs.utimesSync(LOCK_FILE, futureTime, futureTime);
            } catch {
                // Ignore
            }
            const stale = readStaleCache();
            if (stale && !stale.error)
                return stale;
            return { error: 'timeout' };
        }

        if (!response) {
            const stale = readStaleCache();
            if (stale && !stale.error)
                return stale;
            return { error: 'api-error' };
        }

        const data = JSON.parse(response);

        // Extract utilization data
        const apiData: ApiData = {};
        if (data.five_hour) {
            apiData.sessionUsage = data.five_hour.utilization;
            apiData.sessionResetAt = data.five_hour.resets_at;
        }
        if (data.seven_day) {
            apiData.weeklyUsage = data.seven_day.utilization;
        }
        if (data.extra_usage) {
            apiData.extraUsageEnabled = data.extra_usage.is_enabled === true;
            apiData.extraUsageLimit = data.extra_usage.monthly_limit;
            apiData.extraUsageUsed = data.extra_usage.used_credits;
            apiData.extraUsageUtilization = data.extra_usage.utilization;
        }

        // Validate we got actual data
        if (apiData.sessionUsage === undefined && apiData.weeklyUsage === undefined) {
            const stale = readStaleCache();
            if (stale && !stale.error)
                return stale;
            return { error: 'parse-error' };
        }

        // Save to cache with fetch timestamp
        apiData.fetchedAt = now;
        try {
            const cacheDir = path.dirname(CACHE_FILE);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            fs.writeFileSync(CACHE_FILE, JSON.stringify(apiData));
        } catch {
            // Ignore cache write errors
        }

        cachedData = apiData;
        cacheTime = now;
        return apiData;
    } catch {
        const stale = readStaleCache();
        if (stale && !stale.error)
            return stale;
        return { error: 'parse-error' };
    }
}

function getErrorMessage(error: ApiError): string {
    switch (error) {
    case 'no-credentials': return '[No credentials]';
    case 'timeout': return '[Timeout]';
    case 'api-error': return '[API Error]';
    case 'parse-error': return '[Parse Error]';
    }
}

const MOBILE_THRESHOLD = 80;
const MOBILE_BAR_WIDTH = 4;
const DEFAULT_BAR_WIDTH = 15;

function isMobileWidth(context: RenderContext): boolean {
    return (context.terminalWidth ?? 0) > 0 && (context.terminalWidth ?? 0) < MOBILE_THRESHOLD;
}

function makeProgressBar(percent: number, width = DEFAULT_BAR_WIDTH): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

function formatUsageBar(label: string, shortLabel: string, percent: number, mobile: boolean): string {
    const bar = makeProgressBar(percent, mobile ? MOBILE_BAR_WIDTH : DEFAULT_BAR_WIDTH);
    return `${mobile ? shortLabel : label}: ${bar} ${percent.toFixed(1)}%`;
}

// Session Usage Widget
export class SessionUsageWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows daily/session API usage percentage'; }
    getDisplayName(): string { return 'Session Usage'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview)
            return 'Session: [███░░░░░░░░░░░░] 20%';

        const data = fetchApiData();
        if (data.error)
            return getErrorMessage(data.error);
        if (data.sessionUsage === undefined)
            return null;

        return formatUsageBar('Session', 'S', data.sessionUsage, isMobileWidth(context));
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(item: WidgetItem): boolean { return true; }
}

// Weekly Usage Widget
export class WeeklyUsageWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows weekly API usage percentage'; }
    getDisplayName(): string { return 'Weekly Usage'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview)
            return 'Weekly: [██░░░░░░░░░░░░░] 12%';

        const data = fetchApiData();
        if (data.error)
            return getErrorMessage(data.error);
        if (data.weeklyUsage === undefined)
            return null;

        return formatUsageBar('Weekly', 'W', data.weeklyUsage, isMobileWidth(context));
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(item: WidgetItem): boolean { return true; }
}

// Reset Timer Widget — shows extra usage spending when weekly limit is reached, otherwise reset timer
export class ResetTimerWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows extra usage spending or time until limit reset'; }
    getDisplayName(): string { return 'Reset Timer'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview)
            return '4:30 hr';

        const data = fetchApiData();
        if (data.error)
            return getErrorMessage(data.error);

        // When extra usage is active AND weekly limit is reached (100%), show spending instead of reset timer
        if (data.extraUsageEnabled && data.weeklyUsage !== undefined && data.weeklyUsage >= 100
            && data.extraUsageUsed !== undefined && data.extraUsageLimit !== undefined) {
            const used = formatCents(data.extraUsageUsed);
            const displayLimit = settings.extraUsageBalance ?? data.extraUsageLimit;
            const limit = formatCents(displayLimit);
            return `Extra: ${used}/${limit}`;
        }

        if (!data.sessionResetAt)
            return null;

        try {
            const resetTime = new Date(data.sessionResetAt).getTime();
            const now = Date.now();
            const diffMs = resetTime - now;

            if (diffMs <= 0)
                return '0:00 hr';

            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            return `${hours}:${minutes.toString().padStart(2, '0')} hr`;
        } catch {
            return null;
        }
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(item: WidgetItem): boolean { return true; }
}

function getCurrencySymbol(): string {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz.startsWith('Europe/'))
            return '€';
    } catch {
        // Fall through to default
    }
    return '$';
}

function formatCents(cents: number): string {
    const symbol = getCurrencySymbol();
    return `${symbol}${(cents / 100).toFixed(2)}`;
}

// Context Bar Widget (enhanced context display)
export class ContextBarWidget implements Widget {
    getDefaultColor(): string { return 'blue'; }
    getDescription(): string { return 'Shows context usage as a progress bar'; }
    getDisplayName(): string { return 'Context Bar'; }
    getCategory(): string { return 'API Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview)
            return 'Context: [████░░░░░░░░░░░] 50k/200k (25%)';

        const cw = context.data?.context_window;
        if (!cw)
            return null;

        const total = Number(cw.context_window_size) || 200000;

        // current_usage can be a number or an object with token breakdown
        let used = 0;
        if (typeof cw.current_usage === 'number') {
            used = cw.current_usage;
        } else if (cw.current_usage && typeof cw.current_usage === 'object') {
            const u = cw.current_usage;
            used = (Number(u.input_tokens) || 0)
                + (Number(u.output_tokens) || 0)
                + (Number(u.cache_creation_input_tokens) || 0)
                + (Number(u.cache_read_input_tokens) || 0);
        }

        if (isNaN(total) || isNaN(used))
            return null;

        const percent = total > 0 ? (used / total) * 100 : 0;

        const usedK = Math.round(used / 1000);
        const totalK = Math.round(total / 1000);

        const mobile = isMobileWidth(context);
        const bar = makeProgressBar(percent, mobile ? MOBILE_BAR_WIDTH : DEFAULT_BAR_WIDTH);
        const label = mobile ? 'C' : 'Context';
        const suffix = mobile ? '' : ` (${Math.round(percent)}%)`;
        return `${label}: ${bar} ${usedK}k/${totalK}k${suffix}`;
    }

    supportsRawValue(): boolean { return false; }
    supportsColors(item: WidgetItem): boolean { return true; }
}