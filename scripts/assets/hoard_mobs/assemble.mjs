// Merge the per-clip GLBs quadruped_rig.py writes into one shipped, game-named model,
// with the asset pipeline's own assemble step (resample, prune, dedup, webp).
//
//   node scripts/assets/hoard_mobs/assemble.mjs <key> <dir of <key>_<clip>.glb> <out.glb> [--extra A,B]
//
// --extra appends a spec's opt-in clips (a burrower's Burrow,Underground,Emerge).
import { assembleRiggedModel, checkInPlace } from '../../asset_pipeline/lib/glb.mjs';

const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Cast', 'Hit', 'Death'];
const argv = process.argv.slice(2);
const [key, dir, out] = argv;
if (!key || !dir || !out)
  throw new Error('usage: assemble.mjs <key> <dir> <out.glb> [--extra A,B]');
const extraAt = argv.indexOf('--extra');
if (extraAt >= 0) CLIPS.push(...argv[extraAt + 1].split(',').filter(Boolean));
const clips = CLIPS.map((game) => ({
  path: `${dir}/${key}_${game.toLowerCase()}.glb`,
  preset: game,
  game,
}));
const result = await assembleRiggedModel(clips[0].path, clips, out);
for (const a of result.added) {
  console.log(a.game, a.ok ? `ok (${a.channels} channels)` : `FAILED ${a.reason}`);
}
console.log('in-place offenders:', JSON.stringify(await checkInPlace(out)));
