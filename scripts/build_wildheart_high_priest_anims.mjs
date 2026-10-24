// Build Zulgar, Voice of the Basin's own attack/cast clip (issue #2889 round 2).
// mob_wildheart_high_priest shares the literal TRIPO_BIPED_FULL_RIG ClipMap object, by
// reference, with the other 4 Wildheart Basin mobs in src/render/characters/manifest.ts,
// so this dungeon boss "attacks" with the exact same generic melee Attack swing as the
// ranged Stalker, the melee Ravager, the caster Hexcaller, and the Beastmaster. This rig
// ships NO spare/unused donor clips (every one of Idle/Walk/Run/Attack/Hit/Cast/Jump/Death
// is already wired into TRIPO_BIPED_FULL_RIG), so the bespoke clip below is authored by
// pose-sample-and-blend (scripts/anim/pose_blend.mjs) off a re-timed, re-mixed
// re-sampling of THIS rig's own Cast and Jump donors: a climactic Cast hold sampled near
// its full 5.375s duration, blended into Jump's own airborne pose repurposed as a
// downward slam/roar release, not played as a literal jump. This is the longest and most
// dramatic of the 5 Wildheart bespoke attack clips, befitting the dungeon boss. No
// Blender: same technique, same module, as scripts/build_mage_ability_anims.mjs.
//
//   Wildheart_High_Priest_Attack: build into an early Cast-donor raise, a big ramp into a
//   wide climactic Cast-donor pose sampled near-full duration, a sustained held beat (the
//   boss-scale drama), then Jump's own donor pose repurposed as a downward slam/roar
//   release, settle to idle. Total ~2.60s: the longest and most dramatic of the five
//   Wildheart mobs' bespoke attacks. Wired into both `attack` (the one-shot swing
//   rotation) and `cast` (the looping cast channel).
//
// Usage: node scripts/build_wildheart_high_priest_anims.mjs [--preview]
// Output: public/models/creatures/wildheart_high_priest_ability_anims.glb (0 meshes/
// skins, 1 clip: Wildheart_High_Priest_Attack)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedup, prune } from '@gltf-transform/functions';
import {
  bakeClip,
  blendValue,
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
const SOURCE = resolve(ROOT, 'public/models/creatures/wildheart_high_priest.glb');
const OUT = resolve(ROOT, 'public/models/creatures/wildheart_high_priest_ability_anims.glb');
const PREVIEW_OUT = resolve(ROOT, 'tmp/wildheart_high_priest_anims_preview.glb');
const PREVIEW = process.argv.includes('--preview');

const io = createGlbIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

const idleIdx = indexClip(root, 'Idle');
const castIdx = indexClip(root, 'Cast');
const jumpIdx = indexClip(root, 'Jump');

const allKeys = new Set([...idleIdx.keys(), ...castIdx.keys(), ...jumpIdx.keys()]);
const donorFor = (key) => castIdx.get(key) ?? jumpIdx.get(key) ?? idleIdx.get(key);

// Donor poses, sampled within each clip's real duration (Idle 15.375s, Cast 5.375s,
// Jump 2.250s).
const P_idle = samplePose(idleIdx, 0.3);
const P_raise = samplePose(castIdx, 1.0); // building into the climactic pose
const P_climactic = samplePose(castIdx, 5.0); // wide climactic pose, near Cast's full 5.375s
const P_slam = samplePose(jumpIdx, 1.8); // Jump's own airborne pose, repurposed as a slam/roar

// Cast (22 channels) and Jump (40 channels) don't animate the same channel set as Idle
// (39 channels) on this rig; merge once (pose_blend.mjs mergePoses doc) so every channel
// any donor touches has SOME fallback value instead of null-ing out mid-blend.
const P_all = mergePoses(P_idle, P_raise, P_climactic, P_slam);

const timeline = [[0, (k) => poseValue(P_idle, k, P_raise)]];
pushPoseRamp(timeline, {
  fromTime: 0,
  toTime: 0.6,
  steps: 6,
  ease: easeInOutQuad,
  fromPose: P_idle,
  toPose: P_raise,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 0.6,
  toTime: 1.5,
  steps: 8,
  ease: easeOutCubic,
  fromPose: P_raise,
  toPose: P_climactic,
  fallback: P_all,
});
timeline.push([1.9, (k) => poseValue(P_climactic, k, P_idle)]); // held climactic beat, boss drama
pushPoseRamp(timeline, {
  fromTime: 1.9,
  toTime: 2.15,
  steps: 4,
  ease: easeOutCubic,
  fromPose: P_climactic,
  toPose: P_slam,
  fallback: P_all,
});
pushPoseRamp(timeline, {
  fromTime: 2.15,
  toTime: 2.6,
  steps: 5,
  ease: easeInOutQuad,
  fromPose: P_slam,
  toPose: P_idle,
  fallback: P_all,
});

const { animation } = bakeClip(doc, {
  clipName: 'Wildheart_High_Priest_Attack',
  channelKeys: allKeys,
  timeline,
  donorFor,
});

// ---- Wildheart_High_Priest_Swing: his melee swing (the owner's playtest, 03/10) ----
// The clip above, played as his auto-attack, heaved his WHOLE body (its Jump
// donor turns the pelvis 140 degrees and tucks the legs) on every swing. The
// swing is now its own clip off the rig's own Attack donor: a wind-up with the
// right claw raised, a fast overhead rake down onto the target and a recovery,
// carried by the arms, shoulders and spine. The legs and pelvis stay on the
// idle stance (a tenth of the donor's motion), the waist takes half of the
// donor's forward bend, so his feet stay planted and the blow reads as a swing,
// not a lurch. Contact at 0.55 s; 1.30 s in all.
const attackIdx = indexClip(root, 'Attack');
const swingKeys = new Set([...idleIdx.keys(), ...attackIdx.keys()]);
const swingDonorFor = (key) => attackIdx.get(key) ?? idleIdx.get(key);
const P_reach = samplePose(attackIdx, 0.6); // the left claw out, sizing the target
const P_wind = samplePose(attackIdx, 0.86); // the right claw high over the head
const P_strike = samplePose(attackIdx, 1.14); // the rake lands, both arms down
const P_follow = samplePose(attackIdx, 1.4); // carried through, the spine curled
const P_swingAll = mergePoses(P_idle, P_reach, P_wind, P_strike, P_follow);

/** How much of the Attack donor each bone takes (the rest is the idle stance). */
function swingWeight(key) {
  const node = key.slice(0, key.indexOf('|'));
  if (/^(Root|Pelvis)$/.test(node)) return 0.12;
  if (/(Thigh|Calf|Foot|ToeBase)/.test(node)) return 0.1;
  if (node === 'Waist') return 0.5;
  if (/^Spine/.test(node)) return 0.75;
  if (/^(Neck|Head)/.test(node)) return 0.7;
  return 1; // clavicles, arms, forearms, hands
}

/** A donor pose laid over the idle stance by swingWeight. */
function overIdle(pose) {
  const out = new Map();
  for (const key of swingKeys) {
    const base = poseValue(P_idle, key, P_swingAll);
    const donor = poseValue(pose, key, P_swingAll);
    out.set(key, blendValue(key, base, donor, swingWeight(key)));
  }
  return out;
}

const S_reach = overIdle(P_reach);
const S_wind = overIdle(P_wind);
const S_strike = overIdle(P_strike);
const S_follow = overIdle(P_follow);
const swingLine = [[0, (k) => poseValue(P_idle, k, P_swingAll)]];
const ramp = (fromTime, toTime, steps, ease, fromPose, toPose) =>
  pushPoseRamp(swingLine, {
    fromTime,
    toTime,
    steps,
    ease,
    fromPose,
    toPose,
    fallback: P_swingAll,
  });
ramp(0, 0.2, 3, easeInOutQuad, P_idle, S_reach);
ramp(0.2, 0.42, 3, easeInOutQuad, S_reach, S_wind);
ramp(0.42, 0.55, 3, easeOutCubic, S_wind, S_strike);
ramp(0.55, 0.78, 3, easeOutCubic, S_strike, S_follow);
swingLine.push([0.86, (k) => poseValue(S_follow, k, P_swingAll)]);
ramp(0.86, 1.3, 5, easeInOutQuad, S_follow, P_idle);

const { animation: swing } = bakeClip(doc, {
  clipName: 'Wildheart_High_Priest_Swing',
  channelKeys: swingKeys,
  timeline: swingLine,
  donorFor: swingDonorFor,
});

if (PREVIEW) {
  await io.write(PREVIEW_OUT, doc);
  console.log(`wrote preview (mesh + skin + clip): ${PREVIEW_OUT}`);
}

stripToAnimationsOnly(doc, [animation, swing]);
await doc.transform(prune(), dedup());
await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
