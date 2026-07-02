import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server.js',
});

await build({
  ...common,
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
});
