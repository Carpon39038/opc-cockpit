// 开发模式：同时启动 API server（tsx watch）和 Vite dev server
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', 'src/server/index.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];

function shutdown() {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
for (const p of procs) {
  p.on('exit', (code) => {
    if (code !== null && code !== 0) shutdown();
  });
}
