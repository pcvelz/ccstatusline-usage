import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach } from 'vitest';

// Keeps widget renders in tests from reading or writing the real five-hour plan state,
// and starts every test from a cold one so no test inherits another's readings.
const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-test-')), 'five-hour-plan.json');
process.env.CCSTATUSLINE_FIVE_HOUR_PLAN_PATH = statePath;

beforeEach(() => {
    fs.rmSync(statePath, { force: true });
});
