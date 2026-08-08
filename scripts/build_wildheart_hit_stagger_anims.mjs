// Build a second hit-reaction clip for the Wildheart troll family (issue
// #2889): visual.ts's playHit() picks randomly from ClipMap.hit, but
// TRIPO_BIPED_FULL_RIG (src/render/characters/manifest.ts, shared by all 5
// mob_wildheart_* VisualDefs) ships only Hit, so the randomness is dead
// code. Unlike BIPED14/kaykit(), the 5 Wildheart rigs ship ZERO unused
// bonus donor clips (Idle/Walk/Run/Attack/Hit/Cast/Jump/Death is the
// complete list on every one, verified), so Hit_Stagger is synthesized
// purely by RE-TIMING the SAME Hit/Idle donors already in use: a slower,
// heavier blend through Hit's own early/peak/tail poses reads as a stumble
// next to the quick default Hit. No Blender: same technique as
// scripts/build_elemental_anims.mjs.
//
// All 5 source rigs (wildheart_stalker/ravager/hexcaller/beastmaster/
// high_priest.glb) ship byte-identical Hit/Idle channel-key sets and
// identical clip durations (Idle 15.375s, Hit 0.700s, verified), so one
// script parameterized by source path, run once per file, is safe for the
// whole family.
//
// A separate round-1 task (Area A) also touches these 5 GLBs, but only to
// add NEW named consts spreading TRIPO_BIPED_FULL_RIG for bespoke attacks;
// it never edits TRIPO_BIPED_FULL_RIG itself, so this task's base-const
// edit and that task's spreads land cleanly regardless of merge order.
//
// Usage: node scripts/build_wildheart_hit_stagger_anims.mjs [--preview]
// Output (production): one wildheart_<name>_hit_variety_anims.glb per
// source, alongside the source (0 meshes/skins, 1 clip: Hit_Stagger).
// Output (--preview): tmp/wildheart_stalker_hit_stagger_preview.glb only
// (the representative rig; every source shares the identical timestamps,
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
  {
    src: 'creatures/wildheart_stalker.glb',
    out: 'creatures/wildheart_stalker_hit_variety_anims.glb',
  },
  {
    src: 'creatures/wildheart_ravager.glb',
    out: 'creatures/wildheart_ravager_hit_variety_anims.glb',
  },
  {
    src: 'creatures/wildheart_hexcaller.glb',
    out: 'creatures/wildheart_hexcaller_hit_variety_anims.glb',
  },
  {
    src: 'creatures/wildheart_beastmaster.glb',
    out: 'creatures/wildheart_beastmaster_hit_variety_anims.glb',
  },
  {
    src: 'creatures/wildheart_high_priest.glb',
    out: 'creatures/wildheart_high_priest_hit_variety_anims.glb',
  },
];

const io = createGlbIO();

async function bakeOne({ src, out }, writePreview) {
  const doc = await io.read(resolve(ROOT, 'public/models', src));
  const root = doc.getRoot();

  const idleIdx = indexClip(root, 'Idle');
  const hitIdx = indexClip(root, 'Hit');
  const allKeys = new Set([...idleIdx.keys(), ...hitIdx.keys()]);
  const donorFor = (key) => hitIdx.get(key) ?? idleIdx.get(key);

  // Donor poses, sampled within each clip's real duration (Idle 15.375s:
  // sampled early to stay on a plain standing sub-pose within the long
  // loop; Hit 0.700s; identical across all 5 sources, verified).
  const P_idle = samplePose(idleIdx, 1.0);
  const P_hitEarly = samplePose(hitIdx, 0.15); // early impact onset
  const P_hitPeak = samplePose(hitIdx, 0.45); // deep reaction pose
  const P_hitTail = samplePose(hitIdx, 0.65); // Hit's own recovery lean
  const P_all = mergePoses(P_idle, P_hitEarly, P_hitPeak, P_hitTail);

  const timeline = [[0, (k) => poseValue(P_idle, k, P_all)]];
  pushPoseRamp(timeline, {
    fromTime: 0,
    toTime: 0.35,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_hitEarly,
    fallback: P_all,
  });
  pushPoseRamp(timeline, {
    fromTime: 0.35,
    toTime: 0.7,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_hitEarly,
    toPose: P_hitPeak,
    fallback: P_all,
  });
  timeline.push([0.95, (k) => poseValue(P_hitPeak, k, P_all)]); // stumble hold
  pushPoseRamp(timeline, {
    fromTime: 0.95,
    toTime: 1.2,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_hitPeak,
    toPose: P_hitTail,
    fallback: P_all,
  });
  pushPoseRamp(timeline, {
    fromTime: 1.2,
    toTime: 1.5,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_hitTail,
    toPose: P_idle,
    fallback: P_all,
  });

  const { animation } = bakeClip(doc, {
    clipName: 'Hit_Stagger',
    channelKeys: allKeys,
    timeline,
    donorFor,
  });

  if (writePreview) {
    const previewOut = resolve(ROOT, 'tmp/wildheart_stalker_hit_stagger_preview.glb');
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
