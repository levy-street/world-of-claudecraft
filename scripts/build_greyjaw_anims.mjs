// Build greyjaw's bespoke attack clip (issue #2889 round 2). greyjaw (the
// Mirefen Marsh named rare wolf boss, manifest key literally "greyjaw", not
// to be confused with mob_wolf on the same WOLF_BAKED ClipMap) currently
// shares WOLF_BAKED's plain Attack, the same swing mob_wolf and form_cat (a
// player druid/shaman form) still play. Unlike wolf_basic.glb (mob_wolf's
// and form_cat's separate, plainer rig), greyjaw.glb is a much richer,
// dedicated 48-animated-node rig that ships unused bonus donor clips
// specific to this named rare: Bark, Howl, "Idle Alert", Sneak. This
// authors a genuinely dramatic bespoke attack by pose-sample-and-blend
// (scripts/anim/pose_blend.mjs) off Howl and the rig's own Attack: a
// rear-back, head-raised howl windup into the lunge. No Blender: same
// technique, same module, as scripts/build_stag_anims.mjs.
//
// WOLF_BAKED itself (and mob_wolf, form_cat) is NOT touched: this task only
// overrides greyjaw's own ClipMap. greyjaw already ships and wires BOTH
// Idle_HitReact_Left and Idle_HitReact_Right (via animal()), so no
// hit-variety work is needed or possible here: this is attack-only.
//
//   Greyjaw_Attack: idle, rear back into the howl windup, hold the howl
//   peak (head raised), transition into the lunge windup, pounce impact,
//   follow-through, settle. Reads as an intimidating howl-then-pounce,
//   clearly more dramatic than the plain Attack every other WOLF_BAKED
//   user (mob_wolf, form_cat) still plays.
//
// Usage: node scripts/build_greyjaw_anims.mjs [--preview]
// Output: public/models/creatures/greyjaw_ability_anims.glb (0 meshes/
// skins, 1 clip: Greyjaw_Attack)
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
const SOURCE = resolve(ROOT, 'public/models/creatures/greyjaw.glb');
const OUT = resolve(ROOT, 'public/models/creatures/greyjaw_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/greyjaw_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const howlIdx = indexClip(root, 'Howl');
const attackIdx = indexClip(root, 'Attack');

const allKeys = new Set([...idleIdx.keys(), ...howlIdx.keys(), ...attackIdx.keys()]);
const donorFor = (key) => attackIdx.get(key) ?? howlIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 1.333s, Howl
// 2.333s, Attack 0.867s).
const P_idle = samplePose(idleIdx, 0.3);
const P_howlWind = samplePose(howlIdx, 0.3); // rear back, start of the howl
const P_howlPeak = samplePose(howlIdx, 1.2); // head raised, full howl held
const P_attackWind = samplePose(attackIdx, 0.15); // lunge windup
const P_attackImpact = samplePose(attackIdx, 0.55); // pounce impact
const P_attackFollow = samplePose(attackIdx, 0.8); // follow-through

// greyjaw.glb's donor clips don't all animate the identical channel set
// across its 48 nodes (pose_blend.mjs mergePoses doc): merge every donor
// pose once so any channel any of them animates always has SOME fallback
// instead of null-ing out mid-blend.
const P_all = mergePoses(
  P_idle,
  P_howlWind,
  P_howlPeak,
  P_attackWind,
  P_attackImpact,
  P_attackFollow,
);

const timeline = [[0, (k) => poseValue(P_idle, k, P_howlWind)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.3,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_idle,
  toPose: P_howlWind,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.3,
  toTime: 0.75,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_howlWind,
  toPose: P_howlPeak,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.75,
  toTime: 0.95,
  steps: 3,
  ease: easeOutCubic,
  fromPose: P_howlPeak,
  toPose: P_attackWind,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.95,
  toTime: 1.2,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_attackWind,
  toPose: P_attackImpact,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.2,
  toTime: 1.4,
  steps: 3,
  ease: easeInOutQuad,
  fromPose: P_attackImpact,
  toPose: P_attackFollow,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 1.4,
  toTime: 1.7,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_attackFollow,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Greyjaw_Attack',
  channelKeys: allKeys,
  timeline,
  donorFor,
});

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clip): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [animation]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
