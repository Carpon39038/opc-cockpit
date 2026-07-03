// 开发模式：同时启动 API server（tsx watch）和 Vite dev server
// API 跑在 5177，避开常驻正式服的 5175；Vite（5173）经代理转发到 5177
import { spawn } from 'node:child_process';

const DEV_API_PORT = process.env.DEV_API_PORT || '5177';

const procs = [
  spawn('npx', ['tsx', 'watch', 'src/server/index.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: DEV_API_PORT },
  }),
  spawn('npx', ['vite'], {
    stdio: 'inherit',
    env: { ...process.env, DEV_API_PORT },
  }),
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
