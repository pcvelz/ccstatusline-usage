import * as fs from 'fs';
import * as path from 'path';
import {
    describe,
    expect,
    it
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';

// config/default-settings.json is the symlink target for a config that should
// always follow the built-in defaults. It must never drift from Settings.ts.
describe('config/default-settings.json', () => {
    it('matches DEFAULT_SETTINGS (run bun run build to regenerate)', () => {
        const file = path.join(__dirname, '..', '..', '..', 'config', 'default-settings.json');
        expect(fs.readFileSync(file, 'utf-8')).toBe(JSON.stringify(DEFAULT_SETTINGS, null, 2));
    });
});
