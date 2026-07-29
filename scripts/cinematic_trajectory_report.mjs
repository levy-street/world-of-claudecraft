#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { reportScene } from './lib/cinematic_trajectory_report_core.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function usage() {
  return [
    'Usage:',
    '  node scripts/cinematic_trajectory_report.mjs <sceneId>',
    '  node scripts/cinematic_trajectory_report.mjs --scene <sceneId>',
    '  node scripts/cinematic_trajectory_report.mjs --all',
  ].join('\n');
}

function parseArgs(argv) {
  let all = false;
  let scene = null;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--scene') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) {
        throw new Error(`--scene requires a value.\n${usage()}`);
      }
      scene = value;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (!arg.startsWith('--') && scene === null) {
      scene = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  if (!help && all === (scene !== null)) {
    throw new Error(`Choose exactly one scene id or --all.\n${usage()}`);
  }
  return { all, help, scene };
}

async function loadRuntime() {
  const entrySource = `
    import './src/sim/content/last_bell_campaign.ts';
    export { sceneById, registeredSceneIds } from './src/sim/scenes/scenes.ts';
    export {
      evaluateSceneRigPose,
      sceneRigCameraPosition,
      sceneRigLocalToWorld,
    } from './src/game/scene_rig_core.ts';
    export { propPathPoseAt } from './src/render/prop_path_core.ts';
    export { composeHarborShipAttachFrame } from './src/render/harbor_ship_attach_core.ts';
    export { HARBORS, harborShipLocalBounds } from './src/sim/harbor_layout.ts';
    export { groundHeight, terrainHeight, WATER_LEVEL } from './src/sim/world.ts';
    export {
      LAST_BELL_PROP_PATH_SEGMENTS,
      LAST_BELL_VOYAGE_SEGMENT_IDS,
    } from './src/sim/content/last_bell_cinematics.ts';
  `;
  const built = await esbuild.build({
    stdin: {
      contents: entrySource,
      resolveDir: REPO_ROOT,
      sourcefile: 'cinematic-trajectory-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const bundled = built.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`;
  return import(dataUrl);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const runtime = await loadRuntime();
const registered = runtime.registeredSceneIds();
const ids = args.all ? registered : [args.scene];
console.log(
  'Legend: rect xz values are signed, so negative means above a footprint. Live deck is the walkable rectangle, hull is the measured GLB footprint, and ship distance is camera to live deck center for attach shots.',
);
for (const id of ids) {
  const scene = runtime.sceneById(id);
  if (!scene) {
    throw new Error(`Unknown scene id ${id}. Registered scenes: ${registered.join(', ')}`);
  }
  reportScene(runtime, scene);
}
