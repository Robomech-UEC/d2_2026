import { spawnSync } from 'node:child_process';
for (const [file, ...args] of [
  ['node_modules/typescript/bin/tsc', '-p', 'client/tsconfig.json'],
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'],
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'client/vite.config.ts'],
]) {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
