// Bundles the Discord bot for Node (mirrors scripts/build_server.mjs). The bot
// imports the shared pure tier ladder from src/sim, so esbuild inlines it; ws's
// optional native deps stay external.
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['bot/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['bufferutil', 'utf-8-validate'],
  outfile: 'dist-bot/bot.cjs',
});

console.log('[build:bot] bundled bot -> dist-bot/bot.cjs');
