// Run a TypeScript script through Vite's own module loader, for scripts that
// import editor code reading import.meta.env (plain tsx leaves it undefined).
//
//   node scripts/vite_ssr_run.mjs <script.ts> [args...]
//
// The script sees its own args as process.argv after its path.

import path from 'node:path';
import { createServer } from 'vite';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/vite_ssr_run.mjs <script.ts> [args...]');
  process.exit(2);
}
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
try {
  await server.ssrLoadModule(path.resolve(target));
} finally {
  await server.close();
}
