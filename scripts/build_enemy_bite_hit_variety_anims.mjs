// Build a second hit-reaction clip for the ENEMY_BITE family (issue #2889):
// visual.ts's playHit() picks randomly from ClipMap.hit, but ENEMY_BITE
// (src/render/characters/manifest.ts, shared by mob_crab/mob_treant) ships
// only HitRecieve, so the randomness is dead code. Authors
// HitRecieve_Dazed by pose-sample-and-blend (scripts/anim/pose_blend.mjs)
// off each rig's own HitRecieve recoil blended into a brief wobble sampled
// from the unused Dance clip, reading as a dazed stagger. No Blender: same
// technique as scripts/build_elemental_anims.mjs.
//
// crabenemy.glb and yeti.glb are CONFIRMED DIFFERENT rigs (investigated: no
// shared channel-key set beyond Body|rotation/Body|translation; crabenemy's
// HitRecieve also animates Eyebrow.L/R, yeti's animates Head/Head3) with
// DIFFERENT real clip durations (crabenemy HitRecieve 0.375s / Dance
// 0.833s / Idle 2.500s; yeti HitRecieve 0.292s / Dance 0.667s / Idle
// 2.000s), so this bakes two INDEPENDENT donor files with per-source sample
// timestamps chosen within each file's own real durations, not one shared
// timeline applied to both.
//
// Usage: node scripts/build_enemy_bite_hit_variety_anims.mjs [--preview]
// Output (production): one <basename>_hit_variety_anims.glb per source,
// alongside the source (0 meshes/skins, 1 clip: HitRecieve_Dazed).
// Output (--preview): tmp/crabenemy_hit_variety_preview.glb AND
// tmp/yeti_hit_variety_preview.glb (both, since the two rigs are
// genuinely different and each needs its own visual check).
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

// Per-source sample timestamps, each within that source's OWN real clip
// duration (crabenemy.glb: HitRecieve 0.375s, Dance 0.833s, Idle 2.500s;
// yeti.glb: HitRecieve 0.292s, Dance 0.667s, Idle 2.000s; verified, and NOT
// interchangeable between the two rigs).
const SOURCES = [
  {
    src: 'creatures/crabenemy.glb',
    out: 'creatures/crabenemy_hit_variety_anims.glb',
    previewOut: 'tmp/crabenemy_hit_variety_preview.glb',
    idleT: 0.3,
    hitT: 0.22,
    danceT: 0.4,
    ramp1End: 0.12,
    ramp2End: 0.35,
    holdEnd: 0.5,
    settleEnd: 0.85,
  },
  {
    src: 'creatures/yeti.glb',
    out: 'creatures/yeti_hit_variety_anims.glb',
    previewOut: 'tmp/yeti_hit_variety_preview.glb',
    idleT: 0.25,
    hitT: 0.17,
    danceT: 0.32,
    ramp1End: 0.1,
    ramp2End: 0.3,
    holdEnd: 0.42,
    settleEnd: 0.7,
  },
];

const io = createGlbIO();

async function bakeOne(cfg, writePreview) {
  const doc = await io.read(resolve(ROOT, 'public/models', cfg.src));
  const root = doc.getRoot();

  const idleIdx = indexClip(root, 'Idle');
  const hitIdx = indexClip(root, 'HitRecieve');
  const danceIdx = indexClip(root, 'Dance');
  const allKeys = new Set([...idleIdx.keys(), ...hitIdx.keys(), ...danceIdx.keys()]);
  const donorFor = (key) => hitIdx.get(key) ?? danceIdx.get(key) ?? idleIdx.get(key);

  const P_idle = samplePose(idleIdx, cfg.idleT);
  const P_hitPeak = samplePose(hitIdx, cfg.hitT); // HitRecieve's own recoil
  const P_wobble = samplePose(danceIdx, cfg.danceT); // a mid-Dance wobble pose
  const P_all = mergePoses(P_idle, P_hitPeak, P_wobble);

  const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(timeline, {
    fromTime: 0,
    toTime: cfg.ramp1End,
    steps: 2,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_hitPeak,
    fallback: P_all,
  });
  pushPoseRamp(timeline, {
    fromTime: cfg.ramp1End,
    toTime: cfg.ramp2End,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_hitPeak,
    toPose: P_wobble,
    fallback: P_all,
  });
  timeline.push([cfg.holdEnd, (k) => poseValue(P_wobble, k, P_all)]); // brief dazed wobble hold
  pushPoseRamp(timeline, {
    fromTime: cfg.holdEnd,
    toTime: cfg.settleEnd,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_wobble,
    toPose: P_idle,
    fallback: P_all,
  });

  const { animation } = bakeClip(doc, {
    clipName: 'HitRecieve_Dazed',
    channelKeys: allKeys,
    timeline,
    donorFor,
  });

  if (writePreview) {
    const previewOut = resolve(ROOT, cfg.previewOut);
    await io.write(previewOut, doc);
    console.log(`wrote preview (mesh + skin + clip): ${previewOut}`);
    return;
  }

  stripToAnimationsOnly(doc, [animation]);
  await doc.transform(prune(), dedup());
  const outPath = resolve(ROOT, 'public/models', cfg.out);
  await io.write(outPath, doc);
  console.log(`wrote ${outPath}`);
}

if (PREVIEW) {
  // Both rigs need their own preview: they are genuinely different
  // skeletons (crab vs furry biped), not shared timestamps on one rig.
  for (const cfg of SOURCES) await bakeOne(cfg, true);
} else {
  for (const cfg of SOURCES) await bakeOne(cfg, false);
}
