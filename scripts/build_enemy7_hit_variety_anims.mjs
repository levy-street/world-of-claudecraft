// Build a second hit-reaction clip for the ENEMY7 family (issue #2889):
// visual.ts's playHit() picks randomly from ClipMap.hit, but ENEMY7
// (src/render/characters/manifest.ts, shared by mob_kobold/mob_ogre) ships
// only the very short HitRecieve (0.208s), so the randomness is dead code.
// goblin.glb/giant.glb ship no unused bonus donor clips beyond a short Jump
// (0.25s, a hop, not a stagger, and not part of ENEMY7's ClipMap fields),
// so HitRecieve_Heavy is synthesized purely by RE-TIMING the SAME Idle/
// HitRecieve donors already in use: a fast snap into the recoil, then a
// held stunned pause far longer than the base 0.208s clip, then a slow
// recovery. No Blender: same technique as scripts/build_elemental_anims.mjs.
//
// Both source rigs (goblin.glb, giant.glb) ship byte-identical Idle/
// HitRecieve channel-key sets AND identical durations (Idle 3.333s,
// HitRecieve 0.208s, verified), so one shared set of sample timestamps,
// applied to both sources via one parameterized script, is correct.
//
// Usage: node scripts/build_enemy7_hit_variety_anims.mjs [--preview]
// Output (production): one <basename>_hit_variety_anims.glb per source,
// alongside the source (0 meshes/skins, 1 clip: HitRecieve_Heavy).
// Output (--preview): tmp/goblin_hit_variety_preview.glb only (the
// representative rig; both sources share identical timestamps, verified
// above, so one visual check stands for the family).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  mergePoses,
  poseValue,
  pushPoseRamp,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PREVIEW = process.argv.includes('--preview');

const SOURCES = [
  { src: 'creatures/goblin.glb', out: 'creatures/goblin_hit_variety_anims.glb' },
  { src: 'creatures/giant.glb', out: 'creatures/giant_hit_variety_anims.glb' },
];

const io = createGlbIO();

async function bakeOne({ src, out }, writePreview) {
  const doc = await io.read(resolve(ROOT, 'public/models', src));
  const root = doc.getRoot();

  const idleIdx = indexClip(root, 'Idle');
  const hitIdx = indexClip(root, 'HitRecieve');
  const allKeys = new Set([...idleIdx.keys(), ...hitIdx.keys()]);
  const donorFor = (key) => hitIdx.get(key) ?? idleIdx.get(key);

  // Donor poses, sampled within each clip's real duration (Idle 3.333s,
  // HitRecieve 0.208s, identical on both sources, verified).
  const P_idle = samplePose(idleIdx, 0.5);
  const P_hitPeak = samplePose(hitIdx, 0.15); // near the tail of the short clip, fullest recoil
  const P_all = mergePoses(P_idle, P_hitPeak);

  const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(timeline, {
    fromTime: 0,
    toTime: 0.12,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_hitPeak,
    fallback: P_all,
  });
  timeline.push([0.55, (k) => poseValue(P_hitPeak, k, P_all)]); // stunned hold, far longer than the 0.208s base
  pushPoseRamp(timeline, {
    fromTime: 0.55,
    toTime: 0.9,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_hitPeak,
    toPose: P_idle,
    fallback: P_all,
  });

  const { animation } = bakeClip(doc, {
    clipName: 'HitRecieve_Heavy',
    channelKeys: allKeys,
    timeline,
    donorFor,
  });

  if (writePreview) {
    const previewOut = resolve(ROOT, 'tmp/goblin_hit_variety_preview.glb');
    await io.write(previewOut, doc);
    console.log(`wrote preview (mesh + skin + clip): ${previewOut}`);
    return;
  }

  stripToAnimationsOnly(doc, [animation]);
  await doc.transform(prune(), dedup());
  const outPath = resolve(ROOT, 'public/models', out);
  await io.write(outPath, doc);
  console.log(`wrote ${outPath}`);
}

if (PREVIEW) {
  await bakeOne(SOURCES[0], true);
} else {
  for (const entry of SOURCES) await bakeOne(entry, false);
}
