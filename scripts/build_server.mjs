// Bundles the authoritative server. The bot detector is resolved through the
// abstract `#bot-detector` specifier: the private implementation if its clone is
// present, otherwise the open-source no-op stub. Mirrors the resolution in
// vite.config.ts (vitest/dev) and tsconfig.json `paths` (typecheck).
import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const privateImpl = fileURLToPath(new URL('../private/bot_detector/src/index.ts', import.meta.url));
const stubImpl = fileURLToPath(new URL('../server/bot_detector/stub.ts', import.meta.url));
const usePrivate = existsSync(privateImpl);

await esbuild.build({
  entryPoints: ['server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  outfile: 'dist-server/server.cjs',
  alias: { '#bot-detector': usePrivate ? privateImpl : stubImpl },
});

console.log(`[build:server] bot detector: ${usePrivate ? 'private' : 'stub (no-op)'}`);
