// Build the hunter's bow-shot animation clip GLB.
//
// The KayKit ranged clips have no bow shot: 2H_Ranged_Shoot is the crossbow
// shoulder-aim, Aiming/Shooting are near-static drawn holds, and Reload is a
// down-then-up crank (the frame-by-frame audit strips in the Season 1 armory
// work). So this script AUTHORS one: it samples donor poses off the shared
// Rig_Medium skeleton (Idle for the bookends, Reload's reach-forward moment,
// the Aiming full-draw hold) and lays out a purpose-built keyframe timeline:
//
//   0.00        idle
//   0.14        raise the bow + reach the string hand forward (nock)
//   0.14-0.46   eased pull back to the full-draw hold (the draw)
//   0.46-0.55   hold at full draw (anticipation)
//   0.55-0.60   release: the string hand springs PAST the hold (overshoot
//               extrapolated on the left-arm chain), tiny torso kick
//   0.60-0.95   follow-through, ease back to idle
//
// BOW_RELEASE_AT (0.55s) is the visual string-snap pose. Auto Shot gameplay
// launches immediately; this authored timing is presentation-only.
//
// Source (CC0 1.0, no attribution required, already credited in CREDITS.md):
//   KayKit Character Pack: Adventurers 1.0 - Kay Lousberg
//   https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//   addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb (76 clips)
// Any Adventurers character works as the donor: the rig + clips are identical
// across them; only the (discarded) mesh differs.
//
//   node scripts/build_bow_anims.mjs <source-Adventurers-character.glb>
//
// Output: public/models/chars/players/bow_anims.glb (one clip: Bow_Draw_Shot)

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export const BOW_CLIP_NAME = 'Bow_Draw_Shot';
export const BOW_RELEASE_AT = 0.55; // seconds into the clip at timeScale 1

// Donor poses: clip name + absolute time (seconds) to sample.
const POSE_IDLE = { clip: 'Idle', at: 0.2 };
const POSE_REACH = { clip: '2H_Ranged_Reload', at: 0.33 }; // string hand forward on the bow
const POSE_HOLD = { clip: '2H_Ranged_Aiming', at: 0.5 }; // full-draw hold

// The string-hand chain that springs on release (overshoot past the hold).
const RELEASE_CHAIN = new Set(['upperarm.l', 'lowerarm.l', 'wrist.l', 'hand.l', 'handslot.l']);
const RELEASE_OVERSHOOT = 0.22;

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('usage: node scripts/build_bow_anims.mjs <source-Adventurers-character.glb>');
  process.exit(1);
}
const OUT = resolve(ROOT, 'public/models/chars/players/bow_anims.glb');

// ---------------------------------------------------------------------------
// math: vec3 lerp, quaternion slerp (with neighborhood fix), easing
// ---------------------------------------------------------------------------
function lerpV(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}
function slerpQ(a, b, t) {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const out = [
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ];
    const l = Math.hypot(...out);
    return out.map((v) => v / l);
  }
  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sin0 = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / sin0;
  const s1 = Math.sin(theta) / sin0;
  return [a[0] * s0 + bx * s1, a[1] * s0 + by * s1, a[2] * s0 + bz * s1, a[3] * s0 + bw * s1];
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ---------------------------------------------------------------------------
// donor sampling
// ---------------------------------------------------------------------------
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(SOURCE);
const root = doc.getRoot();

/** clip -> Map<"node|path", {times: Float32Array, values: Float32Array, size}> */
function indexClip(name) {
  const anim = root.listAnimations().find((a) => a.getName() === name);
  if (!anim) throw new Error(`donor clip missing: ${name}`);
  const map = new Map();
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    const path = ch.getTargetPath();
    const sampler = ch.getSampler();
    if (!node || !sampler) continue;
    if (sampler.getInterpolation() === 'CUBICSPLINE') {
      throw new Error(`cubic spline sampler on ${node.getName()}.${path}: unsupported`);
    }
    map.set(`${node.getName()}|${path}`, {
      node,
      path,
      times: sampler.getInput().getArray(),
      values: sampler.getOutput().getArray(),
      size: path === 'rotation' ? 4 : 3,
    });
  }
  return map;
}

/** Sample one channel at absolute time t (clamped, linear/slerp). */
function sampleChannel(ch, t) {
  const { times, values, size, path } = ch;
  const n = times.length;
  if (t <= times[0]) return [...values.slice(0, size)];
  if (t >= times[n - 1]) return [...values.slice((n - 1) * size, n * size)];
  let i = 1;
  while (times[i] < t) i++;
  const t0 = times[i - 1];
  const t1 = times[i];
  const k = (t - t0) / (t1 - t0);
  const a = [...values.slice((i - 1) * size, i * size)];
  const b = [...values.slice(i * size, (i + 1) * size)];
  return path === 'rotation' ? slerpQ(a, b, k) : lerpV(a, b, k);
}

/** Full pose: Map<"node|path", number[]> for every channel in the clip. */
function samplePose(clipIndex, t) {
  const pose = new Map();
  for (const [key, ch] of clipIndex) pose.set(key, sampleChannel(ch, t));
  return pose;
}

const idleIdx = indexClip(POSE_IDLE.clip);
const reachIdx = indexClip(POSE_REACH.clip);
const holdIdx = indexClip(POSE_HOLD.clip);

// The channel set we author = the union of channels across donors, so a bone
// animated by any donor gets explicit keys (missing entries fall back to the
// idle donor's sample, else stay unkeyed).
const channelKeys = new Set([...idleIdx.keys(), ...reachIdx.keys(), ...holdIdx.keys()]);

const P_idle = samplePose(idleIdx, POSE_IDLE.at);
const P_reach = samplePose(reachIdx, POSE_REACH.at);
const P_hold = samplePose(holdIdx, POSE_HOLD.at);

function poseValue(pose, key, fallback) {
  return pose.get(key) ?? fallback.get(key) ?? null;
}

/** Blend between two poses per channel (quat slerp / vec lerp). */
function blendValue(key, a, b, t) {
  return key.endsWith('|rotation') ? slerpQ(a, b, t) : lerpV(a, b, t);
}

// Release pose: the string-hand chain overshoots PAST the hold along the
// reach->hold direction; everything else stays at the hold.
function releaseValue(key, nodeName) {
  const hold = poseValue(P_hold, key, P_idle);
  if (!RELEASE_CHAIN.has(nodeName)) return hold;
  const reach = poseValue(P_reach, key, P_idle) ?? hold;
  return blendValue(key, reach, hold, 1 + RELEASE_OVERSHOOT);
}

// ---------------------------------------------------------------------------
// the authored timeline
// ---------------------------------------------------------------------------
const DRAW_STEPS = 8;
const FOLLOW_STEPS = 5;

/** [time, valueFor(key, nodeName)] rows, shared by every channel. */
const timeline = [];
timeline.push([0, (k) => poseValue(P_idle, k, P_hold)]);
// raise + reach the string (fast, slightly eased)
timeline.push([
  0.07,
  (k) => blendValue(k, poseValue(P_idle, k, P_hold), poseValue(P_reach, k, P_idle), 0.55),
]);
timeline.push([0.14, (k) => poseValue(P_reach, k, P_idle)]);
// the draw: eased pull from reach to the full-draw hold
for (let s = 1; s <= DRAW_STEPS; s++) {
  const f = s / DRAW_STEPS;
  const t = 0.14 + (0.46 - 0.14) * f;
  const e = easeOutCubic(f);
  timeline.push([
    t,
    (k) => blendValue(k, poseValue(P_reach, k, P_idle), poseValue(P_hold, k, P_idle), e),
  ]);
}
// anticipation hold
timeline.push([0.55, (k) => poseValue(P_hold, k, P_idle)]);
// release snap (fast overshoot on the string-hand chain)
timeline.push([0.6, (k, node) => releaseValue(k, node)]);
// follow-through back to idle
for (let s = 1; s <= FOLLOW_STEPS; s++) {
  const f = s / FOLLOW_STEPS;
  const t = 0.6 + (0.95 - 0.6) * f;
  const e = easeInOutQuad(f);
  timeline.push([
    t,
    (k, node) => blendValue(k, releaseValue(k, node), poseValue(P_idle, k, P_hold), e),
  ]);
}

// ---------------------------------------------------------------------------
// bake the clip + write the GLB
// ---------------------------------------------------------------------------
const buffer = root.listBuffers()[0];
const anim = doc.createAnimation(BOW_CLIP_NAME);
const times = new Float32Array(timeline.map(([t]) => t));
const input = doc
  .createAccessor(`${BOW_CLIP_NAME}_times`)
  .setArray(times)
  .setType('SCALAR')
  .setBuffer(buffer);

let authored = 0;
for (const key of channelKeys) {
  const [nodeName, path] = key.split('|');
  const donor = holdIdx.get(key) ?? reachIdx.get(key) ?? idleIdx.get(key);
  if (!donor) continue;
  const values = [];
  for (const [, valueFor] of timeline) {
    const v = valueFor(key, nodeName);
    if (!v) break;
    values.push(...v);
  }
  if (values.length !== times.length * donor.size) continue;
  const output = doc
    .createAccessor(`${BOW_CLIP_NAME}_${nodeName}_${path}`)
    .setArray(new Float32Array(values))
    .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
    .setBuffer(buffer);
  const sampler = doc
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation('LINEAR');
  const channel = doc
    .createAnimationChannel()
    .setTargetNode(donor.node)
    .setTargetPath(path)
    .setSampler(sampler);
  anim.addSampler(sampler).addChannel(channel);
  authored++;
}
if (authored === 0) throw new Error('no channels authored');

// Drop every donor clip (channels + samplers explicitly: disposing only the
// animation orphans them, and prune() then keeps their accessors).
for (const a of root.listAnimations()) {
  if (a === anim) continue;
  for (const channel of a.listChannels()) channel.dispose();
  for (const sampler of a.listSamplers()) sampler.dispose();
  a.dispose();
}
// Drop the skinned mesh + skins; the bone node hierarchy stays because the kept
// animation channels still target it (prune keeps animation-referenced nodes).
for (const mesh of root.listMeshes()) mesh.dispose();
for (const skin of root.listSkins()) skin.dispose();

await doc.transform(prune(), dedup());

await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
console.log(`channels authored: ${authored}, keys per channel: ${times.length}`);
console.log(`release at ${BOW_RELEASE_AT}s of ${times[times.length - 1]}s`);
