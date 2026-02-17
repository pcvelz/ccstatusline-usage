import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Mobile terminal detection threshold (columns)
const MOBILE_THRESHOLD = 80;

export interface TmuxClient {
    width: number;
    height: number;
    tty: string;
}

export interface TerminalEnvironment {
    inTmux: boolean;
    tmuxClients: TmuxClient[];
    terminalWidth: number | null;
    isMobile: boolean;
    smallestClientWidth: number | null;
}

// Get package version
// __PACKAGE_VERSION__ will be replaced at build time
const PACKAGE_VERSION = '__PACKAGE_VERSION__';

export function getPackageVersion(): string {
    // If we have the build-time replaced version, use it (check if it looks like a version)
    if (/^\d+\.\d+\.\d+/.test(PACKAGE_VERSION)) {
        return PACKAGE_VERSION;
    }

    // Fallback for development mode
    const possiblePaths = [
        path.join(__dirname, '..', '..', 'package.json'), // Development: dist/utils/ -> root
        path.join(__dirname, '..', 'package.json')       // Production: dist/ -> root (bundled)
    ];

    for (const packageJsonPath of possiblePaths) {
        try {
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
                return packageJson.version ?? '';
            }
        } catch {
            // Continue to next path
        }
    }

    return '';
}

// Get terminal width
export function getTerminalWidth(): number | null {
    try {
        // First try to get the tty of the parent process
        const tty = execSync('ps -o tty= -p $(ps -o ppid= -p $$)', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            shell: '/bin/sh'
        }).trim();

        // Check if we got a valid tty (not ?? which means no tty)
        if (tty && tty !== '??' && tty !== '?') {
            // Now get the terminal size
            const width = execSync(
                `stty size < /dev/${tty} | awk '{print $2}'`,
                {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore'],
                    shell: '/bin/sh'
                }
            ).trim();

            const parsed = parseInt(width, 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
    } catch {
        // Command failed, width detection not available
    }

    // Fallback: try tput cols which might work in some environments
    try {
        const width = execSync('tput cols 2>/dev/null', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();

        const parsed = parseInt(width, 10);
        if (!isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    } catch {
        // tput also failed
    }

    return null;
}

// Check if terminal width detection is available
export function canDetectTerminalWidth(): boolean {
    try {
        // First try to get the tty of the parent process
        const tty = execSync('ps -o tty= -p $(ps -o ppid= -p $$)', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            shell: '/bin/sh'
        }).trim();

        // Check if we got a valid tty
        if (tty && tty !== '??' && tty !== '?') {
            const width = execSync(
                `stty size < /dev/${tty} | awk '{print $2}'`,
                {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore'],
                    shell: '/bin/sh'
                }
            ).trim();

            const parsed = parseInt(width, 10);
            if (!isNaN(parsed) && parsed > 0) {
                return true;
            }
        }
    } catch {
        // Try fallback
    }

    // Fallback: try tput cols
    try {
        const width = execSync('tput cols 2>/dev/null', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();

        const parsed = parseInt(width, 10);
        return !isNaN(parsed) && parsed > 0;
    } catch {
        return false;
    }
}

// Parse tmux client list into structured data
function parseTmuxClients(): TmuxClient[] {
    try {
        const output = execSync(
            "tmux list-clients -F '#{client_width} #{client_height} #{client_tty}'",
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 }
        ).trim();

        if (!output) return [];

        const clients: TmuxClient[] = [];
        for (const line of output.split('\n')) {
            const parts = line.trim().split(' ');
            if (parts.length >= 3) {
                const width = parseInt(parts[0] ?? '', 10);
                const height = parseInt(parts[1] ?? '', 10);
                const tty = parts.slice(2).join(' ');
                if (!isNaN(width) && !isNaN(height) && tty) {
                    clients.push({ width, height, tty });
                }
            }
        }
        return clients;
    } catch {
        return [];
    }
}

// Get the actual tmux pane width (accounts for client constraints)
function getTmuxPaneWidth(): number | null {
    try {
        const output = execSync(
            "tmux display-message -p '#{pane_width}'",
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 }
        ).trim();
        const parsed = parseInt(output, 10);
        if (!isNaN(parsed) && parsed > 0)
            return parsed;
    } catch {
        // tmux command failed
    }
    return null;
}

// Detect terminal environment including tmux and mobile status
export function detectTerminalEnvironment(): TerminalEnvironment {
    const inTmux = Boolean(process.env.TMUX);
    let terminalWidth = getTerminalWidth();
    let smallestClientWidth: number | null = null;
    let tmuxClients: TmuxClient[] = [];

    if (inTmux) {
        // Use actual tmux pane width — more accurate than TTY-based detection
        const paneWidth = getTmuxPaneWidth();
        if (paneWidth !== null)
            terminalWidth = paneWidth;

        // Parse clients for debugging info and smallestClientWidth
        tmuxClients = parseTmuxClients();
        if (tmuxClients.length > 0)
            smallestClientWidth = Math.min(...tmuxClients.map(c => c.width));
    }

    // Determine mobile: pane width (already set from tmux if available) is the effective width
    const isMobile = terminalWidth !== null && terminalWidth < MOBILE_THRESHOLD;

    return {
        inTmux,
        tmuxClients,
        terminalWidth,
        isMobile,
        smallestClientWidth
    };
}