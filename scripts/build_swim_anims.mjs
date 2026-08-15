// Retarget Blender-authored swim clips onto the shipped KayKit Rig_Medium.
//
// The clips are AUTHORED in Blender (tmp/swim/build_swim.py, driven through the
// BlenderMCP bridge). A Blender bone is head/tail/roll, so it cannot in general
// represent the per-joint rest rotations KayKit ships (upperarm.l rests at a
// quaternion, not an axis-aligned frame): the importer RE-DERIVES every bone
// frame, and how far it lands from the original depends entirely on the
// bone_heuristic. Measured on this rig, against the shipped rest pose:
//
//     BLENDER     within 0.03 deg   (what build_swim.py imports with)
//     TEMPERANCE  within 0.03 deg
//     FORTUNE     43 deg out on the hand/handslot chain
//
// A clip exported in the wrong frames still LOOKS like an animation, it just
// deforms the shipped skin incorrectly — so none of that closeness is something
// to rely on. This script re-seats the animation on the shipped rest pose
// explicitly, which makes the result correct for any of those heuristics (and
// for whatever a future Blender changes them to). It converts each sampled
// frame into the world-space skin deformation
//
//     E_j(t) = Wblender_anim_j(t) * inverse(Wblender_rest_j)
//
// which is exactly what skinning consumes (`W_anim * inverseBind`), and re-seats
// it on the SHIPPED rest pose:
//
//     Wship_anim_j(t) = E_j(t) * Wship_rest_j
//
// then re-derives each joint's local TRS against its animated parent. Joints the
// author never touched ride their parent rigidly. The result is frame-identical
// deformation on the shipped rig regardless of what Blender did to the bone axes.
//
// `--verify <clip>` is the gate that proves the retarget is sound before any
// authored clip is trusted: it runs the SAME pipeline over a clip that exists in
// both files and prints the residual against the shipped original. It reads
// tmp/swim/verify_raw.glb — the donor rig round-tripped through Blender with its
// own clips intact — which tmp/swim/export_verify.py regenerates:
//
//   python3 ~/.claude/tools/blender_bridge.py run tmp/swim/export_verify.py
//   node scripts/build_swim_anims.mjs --verify Idle     # expect < 0.5 deg
//
//   node scripts/build_swim_anims.mjs                   # build the shipped clips
//
// Output: public/models/chars/players/swim_anims.glb
//   Swim_Breaststroke — submerged stroke: arms sweep out and back to centre,
//                       head down, body flat, legs frog-kick out and together.
//   Swim_Freestyle    — surface stroke: alternating overarm crawl + flutter kick.
//   Swim_Tread        — the swim idle: upright, sculling arms, eggbeater legs.
//   Water_Wade        — walking through shallow water: short high-kneed stride.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Quaternion, Vector3 } from 'three';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SOURCE = resolve(ROOT, 'tmp/swim/swim_raw.glb'); // the Blender export
// The verify gate's own donor: the same rig round-tripped through Blender with
// its SHIPPED clips, so a retargeted clip can be diffed against the original.
const VERIFY_SOURCE = resolve(ROOT, 'tmp/swim/verify_raw.glb');
const RIG = resolve(ROOT, 'public/models/chars/players/knight.glb'); // canonical rest
const OUT = resolve(ROOT, 'public/models/chars/players/swim_anims.glb');
const FPS = 30;
/** The joint subtree to emit. Everything above it is the armature wrapper. */
const JOINT_ROOT = 'root';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ---------------------------------------------------------------------------
// Rig model: name -> { parent, rest TRS, rest world matrix }
// ---------------------------------------------------------------------------

function readRig(doc) {
  const root = doc.getRoot();
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);

  const byName = new Map();
  for (const n of root.listNodes()) {
    byName.set(n.getName(), {
      node: n,
      name: n.getName(),
      parent: parentOf.get(n) ?? null,
      t: n.getTranslation(),
      r: n.getRotation(),
      s: n.getScale(),
    });
  }
  // rest world matrices, parents first
  const world = new Map();
  const worldOf = (entry) => {
    if (world.has(entry.name)) return world.get(entry.name);
    const local = new Matrix4().compose(
      new Vector3(...entry.t),
      new Quaternion(...entry.r),
      new Vector3(...entry.s),
    );
    const parentEntry = entry.parent ? byName.get(entry.parent.getName()) : null;
    const m = parentEntry ? worldOf(parentEntry).clone().multiply(local) : local;
    world.set(entry.name, m);
    return m;
  };
  for (const entry of byName.values()) entry.restWorld = worldOf(entry);
  return { byName, parentOf };
}

/** Preorder walk of the joint subtree, so parents resolve before children. */
function jointOrder(rig) {
  const start = rig.byName.get(JOINT_ROOT);
  if (!start) throw new Error(`rig has no "${JOINT_ROOT}" joint`);
  const out = [];
  const walk = (entry) => {
    out.push(entry);
    for (const child of entry.node.listChildren()) {
      const c = rig.byName.get(child.getName());
      // Skinned meshes hang off the armature too; only joints have no mesh.
      if (c && !child.getMesh()) walk(c);
    }
  };
  walk(start);
  return out;
}

// ---------------------------------------------------------------------------
// Sampling a source animation
// ---------------------------------------------------------------------------

/** channels of one animation, keyed nodeName -> path -> {times, values, stride, interp} */
function readTracks(anim) {
  const tracks = new Map();
  for (const chan of anim.listChannels()) {
    const target = chan.getTargetNode();
    const sampler = chan.getSampler();
    if (!target || !sampler) continue;
    const path = chan.getTargetPath();
    if (path === 'weights') continue;
    const times = Array.from(sampler.getInput().getArray());
    const outAcc = sampler.getOutput();
    const stride = path === 'rotation' ? 4 : 3;
    // getElement denormalizes; raw getArray() would hand back int16 counts.
    const values = [];
    for (let i = 0; i < outAcc.getCount(); i++) {
      const el = new Array(outAcc.getElementSize()).fill(0);
      outAcc.getElement(i, el);
      values.push(...el.slice(0, stride));
    }
    if (!tracks.has(target.getName())) tracks.set(target.getName(), {});
    tracks.get(target.getName())[path] = {
      times,
      values,
      stride,
      interp: sampler.getInterpolation(),
    };
  }
  return tracks;
}

function sampleTrack(track, t, out) {
  const { times, values, stride, interp } = track;
  if (times.length === 0) return false;
  let hi = times.findIndex((v) => v >= t);
  if (hi < 0) hi = times.length - 1;
  const lo = Math.max(0, hi - 1);
  if (interp === 'CUBICSPLINE') {
    // Blender is exported with forced per-frame sampling, so this never fires;
    // taking the value tangent keeps it honest if that ever changes.
    for (let k = 0; k < stride; k++) out[k] = values[hi * (stride * 3) + stride + k];
    return true;
  }
  if (hi === lo || interp === 'STEP') {
    for (let k = 0; k < stride; k++) out[k] = values[lo * stride + k];
    return true;
  }
  const span = times[hi] - times[lo];
  const f = span > 1e-9 ? (t - times[lo]) / span : 0;
  if (stride === 4) {
    const a = new Quaternion(...values.slice(lo * 4, lo * 4 + 4));
    const b = new Quaternion(...values.slice(hi * 4, hi * 4 + 4));
    a.slerp(b, f);
    out[0] = a.x;
    out[1] = a.y;
    out[2] = a.z;
    out[3] = a.w;
  } else {
    for (let k = 0; k < stride; k++) {
      out[k] = values[lo * stride + k] + (values[hi * stride + k] - values[lo * stride + k]) * f;
    }
  }
  return true;
}

function animDuration(anim) {
  let end = 0;
  for (const s of anim.listSamplers()) {
    const times = s.getInput().getArray();
    if (times.length) end = Math.max(end, times[times.length - 1]);
  }
  return end;
}

// ---------------------------------------------------------------------------
// The retarget
// ---------------------------------------------------------------------------

const scratch = { t: new Vector3(), q: new Quaternion(), s: new Vector3() };

/**
 * Retarget one source animation onto `shipRig`'s rest pose.
 * Returns { times, perJoint: Map(name -> { t: number[][], r: number[][], s: number[][] }) }.
 */
function retarget(anim, srcRig, shipRig, order) {
  const tracks = readTracks(anim);
  const duration = animDuration(anim);
  const frames = Math.max(2, Math.round(duration * FPS) + 1);
  const times = [];
  const perJoint = new Map();
  for (const j of order) perJoint.set(j.name, { t: [], r: [], s: [] });

  const buf4 = [0, 0, 0, 1];
  const buf3 = [0, 0, 0];
  const srcWorld = new Map();
  const shipWorld = new Map();
  const prevQuat = new Map();

  for (let f = 0; f < frames; f++) {
    const t = frames === 1 ? 0 : (duration * f) / (frames - 1);
    times.push(t);

    // 1. source (Blender) world matrices at t
    srcWorld.clear();
    for (const entry of srcRig.byName.values()) {
      const tr = tracks.get(entry.name);
      const T = new Vector3(...entry.t);
      const R = new Quaternion(...entry.r);
      const S = new Vector3(...entry.s);
      if (tr?.translation && sampleTrack(tr.translation, t, buf3)) T.set(buf3[0], buf3[1], buf3[2]);
      if (tr?.rotation && sampleTrack(tr.rotation, t, buf4)) {
        R.set(buf4[0], buf4[1], buf4[2], buf4[3]).normalize();
      }
      if (tr?.scale && sampleTrack(tr.scale, t, buf3)) S.set(buf3[0], buf3[1], buf3[2]);
      entry.localAnim = new Matrix4().compose(T, R, S);
    }
    const srcWorldOf = (entry) => {
      if (srcWorld.has(entry.name)) return srcWorld.get(entry.name);
      const p = entry.parent ? srcRig.byName.get(entry.parent.getName()) : null;
      const m = p ? srcWorldOf(p).clone().multiply(entry.localAnim) : entry.localAnim.clone();
      srcWorld.set(entry.name, m);
      return m;
    };
    for (const entry of srcRig.byName.values()) srcWorldOf(entry);

    // 2. re-seat each joint's world-space deformation on the shipped rest pose
    shipWorld.clear();
    for (const joint of order) {
      const src = srcRig.byName.get(joint.name);
      let W;
      if (src) {
        // E = Wanim * inverse(Wrest) is the deformation skinning consumes, so
        // applying it to the shipped rest reproduces the pose exactly.
        const E = srcWorld.get(joint.name).clone().multiply(src.restWorld.clone().invert());
        W = E.multiply(joint.restWorld);
      } else {
        // Untouched joint: ride the parent rigidly at its rest offset.
        const parentName = joint.parent?.getName();
        const parentAnim = parentName ? shipWorld.get(parentName) : null;
        const parentRest = parentName ? shipRig.byName.get(parentName)?.restWorld : null;
        W =
          parentAnim && parentRest
            ? parentAnim.clone().multiply(parentRest.clone().invert()).multiply(joint.restWorld)
            : joint.restWorld.clone();
      }
      shipWorld.set(joint.name, W);
    }

    // 3. back to local TRS against the ANIMATED parent
    for (const joint of order) {
      const parentName = joint.parent?.getName();
      const parentAnim = parentName ? shipWorld.get(parentName) : null;
      const local = parentAnim
        ? parentAnim.clone().invert().multiply(shipWorld.get(joint.name))
        : shipWorld.get(joint.name).clone();
      local.decompose(scratch.t, scratch.q, scratch.s);
      // Keep the quaternion on the same hemisphere as the previous frame: a sign
      // flip is the same rotation but makes the LINEAR sampler take the long way.
      const prev = prevQuat.get(joint.name);
      if (prev && scratch.q.dot(prev) < 0) {
        scratch.q.set(-scratch.q.x, -scratch.q.y, -scratch.q.z, -scratch.q.w);
      }
      prevQuat.set(joint.name, scratch.q.clone());
      const rec = perJoint.get(joint.name);
      rec.t.push([scratch.t.x, scratch.t.y, scratch.t.z]);
      rec.r.push([scratch.q.x, scratch.q.y, scratch.q.z, scratch.q.w]);
      rec.s.push([scratch.s.x, scratch.s.y, scratch.s.z]);
    }
  }
  return { times, perJoint };
}

// ---------------------------------------------------------------------------
// Verify mode
// ---------------------------------------------------------------------------

function verify(clipName, srcDoc, srcRig, shipDoc, shipRig, order) {
  const srcAnim = srcDoc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === clipName);
  const shipAnim = shipDoc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === clipName);
  if (!srcAnim || !shipAnim) {
    console.error(`verify: "${clipName}" missing (source=${!!srcAnim} rig=${!!shipAnim})`);
    process.exit(1);
  }
  const baked = retarget(srcAnim, srcRig, shipRig, order);
  const shipTracks = readTracks(shipAnim);
  const buf4 = [0, 0, 0, 1];
  const buf3 = [0, 0, 0];
  let worstRot = 0;
  let worstPos = 0;
  let worstJoint = '';
  for (let f = 0; f < baked.times.length; f++) {
    const t = baked.times[f];
    for (const joint of order) {
      const tr = shipTracks.get(joint.name);
      const rec = baked.perJoint.get(joint.name);
      const expectR = new Quaternion(...joint.r);
      const expectT = new Vector3(...joint.t);
      if (tr?.rotation && sampleTrack(tr.rotation, t, buf4)) {
        expectR.set(buf4[0], buf4[1], buf4[2], buf4[3]).normalize();
      }
      if (tr?.translation && sampleTrack(tr.translation, t, buf3)) {
        expectT.set(buf3[0], buf3[1], buf3[2]);
      }
      const gotR = new Quaternion(...rec.r[f]).normalize();
      // angle between the two rotations, sign-insensitive
      const angle = 2 * Math.acos(Math.min(1, Math.abs(gotR.dot(expectR))));
      const dist = new Vector3(...rec.t[f]).distanceTo(expectT);
      if (angle > worstRot) {
        worstRot = angle;
        worstJoint = joint.name;
      }
      worstPos = Math.max(worstPos, dist);
    }
  }
  console.log(
    `verify "${clipName}": ${baked.times.length} frames, ` +
      `max rotation error ${((worstRot * 180) / Math.PI).toFixed(4)}° (${worstJoint}), ` +
      `max translation error ${worstPos.toExponential(2)}`,
  );
  return worstRot;
}

// ---------------------------------------------------------------------------

const verifyClip = process.argv.includes('--verify')
  ? process.argv[process.argv.indexOf('--verify') + 1]
  : null;
const srcDoc = await io.read(verifyClip ? VERIFY_SOURCE : SOURCE);
const shipDoc = await io.read(RIG);
const srcRig = readRig(srcDoc);
const shipRig = readRig(shipDoc);
const order = jointOrder(shipRig);

if (verifyClip) {
  const worst = verify(verifyClip, srcDoc, srcRig, shipDoc, shipRig, order);
  // A degree of slack absorbs the 30 fps resample against the source's own keys.
  process.exit(worst > (1.5 * Math.PI) / 180 ? 1 : 0);
}

// Build the output document: the joint subtree + the retargeted clips, nothing
// else (bow_anims.glb precedent — assets.ts only ever reads `.animations`).
const { Document } = await import('@gltf-transform/core');
const out = new Document();
const buffer = out.createBuffer();
const outNodes = new Map();
for (const joint of order) {
  const n = out
    .createNode(joint.name)
    .setTranslation(joint.t)
    .setRotation(joint.r)
    .setScale(joint.s);
  outNodes.set(joint.name, n);
}
for (const joint of order) {
  const parentName = joint.parent?.getName();
  const parent = parentName ? outNodes.get(parentName) : null;
  if (parent) parent.addChild(outNodes.get(joint.name));
}
const scene = out.createScene('Scene');
scene.addChild(outNodes.get(JOINT_ROOT));

const CONSTANT_EPS = 1e-5;
let clipCount = 0;
// ONLY the water clips, by name. The Blender export carries every action in the
// session, and a session that imported the rig from a shipped GLB has all
// 20-odd of the KayKit clips loaded — shipping those here would bloat the file
// 18x AND layer a second Idle/Walking/Running onto every class body that loads
// it. An explicit list rather than a prefix, so what ships is stated here.
const WATER_CLIPS = new Set([
  'Swim_Breaststroke', // submerged stroke
  'Swim_Freestyle', // surface stroke
  'Swim_Tread', // the swim idle: upright, sculling
  'Water_Wade', // walking through shallow water
  'Fall_Flail', // long-fall panic flail (tmp/fall/build_fall.py) — rides this
  // shared clip-only GLB so it costs no extra loading lane
]);
for (const anim of srcDoc.getRoot().listAnimations()) {
  if (!WATER_CLIPS.has(anim.getName())) continue;
  const baked = retarget(anim, srcRig, shipRig, order);
  const gltfAnim = out.createAnimation(anim.getName());
  const input = out
    .createAccessor(`${anim.getName()}_time`)
    .setType('SCALAR')
    .setArray(new Float32Array(baked.times))
    .setBuffer(buffer);
  for (const joint of order) {
    const rec = baked.perJoint.get(joint.name);
    const emit = (path, rows, type, rest) => {
      const varies = rows.some((row) =>
        row.some((v, i) => Math.abs(v - rows[0][i]) > CONSTANT_EPS),
      );
      const offRest = rows[0].some((v, i) => Math.abs(v - rest[i]) > CONSTANT_EPS);
      if (!varies && !offRest) return;
      const acc = out
        .createAccessor(`${anim.getName()}_${joint.name}_${path}`)
        .setType(type)
        .setArray(new Float32Array(rows.flat()))
        .setBuffer(buffer);
      const sampler = out
        .createAnimationSampler()
        .setInput(input)
        .setOutput(acc)
        .setInterpolation('LINEAR');
      gltfAnim.addSampler(sampler);
      gltfAnim.addChannel(
        out
          .createAnimationChannel()
          .setTargetNode(outNodes.get(joint.name))
          .setTargetPath(path)
          .setSampler(sampler),
      );
    };
    emit('rotation', rec.r, 'VEC4', joint.r);
    emit('translation', rec.t, 'VEC3', joint.t);
    emit('scale', rec.s, 'VEC3', joint.s);
  }
  clipCount++;
  console.log(
    `${anim.getName()}: ${baked.times.length} frames, ` +
      `${baked.times[baked.times.length - 1].toFixed(2)}s, ` +
      `${gltfAnim.listChannels().length} channels`,
  );
}
if (clipCount === 0) throw new Error(`${SOURCE} has none of ${[...WATER_CLIPS].join(', ')}`);

await io.write(OUT, out);
console.log(`wrote ${OUT}`);
