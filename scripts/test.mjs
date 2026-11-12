import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync(new URL('../dist/tests/', import.meta.url)).filter(x => x.endsWith('.test.js'));
const result = spawnSync(process.execPath, ['--test', ...files.map(x => `dist/tests/${x}`)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
