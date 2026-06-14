import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  // Parent dir has a postcss.config.js with Tailwind — ignore it; this project has no CSS pipeline.
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/admin/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
      },
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
