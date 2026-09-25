#!/usr/bin/env bun

// Regenerates config/default-settings.json from DEFAULT_SETTINGS so a user
// config can be a permanent symlink to the built-in defaults:
//   ln -sf "$PWD/config/default-settings.json" ~/.config/ccstatusline/settings.json
// Runs on every build; a test fails when the committed file is stale.

import {
    mkdirSync,
    writeFileSync
} from 'fs';
import { join } from 'path';

import { DEFAULT_SETTINGS } from '../src/types/Settings';

const outPath = join('config', 'default-settings.json');
mkdirSync('config', { recursive: true });
writeFileSync(outPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
console.log(`Wrote ${outPath}`);
