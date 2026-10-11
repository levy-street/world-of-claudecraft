// Merge the per-clip GLBs the Blender scripts beside this file write into one
// shipped, game-named model, with the asset pipeline's own assemble step
// (resample, prune, dedup, webp).
//
//   node scripts/assets/hoard_bosses/assemble.mjs maw <dir of maw_<clip>.glb> <out.glb>
//   node scripts/assets/hoard_bosses/assemble.mjs frost <dir of fixed presets> <out.glb>
import { assembleRiggedModel, checkInPlace } from '../../asset_pipeline/lib/glb.mjs';

const PLANS = {
  maw: ['Idle', 'Walk', 'Run', 'Attack', 'Cast', 'Hit', 'Death'].map((game) => ({
    file: `maw_${game.toLowerCase()}.glb`,
    game,
  })),
  frost: [
    ['idle', 'Idle'],
    ['walk', 'Walk'],
    ['run', 'Run'],
    ['slash', 'Attack'],
    ['hit_to_body_01', 'Hit'],
    ['defeat_02', 'Death'],
    ['cast_a_spell', 'Cast'],
    ['jump', 'Jump'],
  ]
    .map(([preset, game]) => ({ file: `anim_preset_biped_${preset}.glb`, game }))
    // Authored whole by frost_fix.py --author: the Ice Age channel, its blast, and
    // the Whiteout Gust frontal.
    .concat([
      { file: 'authored_iceage.glb', game: 'IceAge' },
      { file: 'authored_release.glb', game: 'IceAgeRelease' },
      { file: 'authored_frontal.glb', game: 'FrostFrontal' },
    ]),
};

const [which, dir, out] = process.argv.slice(2);
const plan = PLANS[which];
if (!plan || !dir || !out) throw new Error('usage: assemble.mjs <maw|frost> <dir> <out.glb>');
const clips = plan.map(({ file, game }) => ({ path: `${dir}/${file}`, preset: game, game }));
const result = await assembleRiggedModel(clips[0].path, clips, out);
for (const a of result.added) {
  console.log(a.game, a.ok ? `ok (${a.channels} channels)` : `FAILED ${a.reason}`);
}
console.log('in-place offenders:', JSON.stringify(await checkInPlace(out)));
