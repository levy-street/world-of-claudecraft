// Build a second hit-reaction clip for the BIPED14 family (issue #2889):
// visual.ts's playHit() picks randomly from ClipMap.hit, but BIPED14
// (src/render/characters/manifest.ts, shared by mob_bear/mob_yeti/
// mob_murloc/mob_troll/mob_demon/mob_demonalt) ships only HitReact, so the
// randomness is dead code. Authors HitReact_Heavy by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off each rig's own donor poses: HitReact's
// own recoil, blended into a crouch sampled from the unused Duck clip, then
// back to Idle. Reads as a heavier stagger than the quick 0.583s HitReact.
// No Blender: same technique as scripts/build_elemental_anims.mjs.
//
// All 4 source rigs (yetialt.glb, frog.glb, orc.glb, demonalt.glb) ship the
// identical 14-clip vocabulary at identical durations (verified); HitReact/
// Duck's channel-key sets differ only by two extra Shoulder.L/R channels on
// demonalt.glb/orc.glb (a superset, not an incompatibility, since every
// channel on yetialt.glb/frog.glb is present under the identical name on
// the other two), so one script parameterized by source path, run once per
// file, is safe for the whole family.
//
// Usage: node scripts/build_biped14_hit_variety_anims.mjs [--preview]
// Output (production): one <basename>_hit_variety_anims.glb per source,
// alongside the source (0 meshes/skins, 1 clip: HitReact_Heavy).
// Output (--preview): tmp/yetialt_hit_variety_preview.glb only (the
// representative rig; every source shares the identical timestamps,
// verified above, so one visual check stands for the family).
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
  { src: 'creatures/yetialt.glb', out: 'creatures/yetialt_hit_variety_anims.glb' },
  { src: 'creatures/frog.glb', out: 'creatures/frog_hit_variety_anims.glb' },
  { src: 'creatures/orc.glb', out: 'creatures/orc_hit_variety_anims.glb' },
  { src: 'creatures/demonalt.glb', out: 'creatures/demonalt_hit_variety_anims.glb' },
];

const io = createGlbIO();

async function bakeOne({ src, out }, writePreview) {
  const doc = await io.read(resolve(ROOT, 'public/models', src));
  const root = doc.getRoot();

  const idleIdx = indexClip(root, 'Idle');
  const hitIdx = indexClip(root, 'HitReact');
  const duckIdx = indexClip(root, 'Duck');
  const allKeys = new Set([...idleIdx.keys(), ...hitIdx.keys(), ...duckIdx.keys()]);
  const donorFor = (key) => hitIdx.get(key) ?? duckIdx.get(key) ?? idleIdx.get(key);

  // Donor poses, sampled within each clip's real duration (Idle 1.000s,
  // HitReact 0.583s, Duck 1.667s, identical across all 4 sources, verified).
  const P_idle = samplePose(idleIdx, 0.3);
  const P_recoil = samplePose(hitIdx, 0.25); // HitReact's own impact recoil
  const P_duck = samplePose(duckIdx, 0.5); // a mid-crouch pose, distinct flinch
  const P_all = mergePoses(P_idle, P_recoil, P_duck);

  const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(timeline, {
    fromTime: 0,
    toTime: 0.15,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_recoil,
    fallback: P_all,
  });
  pushPoseRamp(timeline, {
    fromTime: 0.15,
    toTime: 0.45,
    steps: 4,
    ease: easeInOutQuad,
    fromPose: P_recoil,
    toPose: P_duck,
    fallback: P_all,
  });
  timeline.push([0.65, (k) => poseValue(P_duck, k, P_all)]); // held sink, heavier than the base flinch
  pushPoseRamp(timeline, {
    fromTime: 0.65,
    toTime: 0.95,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_duck,
    toPose: P_idle,
    fallback: P_all,
  });

  const { animation } = bakeClip(doc, {
    clipName: 'HitReact_Heavy',
    channelKeys: allKeys,
    timeline,
    donorFor,
  });

  if (writePreview) {
    const previewOut = resolve(ROOT, 'tmp/yetialt_hit_variety_preview.glb');
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
