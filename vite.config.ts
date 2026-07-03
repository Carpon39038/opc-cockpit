import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发 API 跑在 5177，避开常驻正式服的 5175
      '/api': `http://localhost:${process.env.DEV_API_PORT || 5177}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
