import { spawn, spawnSync } from 'node:child_process';
const run = (file, args) => spawn(process.execPath, [file, ...args], { stdio: 'inherit' });
const tsc = 'node_modules/typescript/bin/tsc';
const build = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.server.json'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const children = [run(tsc, ['-p', 'tsconfig.server.json', '--watch']), spawn(process.execPath, ['--watch', 'dist/server/src/main.js'], { stdio: 'inherit' }), run('node_modules/vite/bin/vite.js', ['--config', 'client/vite.config.ts'])];
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { children.forEach(x => x.kill()); process.exit(); });
