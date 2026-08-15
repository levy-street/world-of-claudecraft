// Pose-sample-and-blend animation authoring: the shared core behind every
// script that authors a NEW clip by sampling donor poses already baked into a
// rig's own clip library at chosen timestamps, blending between them with
// hand-authored easing, and baking the result into a fresh AnimationClip.
//
// Extracted from build_bow_anims.mjs (the hunter's bow-draw-and-release clip,
// live in production) once a second and third consumer needed the same
// technique (see scripts/build_mage_ability_anims.mjs,
// scripts/build_elemental_anims.mjs). No Blender, no new dependency: this is
// pure @gltf-transform/core document surgery driven by a hand-authored
// keyframe timeline. See .claude/skills/blender-anim-pipeline/SKILL.md for
// when THIS technique stops being enough and headless Blender scripting is
// the documented escalation path instead.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export function createGlbIO() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

// ---------------------------------------------------------------------------
// math: vec3 lerp, quaternion slerp (with neighborhood fix), easing
// ---------------------------------------------------------------------------
export function lerpV(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

export function slerpQ(a, b, t) {
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

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Blend between two channel values per key ('nodeName|path'): quat slerp for rotation, vec lerp otherwise. */
export function blendValue(key, a, b, t) {
  return key.endsWith('|rotation') ? slerpQ(a, b, t) : lerpV(a, b, t);
}

// ---------------------------------------------------------------------------
// donor sampling
// ---------------------------------------------------------------------------

/** clip name -> Map<"node|path", {node, path, times, values, size}> for a gltf-transform Root. */
export function indexClip(root, name) {
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

/** Sample one donor channel at absolute time t (clamped, linear/slerp). */
export function sampleChannel(ch, t) {
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

/** Full pose: Map<"node|path", number[]> for every channel in a donor clip index, sampled at time t. */
export function samplePose(clipIndex, t) {
  const pose = new Map();
  for (const [key, ch] of clipIndex) pose.set(key, sampleChannel(ch, t));
  return pose;
}

/** Look up a channel value in a sampled pose, falling back to another pose (e.g. idle). */
export function poseValue(pose, key, fallback) {
  return pose.get(key) ?? fallback?.get(key) ?? null;
}

/**
 * Merge several sampled poses into one fallback pose, earlier poses winning
 * on a shared key. Donor clips from the same rig don't always animate the
 * SAME channel set (a gesture clip may skip a bone a locomotion clip
 * touches, or vice versa), so a single donor is often an incomplete
 * `poseValue` fallback: a channel key present in one donor but absent from
 * the chosen fallback resolves to null and blendValue/slerpQ throws. Passing
 * `mergePoses(idle, ...everyOtherDonorPose)` as the fallback guarantees every
 * key any donor animates has SOME value to fall back to.
 */
export function mergePoses(...poses) {
  const merged = new Map();
  for (const pose of poses) {
    for (const [key, value] of pose) {
      if (!merged.has(key)) merged.set(key, value);
    }
  }
  return merged;
}

/**
 * Append an eased ramp between two static poses to a timeline (mutates
 * `timeline` in place, same [time, valueFor] row shape `bakeClip` expects).
 * Every consumer with more than one donor-to-donor transition wants this
 * (see build_mage_ability_anims.mjs, build_elemental_anims.mjs); a transition
 * whose value depends on the target node itself (e.g. an overshoot chain like
 * build_bow_anims.mjs's release snap) still needs a bespoke valueFor instead.
 */
export function pushPoseRamp(
  timeline,
  { fromTime, toTime, steps, ease, fromPose, toPose, fallback },
) {
  for (let s = 1; s <= steps; s++) {
    const f = s / steps;
    const t = fromTime + (toTime - fromTime) * f;
    const e = ease(f);
    timeline.push([
      t,
      (key) =>
        blendValue(key, poseValue(fromPose, key, fallback), poseValue(toPose, key, fallback), e),
    ]);
  }
}

// ---------------------------------------------------------------------------
// baking a new clip from an authored keyframe timeline
// ---------------------------------------------------------------------------

/**
 * Bake a new AnimationClip from a hand-authored timeline.
 *
 * @param doc gltf-transform Document (mutated in place)
 * @param clipName name of the new animation
 * @param channelKeys iterable of "nodeName|path" keys to author (the union of
 *   every donor clip's channels is the usual choice: a bone animated by ANY
 *   donor gets an explicit key, so it never keeps stale donor-clip motion).
 * @param timeline array of [time, valueFor(key, nodeName) => number[] | null | undefined]
 *   rows, shared by every channel; a row returning a falsy value truncates
 *   that channel's keys at the previous row (used for channels a later donor
 *   doesn't cover).
 * @param donorFor(key) => {node, path, size} donor channel supplying the
 *   target node/path/component-size for that key (falsy skips the key).
 * @returns {animation, authored, times}, throws if zero channels authored.
 */
export function bakeClip(doc, { clipName, channelKeys, timeline, donorFor }) {
  const buffer = doc.getRoot().listBuffers()[0];
  const anim = doc.createAnimation(clipName);
  const times = new Float32Array(timeline.map(([t]) => t));
  const input = doc
    .createAccessor(`${clipName}_times`)
    .setArray(times)
    .setType('SCALAR')
    .setBuffer(buffer);

  let authored = 0;
  for (const key of channelKeys) {
    const [nodeName, path] = key.split('|');
    const donor = donorFor(key);
    if (!donor) continue;
    const values = [];
    for (const [, valueFor] of timeline) {
      const v = valueFor(key, nodeName);
      if (!v) break;
      values.push(...v);
    }
    if (values.length !== times.length * donor.size) continue;
    const output = doc
      .createAccessor(`${clipName}_${nodeName}_${path}`)
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
  if (authored === 0) throw new Error(`no channels authored for clip: ${clipName}`);
  return { animation: anim, authored, times };
}

/**
 * Drop every animation NOT in keepAnims (channels + samplers explicitly:
 * disposing only the animation orphans them, and prune() then keeps their
 * accessors), plus every mesh and skin. Leaves the bone node hierarchy intact
 * because the kept animation channels still target it.
 */
export function stripToAnimationsOnly(doc, keepAnims) {
  const keep = new Set(keepAnims);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (keep.has(a)) continue;
    for (const channel of a.listChannels()) channel.dispose();
    for (const sampler of a.listSamplers()) sampler.dispose();
    a.dispose();
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
}
