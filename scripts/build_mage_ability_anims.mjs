// Build the mage's ability-specific spellcast clips (issue #2889: the class
// has zero attackByAbility overrides today, so every one of its 60 abilities
// plays the SAME melee chop, player_mage in src/render/characters/manifest.ts).
// This authors 5 distinct casts by pose-sample-and-blend (see scripts/anim/
// pose_blend.mjs, the technique behind the hunter's bow_anims.glb) off the
// spellcasting donor poses already baked into the shipped mage.glb, no
// Blender: Idle, Spellcast_Raise (2.1s: an early half-raise then a long
// sustained ready hold near the tail), Spellcasting (0.667s loop), and
// Spellcast_Shoot (0.933s: an early windup then the full release), plus
// 2H_Melee_Attack_Chop's committed downswing energy for Cast_Nova, since a
// nova's "slam and radiate outward" reads better with an impact donor than a
// pure spellcast pose ever will.
//
//   Cast_Fire      quick raise, decisive early release, snappy return
//   Cast_Frost     full raise, a held anticipation beat, crisp late release
//   Cast_Arcane    three rapid raise/release pulses (missile barrage)
//   Cast_Nova      both arms up then a big committed downward release
//                  (borrows 2H_Melee_Attack_Chop's impact energy)
//   Cast_Polymorph unhurried raise, a light flourish hold, an early gentle
//                  point instead of a full release (whimsical, not violent)
//
// Usage: node scripts/build_mage_ability_anims.mjs [--preview]
// Output: public/models/chars/players/mage_ability_anims.glb (0 meshes/skins,
// 5 clips: Cast_Fire, Cast_Frost, Cast_Arcane, Cast_Nova, Cast_Polymorph)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  createGlbIO,
  easeInOutQuad,
  easeOutCubic,
  indexClip,
  poseValue,
  pushPoseRamp,
  samplePose,
  stripToAnimationsOnly,
} from './anim/pose_blend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'public/models/chars/players/mage.glb');
const OUT = resolve(ROOT, 'public/models/chars/players/mage_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/mage_ability_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const raiseIdx = indexClip(root, 'Spellcast_Raise');
const castIdx = indexClip(root, 'Spellcasting');
const shootIdx = indexClip(root, 'Spellcast_Shoot');
const chopIdx = indexClip(root, '2H_Melee_Attack_Chop');

const allKeys = new Set([
  ...idleIdx.keys(),
  ...raiseIdx.keys(),
  ...castIdx.keys(),
  ...shootIdx.keys(),
  ...chopIdx.keys(),
]);
const donorFor = (key) =>
  raiseIdx.get(key) ??
  castIdx.get(key) ??
  shootIdx.get(key) ??
  chopIdx.get(key) ??
  idleIdx.get(key);

// Donor poses, sampled once at chosen timestamps within each clip's real
// duration (Idle 1.067s, Spellcast_Raise 2.100s, Spellcasting 0.667s,
// Spellcast_Shoot 0.933s, 2H_Melee_Attack_Chop 1.633s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raiseEarly = samplePose(raiseIdx, 0.3); // starting to lift the staff
const P_raiseHold = samplePose(raiseIdx, 1.8); // sustained ready pose near the tail
const P_castLoop = samplePose(castIdx, 0.3); // mid-loop channel pose
const P_shootEarly = samplePose(shootIdx, 0.2); // windup, before commitment
const P_shootRelease = samplePose(shootIdx, 0.7); // full release / follow-through
const P_chopWind = samplePose(chopIdx, 0.3); // big two-hand windup
const P_chopImpact = samplePose(chopIdx, 1.0); // downswing impact

const animations = [];

function bake(clipName, timeline) {
  const { animation } = bakeClip(doc, { clipName, channelKeys: allKeys, timeline, donorFor });
  animations.push(animation);
}

// --- Cast_Fire: quick raise, decisive early release, snappy return --------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseEarly)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.18,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseEarly,
    fallback: P_idle,
  });
  pushPoseRamp(t, {
    fromTime: 0.18,
    toTime: 0.4,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseEarly,
    toPose: P_shootRelease,
    fallback: P_idle,
  });
  pushPoseRamp(t, {
    fromTime: 0.4,
    toTime: 0.7,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_idle,
  });
  bake('Cast_Fire', t);
}

// --- Cast_Frost: full raise, held anticipation, crisp late release --------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_raiseHold)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.35,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseHold,
    fallback: P_idle,
  });
  t.push([0.65, (k) => poseValue(P_raiseHold, k, P_idle)]); // anticipation hold
  pushPoseRamp(t, {
    fromTime: 0.65,
    toTime: 0.85,
    steps: 3,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_shootRelease,
    fallback: P_idle,
  });
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.15,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_shootRelease,
    toPose: P_idle,
    fallback: P_idle,
  });
  bake('Cast_Frost', t);
}

// --- Cast_Arcane: three rapid raise/release pulses (missile barrage) ------
{
  const t = [[0, (k) => poseValue(P_idle, k, P_castLoop)]];
  let cursor = 0;
  const pulse = (from, to, dur) => {
    pushPoseRamp(t, {
      fromTime: cursor,
      toTime: cursor + dur,
      steps: 3,
      ease: easeOutCubic,
      fromPose: from,
      toPose: to,
      fallback: P_idle,
    });
    cursor += dur;
  };
  pulse(P_idle, P_castLoop, 0.12);
  for (let i = 0; i < 3; i++) {
    pulse(P_castLoop, P_shootEarly, 0.09);
    pulse(P_shootEarly, P_castLoop, 0.09);
  }
  pulse(P_castLoop, P_idle, 0.3);
  bake('Cast_Arcane', t);
}

// --- Cast_Nova: both arms up, then a big committed downward release -------
// Borrows the melee chop's impact energy: a nova reads as an outward slam,
// not a delicate spell release.
{
  const t = [[0, (k) => poseValue(P_idle, k, P_chopWind)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.3,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_idle,
    toPose: P_raiseHold,
    fallback: P_idle,
  });
  pushPoseRamp(t, {
    fromTime: 0.3,
    toTime: 0.55,
    steps: 4,
    ease: easeOutCubic,
    fromPose: P_raiseHold,
    toPose: P_chopWind,
    fallback: P_idle,
  });
  pushPoseRamp(t, {
    fromTime: 0.55,
    toTime: 0.85,
    steps: 5,
    ease: easeOutCubic,
    fromPose: P_chopWind,
    toPose: P_chopImpact,
    fallback: P_idle,
  });
  pushPoseRamp(t, {
    fromTime: 0.85,
    toTime: 1.2,
    steps: 5,
    ease: easeInOutQuad,
    fromPose: P_chopImpact,
    toPose: P_idle,
    fallback: P_idle,
  });
  bake('Cast_Nova', t);
}

// --- Cast_Polymorph: unhurried raise, a light flourish, a gentle point ----
{
  const t = [[0, (k) => poseValue(P_idle, k, P_castLoop)]];
  pushPoseRamp(t, {
    fromTime: 0,
    toTime: 0.5,
    steps: 6,
    ease: easeInOutQuad,
    fromPose: P_idle,
    toPose: P_raiseEarly,
    fallback: P_idle,
  });
  t.push([0.7, (k) => poseValue(P_castLoop, k, P_idle)]); // brief flourish hold
  pushPoseRamp(t, {
    fromTime: 0.7,
    toTime: 0.95,
    steps: 3,
    ease: easeInOutQuad,
    fromPose: P_castLoop,
    toPose: P_shootEarly, // a gentle point, not the full release pose
    fallback: P_idle,
  });
  pushPoseRamp(t, {
    fromTime: 0.95,
    toTime: 1.4,
    steps: 6,
    ease: easeInOutQuad,
    fromPose: P_shootEarly,
    toPose: P_idle,
    fallback: P_idle,
  });
  bake('Cast_Polymorph', t);
}

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + all 5 clips): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, animations);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
