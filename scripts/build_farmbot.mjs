// Bundles the farm bot and its launcher for Node (mirrors
// scripts/build_bot.mjs, with the server build's alias idiom). ClientWorld was
// written for a browser: the @capacitor imports are aliased to
// farmbot/capacitor_stub.ts, and every import.meta.env.* the reachable graph
// reads at module scope (src/client_origin.ts, src/runtime.ts) is defined to
// an inert value. ws's optional native deps stay external, as in the other
// builds. The launcher bundle (launcher.cjs) resolves farmbot.cjs relative to
// itself, so both must land in the same dist-farmbot/ directory.
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const capacitorStub = fileURLToPath(new URL('../farmbot/capacitor_stub.ts', import.meta.url));

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['bufferutil', 'utf-8-validate'],
  alias: {
    '@capacitor/app': capacitorStub,
    '@capacitor/core': capacitorStub,
  },
  define: {
    'import.meta.env.VITE_NATIVE_APP': '""',
    'import.meta.env.VITE_API_ORIGIN': '""',
    'import.meta.env.VITE_DESKTOP_APP': '""',
    'import.meta.env.VITE_DESKTOP_API_ORIGIN': '""',
    'import.meta.env.VITE_DESKTOP_RELATIVE_API': '""',
    'import.meta.env.VITE_DISCORD_DISABLED': '""',
    'import.meta.env.VITE_REOWN_PROJECT_ID': '""',
    'import.meta.env.VITE_TURNSTILE_SITEKEY': '""',
    'import.meta.env.VITE_WALLET_DISABLED': '""',
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.BASE_URL': '""',
  },
};

await esbuild.build({
  ...shared,
  entryPoints: ['farmbot/main.ts'],
  outfile: 'dist-farmbot/farmbot.cjs',
});

await esbuild.build({
  ...shared,
  entryPoints: ['farmbot/launcher.ts'],
  outfile: 'dist-farmbot/launcher.cjs',
});

console.log('[build:farmbot] bundled farmbot + launcher -> dist-farmbot/');
