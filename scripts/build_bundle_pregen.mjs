// Runs build:bundle's independent pregen steps concurrently instead of
// serially: the sitemap regeneration, the SFX manifest/runtime pack build,
// and the media manifest generation. Each step reads and writes its own
// disjoint set of files, so there is no shared input/output between them:
//   - build_sitemap.mjs: reads public/sitemap.xml + the guide route tables,
//     writes public/sitemap.xml.
//   - build_sfx_manifest.mjs: reads scripts/sfx/sfx_mix.json + public/audio/sfx,
//     writes src/game/sfx_manifest.generated.ts, public/audio/sfx/runtime-pack.json,
//     and the SFX gain ceilings file.
//   - build_media_manifest.mjs generate: reads public/{models,textures,env,vfx},
//     writes src/render/assets/manifest.generated.ts.
// All three must still finish before `vite build` runs (some of them feed
// generated sources the client bundle imports), so this orchestrator is the
// one thing build:bundle awaits before that step; it changes nothing after
// vite build.
//
// Usage: node scripts/build_bundle_pregen.mjs

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Node args for each pregen step, run relative to the repo root. */
export const PREGEN_STEPS = [
  ['scripts/build_sitemap.mjs'],
  ['scripts/build_sfx_manifest.mjs'],
  ['scripts/build_media_manifest.mjs', 'generate'],
];

/**
 * Spawn one pregen step and resolve with its captured stdout/stderr, or
 * reject with a descriptive error if it fails to spawn or exits non-zero.
 */
export function runPregenStep(args, execPath = process.execPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(new Error(`${args.join(' ')} failed to spawn: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${args.join(' ')} exited with code ${code}\n${stderr}`));
    });
  });
}

/**
 * Run every step concurrently via Promise.all, then replay each step's
 * captured output in step order (deterministic regardless of finish order).
 * Any step failing to spawn or exiting non-zero rejects the whole call.
 */
export async function runPregen(steps = PREGEN_STEPS) {
  const results = await Promise.all(steps.map((args) => runPregenStep(args)));
  for (const { stdout, stderr } of results) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    await runPregen();
  } catch (error) {
    console.error(`build_bundle_pregen: ${error.message}`);
    process.exit(1);
  }
}
