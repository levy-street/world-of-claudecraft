// Retarget the Blender-authored furniture sitting clips onto the shipped KayKit Rig_Medium.
//
// The clips are AUTHORED in headless Blender by scripts/anim/blender_sit_clips.py (read its
// header: the anchor-space contract, why the poses read the way they do). This script is
// the second half of the pipeline, modeled on scripts/build_swim_anims.mjs, whose header
// explains the retarget in full. In short: a Blender bone is head/tail/roll, so the glTF
// importer RE-DERIVES every bone frame and the export is not in the shipped rest frames. So
// every sampled frame is turned into the world-space skin deformation
//
//     E_j(t) = Wblender_anim_j(t) * inverse(Wblender_rest_j)
//
// and re-seated on the SHIPPED rest pose, Wship_anim_j(t) = E_j(t) * Wship_rest_j, then
// each joint's local TRS is re-derived against its animated parent. The result deforms the
// shipped skin exactly as the Blender rig did, whatever Blender did to the bone axes.
//
//   node scripts/build_sit_anims.mjs --prep          # Blender-importable rigs in tmp/sit/
//   blender --background --python scripts/anim/blender_sit_clips.py
//   node scripts/build_sit_anims.mjs --verify Idle   # the retarget gate, expect < 0.5 deg
//   node scripts/build_sit_anims.mjs                 # bake the GLB + print the contact report
//   node scripts/build_sit_anims.mjs --report        # the contact report on the shipped GLB
//
// `--prep` exists because Blender's glTF importer reads neither EXT_meshopt_compression nor
// KHR_texture_basisu: it writes decoded, dequantized, texture-free copies of the rigs.
// `--verify <clip>` runs the SAME retarget over a KayKit clip that the Blender export
// carries round-tripped (the authoring script exports the rig's own clips alongside the
// new ones) and prints the residual against the shipped original.
//
// The contact report skins the SHIPPED meshes of several bodies with the SHIPPED clips (in
// each body's own normalized yards, its normScale measured the way
// src/render/characters/assets.ts does) and prints, per seated clip, the lowest
// buttock/thigh skin against the seat (y = 0), the hip-joint midpoint's x/z, the soles'
// height, how far forward the hanging calves stay (the seat's front edge must be behind
// that), the relaxed back against its backrest plane, and the standing frames' soles
// against the floor.
//
// Output: public/models/chars/players/sit_anims.glb (clip-only: the joint hierarchy and
// the nine clips, no mesh, no skin; the bow_anims.glb / swim_anims.glb shape), meshopt
// compressed like the *_ability_anims.glb clip packs.
//   Sit_Chair_Down / Sit_Chair_Idle / Sit_Chair_StandUp   hop onto a 0.90 yd chair, sit, hop off
//   Sit_Chair_Relaxed_Idle                                 slumped against a backrest 0.65 yd behind
//   Sit_Chair_Talk / Sit_Chair_Drink                      the seated conversation and drink loops
//   Sit_High_Down / Sit_High_Idle / Sit_High_StandUp       the same on a 1.00 yd bar stool

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Quaternion, Vector3 } from 'three';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const TMP = resolve(ROOT, 'tmp/sit');
const SOURCE = resolve(TMP, 'sit_raw.glb'); // the Blender export
const RIG = resolve(ROOT, 'public/models/chars/players/knight.glb'); // canonical rest
const OUT = resolve(ROOT, 'public/models/chars/players/sit_anims.glb');
const FPS = 30;
/** The joint subtree to emit. Everything above it is the armature wrapper. */
const JOINT_ROOT = 'root';

/** Exactly what ships, by name (the Blender export also carries the rig's own clips). */
export const SIT_CLIPS = [
  'Sit_Chair_Down',
  'Sit_Chair_Idle',
  'Sit_Chair_StandUp',
  'Sit_Chair_Relaxed_Idle',
  'Sit_Chair_Talk',
  'Sit_Chair_Drink',
  'Sit_High_Down',
  'Sit_High_Idle',
  'Sit_High_StandUp',
];

// Anchor-space facts the report checks against (blender_sit_clips.py owns the authoring).
const CHAIR_SEAT_H = 0.9;
const HIGH_SEAT_H = 1.0;
const FRONT_EDGE_Z = 0.11;
const BACKREST_Z = -0.65;
const HUMANOID_H = 2.6;

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
      if (c && !child.getMesh()) walk(c);
    }
  };
  walk(start);
  return out;
}

// ---------------------------------------------------------------------------
// Sampling a source animation
// ---------------------------------------------------------------------------

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
  let hi = times.findIndex((v) => v >= t - 1e-7);
  if (hi < 0) hi = times.length - 1;
  const lo = Math.max(0, hi - 1);
  if (interp === 'CUBICSPLINE') {
    for (let k = 0; k < stride; k++) out[k] = values[hi * (stride * 3) + stride + k];
    return true;
  }
  if (hi === lo || interp === 'STEP' || Math.abs(times[hi] - t) < 1e-7) {
    for (let k = 0; k < stride; k++) out[k] = values[hi * stride + k];
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
// The retarget (build_swim_anims.mjs, unchanged in substance)
// ---------------------------------------------------------------------------

const scratch = { t: new Vector3(), q: new Quaternion(), s: new Vector3() };

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

    shipWorld.clear();
    for (const joint of order) {
      const src = srcRig.byName.get(joint.name);
      let W;
      if (src) {
        const E = srcWorld.get(joint.name).clone().multiply(src.restWorld.clone().invert());
        W = E.multiply(joint.restWorld);
      } else {
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

    for (const joint of order) {
      const parentName = joint.parent?.getName();
      const parentAnim = parentName ? shipWorld.get(parentName) : null;
      const local = parentAnim
        ? parentAnim.clone().invert().multiply(shipWorld.get(joint.name))
        : shipWorld.get(joint.name).clone();
      local.decompose(scratch.t, scratch.q, scratch.s);
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
  const find = (doc) =>
    doc
      .getRoot()
      .listAnimations()
      .find((a) => a.getName() === clipName);
  const srcAnim = find(srcDoc);
  const shipAnim = find(shipDoc);
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
      `max rotation error ${((worstRot * 180) / Math.PI).toFixed(4)} deg (${worstJoint}), ` +
      `max translation error ${worstPos.toExponential(2)}`,
  );
  return worstRot;
}

// ---------------------------------------------------------------------------
// Prep: Blender-importable copies of the rigs
// ---------------------------------------------------------------------------

const PREP_RIGS = [
  ['knight', 'public/models/chars/players/knight.glb'],
  ['mage', 'public/models/chars/players/mage.glb'],
  ['rogue', 'public/models/chars/players/rogue.glb'],
  ['modular', 'public/models/chars/modular/warrior_modular.glb'],
];

async function prep() {
  mkdirSync(TMP, { recursive: true });
  for (const [name, rel] of PREP_RIGS) {
    const doc = await io.read(resolve(ROOT, rel));
    await doc.transform(dequantize());
    for (const t of doc.getRoot().listTextures()) t.dispose();
    for (const e of doc.getRoot().listExtensionsUsed()) {
      const n = e.extensionName;
      if (n === 'KHR_texture_basisu' || n === 'EXT_meshopt_compression') e.dispose();
      if (n === 'KHR_mesh_quantization') e.dispose();
    }
    const out = resolve(TMP, `${name}_plain.glb`);
    await io.write(out, doc);
    console.log(`wrote ${out}`);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const CONSTANT_EPS = 1e-5;

function build(srcDoc, srcRig, shipRig, order) {
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
  out.createScene('Scene').addChild(outNodes.get(JOINT_ROOT));

  const byName = new Map(
    srcDoc
      .getRoot()
      .listAnimations()
      .map((a) => [a.getName(), a]),
  );
  for (const name of SIT_CLIPS) {
    const anim = byName.get(name);
    if (!anim) throw new Error(`${SOURCE} has no "${name}"`);
    const baked = retarget(anim, srcRig, shipRig, order);
    const gltfAnim = out.createAnimation(name);
    const input = out
      .createAccessor(`${name}_time`)
      .setType('SCALAR')
      .setArray(new Float32Array(baked.times))
      .setBuffer(buffer);
    const ends = out
      .createAccessor(`${name}_ends`)
      .setType('SCALAR')
      .setArray(new Float32Array([0, baked.times[baked.times.length - 1]]))
      .setBuffer(buffer);
    for (const joint of order) {
      const rec = baked.perJoint.get(joint.name);
      const emit = (path, rows, type, rest, always = false) => {
        const varies = rows.some((row) =>
          row.some((v, i) => Math.abs(v - rows[0][i]) > CONSTANT_EPS),
        );
        const offRest = rows[0].some((v, i) => Math.abs(v - rest[i]) > CONSTANT_EPS);
        if (!always && !varies && !offRest) return;
        // a held channel needs only its two ends
        const keys = varies ? rows : [rows[0], rows[0]];
        const acc = out
          .createAccessor(`${name}_${joint.name}_${path}`)
          .setType(type)
          .setArray(new Float32Array(keys.flat()))
          .setBuffer(buffer);
        const sampler = out
          .createAnimationSampler()
          .setInput(varies ? input : ends)
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
      // The rig root never moves: the renderer puts it on the seat anchor.
      if (joint.name === JOINT_ROOT) continue;
      // Every joint's rotation (and the hips' translation) is keyed in every clip, so each
      // clip states the whole pose and a crossfade never inherits a bone from the clip it
      // is blending away from.
      emit('rotation', rec.r, 'VEC4', joint.r, true);
      emit('translation', rec.t, 'VEC3', joint.t, joint.name === 'hips');
      emit('scale', rec.s, 'VEC3', joint.s);
    }
    console.log(
      `${name}: ${baked.times.length} frames, ` +
        `${baked.times[baked.times.length - 1].toFixed(2)}s, ` +
        `${gltfAnim.listChannels().length} channels`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contact report: the shipped clips on the shipped meshes, in each body's own yards
// ---------------------------------------------------------------------------

/** The default modular look (modular.ts DEFAULT_LOOK: the knight kit over the male body),
 *  which is also what assets.ts measures a modular body's normScale on. */
const MODULAR_DEFAULT = new Set([
  'M_Head',
  'Armor_knight_Head',
  'Armor_knight_Head1',
  'Armor_knight_Chest',
  'Armor_knight_ArmL',
  'Armor_knight_ArmR',
  'Armor_knight_HandL',
  'Armor_knight_HandR',
  'Armor_knight_LegL',
  'Armor_knight_LegR',
  'Armor_knight_FootL',
  'Armor_knight_FootR',
  'Armor_knight_Back',
]);
/** The bare modular body with its loincloth (the villager look under light clothes). */
const MODULAR_BARE = new Set([
  'M_Head',
  'M_Torso',
  'M_ArmL',
  'M_ArmR',
  'M_HandL',
  'M_HandR',
  'M_LegL',
  'M_LegR',
  'M_FootL',
  'M_FootR',
  'M_Loin',
]);
const P = 'public/models/chars/players';
const REPORT_BODIES = [
  { name: 'knight', file: `${P}/knight.glb` },
  { name: 'mage', file: `${P}/mage.glb` },
  { name: 'rogue', file: `${P}/rogue.glb` },
  {
    name: 'modular (default kit)',
    file: 'public/models/chars/modular/warrior_modular.glb',
    parts: MODULAR_DEFAULT,
  },
  {
    name: 'modular (bare body)',
    file: 'public/models/chars/modular/warrior_modular.glb',
    parts: MODULAR_BARE,
    scaleParts: MODULAR_DEFAULT,
  },
];
const SPREAD_BODIES = [
  'knight',
  'barbarian',
  'mage',
  'mage_classic',
  'rogue',
  'rogue_hooded',
  'ranger',
  'druid',
  'paladin',
];

/** A shipped body ready to skin: per-mesh arrays and its joint nodes by name. */
function loadBody(doc, parts) {
  const root = doc.getRoot();
  const parentOf = new Map();
  for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
  const meshes = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue; // assets.ts measures skinned meshes only
    if (parts && !parts.has(node.getName())) continue;
    const joints = skin.listJoints();
    const ibmAcc = skin.getInverseBindMatrices();
    const ibm = joints.map((_, i) => {
      const a = new Array(16);
      ibmAcc.getElement(i, a);
      return new Matrix4().fromArray(a);
    });
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const Wt = prim.getAttribute('WEIGHTS_0');
      const n = pos.getCount();
      const P3 = new Float64Array(n * 3);
      const J4 = new Uint16Array(n * 4);
      const W4 = new Float64Array(n * 4);
      const top = new Array(n);
      const e3 = [0, 0, 0];
      const e4 = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, e3);
        P3.set(e3, i * 3);
        J.getElement(i, e4);
        J4.set(e4, i * 4);
        const w = [0, 0, 0, 0];
        Wt.getElement(i, w);
        W4.set(w, i * 4);
        let best = 0;
        for (let k = 1; k < 4; k++) if (w[k] > w[best]) best = k;
        top[i] = joints[e4[best]].getName();
      }
      meshes.push({ name: node.getName(), node, joints, ibm, P3, J4, W4, top, count: n });
    }
  }
  return { doc, parentOf, meshes };
}

/** Local TRS overrides at time t: Map(nodeName -> {t, r, s}). */
function poseAt(tracks, t) {
  const pose = new Map();
  const b4 = [0, 0, 0, 1];
  const b3 = [0, 0, 0];
  for (const [name, tr] of tracks) {
    const o = {};
    if (tr.rotation && sampleTrack(tr.rotation, t, b4)) o.r = [...b4];
    if (tr.translation && sampleTrack(tr.translation, t, b3)) o.t = [...b3];
    if (tr.scale && sampleTrack(tr.scale, t, b3)) o.s = [...b3];
    pose.set(name, o);
  }
  return pose;
}

function worldOf(body, pose) {
  const W = new Map();
  const of = (n) => {
    if (W.has(n)) return W.get(n);
    const o = pose.get(n.getName()) ?? {};
    const l = new Matrix4().compose(
      new Vector3(...(o.t ?? n.getTranslation())),
      new Quaternion(...(o.r ?? n.getRotation())),
      new Vector3(...(o.s ?? n.getScale())),
    );
    const p = body.parentOf.get(n);
    const m = p ? of(p).clone().multiply(l) : l;
    W.set(n, m);
    return m;
  };
  for (const n of body.doc.getRoot().listNodes()) of(n);
  return W;
}

/** Visit every skinned vertex (three.js skinning: boneWorld * boneInverse * bindMatrix). */
function forEachVertex(body, pose, visit) {
  const W = worldOf(body, pose);
  for (const m of body.meshes) {
    const B = W.get(m.node);
    const mats = m.joints.map((j, i) =>
      W.get(j).clone().multiply(m.ibm[i]).multiply(B).elements.slice(),
    );
    for (let i = 0; i < m.count; i++) {
      const x = m.P3[i * 3];
      const y = m.P3[i * 3 + 1];
      const z = m.P3[i * 3 + 2];
      let ox = 0;
      let oy = 0;
      let oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = m.W4[i * 4 + k];
        if (!w) continue;
        const e = mats[m.J4[i * 4 + k]];
        ox += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        oy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        oz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
      visit(ox, oy, oz, m.top[i], m.name);
    }
  }
  return W;
}

function normScaleOf(body) {
  const idle = body.doc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === 'Idle');
  const pose = idle ? poseAt(readTracks(idle), Math.min(0.5, animDuration(idle) * 0.5)) : new Map();
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  forEachVertex(body, pose, (_x, y) => {
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  });
  return HUMANOID_H / (hi - lo);
}

const draped = (mesh) => /Cape|Back/.test(mesh);
const SEAT_GROUPS = new Set(['hips', 'upperleg.l', 'upperleg.r']);
const FOOT_GROUPS = new Set(['foot.l', 'foot.r', 'toes.l', 'toes.r']);
const CALF_GROUPS = new Set(['lowerleg.l', 'lowerleg.r', 'foot.l', 'foot.r', 'toes.l', 'toes.r']);

/** One frame's contact facts, in the body's own yards (anchor space). */
function frameFacts(body, pose, s) {
  const f = {
    seat: Number.POSITIVE_INFINITY,
    garment: Number.POSITIVE_INFINITY,
    sole: Number.POSITIVE_INFINITY,
    calf: Number.POSITIVE_INFINITY,
    back: Number.POSITIVE_INFINITY,
    heel: Number.POSITIVE_INFINITY,
  };
  const W = forEachVertex(body, pose, (x, y, z, g, mesh) => {
    const X = x * s;
    const Y = y * s;
    const Z = z * s;
    if (SEAT_GROUPS.has(g) && !draped(mesh) && Z <= FRONT_EDGE_Z) {
      // the buttocks and the thighs' undersides between the hip line and the front edge
      // carry the body; skin further back is a robe's or a tunic's back panel, which
      // hangs straight down off the pelvis and tucks into the board (reported apart)
      if (Z >= -0.06 && Math.abs(X) < 0.2) {
        if (Y < f.seat)
          f.seatAt = `${mesh}/${g} (${X.toFixed(2)}, ${Y.toFixed(2)}, ${Z.toFixed(2)})`;
        f.seat = Math.min(f.seat, Y);
      } else f.garment = Math.min(f.garment, Y);
    }
    if (FOOT_GROUPS.has(g)) {
      f.sole = Math.min(f.sole, Y);
      f.heel = Math.min(f.heel, Z);
    }
    if (CALF_GROUPS.has(g) && Y < -0.03) f.calf = Math.min(f.calf, Z);
    if ((g === 'chest' || g === 'spine' || g === 'head') && !draped(mesh) && Y > 0.3) {
      f.back = Math.min(f.back, Z);
    }
  });
  const joint = (name) => {
    const node = body.doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === name);
    return new Vector3().setFromMatrixPosition(W.get(node)).multiplyScalar(s);
  };
  const mid = joint('upperleg.l').add(joint('upperleg.r')).multiplyScalar(0.5);
  f.hipX = mid.x;
  f.hipZ = mid.z;
  return f;
}

const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);

function range(list, key) {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const f of list) {
    lo = Math.min(lo, f[key]);
    hi = Math.max(hi, f[key]);
  }
  return lo === hi ? fmt(lo) : `${fmt(lo)}..${fmt(hi)}`;
}

async function report(outDoc) {
  const anims = new Map(
    outDoc
      .getRoot()
      .listAnimations()
      .map((a) => [a.getName(), a]),
  );
  const spread = [];
  for (const name of SPREAD_BODIES) {
    const body = loadBody(await io.read(resolve(ROOT, `${P}/${name}.glb`)));
    spread.push(`${name} ${normScaleOf(body).toFixed(4)}`);
  }
  console.log(`\nnormScale (2.6 yd / idle height): ${spread.join(', ')}`);
  const seatedClips = [
    ['Sit_Chair_Idle', 'chair'],
    ['Sit_Chair_Relaxed_Idle', 'chair'],
    ['Sit_Chair_Talk', 'chair'],
    ['Sit_Chair_Drink', 'chair'],
    ['Sit_High_Idle', 'high'],
  ];
  for (const spec of REPORT_BODIES) {
    const doc = await io.read(resolve(ROOT, spec.file));
    const body = loadBody(doc, spec.parts);
    const s = normScaleOf(spec.scaleParts ? loadBody(doc, spec.scaleParts) : body);
    console.log(`\n${spec.name}: normScale ${s.toFixed(4)} (yards below are this body's)`);
    for (const [clip, fam] of seatedClips) {
      const anim = anims.get(clip);
      const tracks = readTracks(anim);
      const dur = animDuration(anim);
      const frames = [];
      for (let t = 0; t <= dur + 1e-6; t += 2 / FPS)
        frames.push(frameFacts(body, poseAt(tracks, t), s));
      const floor = fam === 'chair' ? -CHAIR_SEAT_H : -HIGH_SEAT_H;
      let line =
        `  ${clip.padEnd(23)} seat ${range(frames, 'seat')}  back panel ${range(frames, 'garment')}` +
        `  hip x ${range(frames, 'hipX')} z ${range(frames, 'hipZ')}` +
        `  soles ${range(frames, 'sole')} (floor ${floor.toFixed(2)})  calves z >= ${range(frames, 'calf')}`;
      if (clip === 'Sit_Chair_Relaxed_Idle') {
        line += `  back ${range(frames, 'back')} (plane ${BACKREST_Z.toFixed(2)})`;
      }
      console.log(line);
      if (process.argv.includes('--debug'))
        console.log(`      lowest seat skin: ${frames[0].seatAt}`);
    }
    for (const [clip, at, fam] of [
      ['Sit_Chair_Down', 0, 'chair'],
      ['Sit_Chair_StandUp', 1, 'chair'],
      ['Sit_High_Down', 0, 'high'],
      ['Sit_High_StandUp', 1, 'high'],
    ]) {
      const anim = anims.get(clip);
      const t = at ? animDuration(anim) : 0;
      const f = frameFacts(body, poseAt(readTracks(anim), t), s);
      const floor = fam === 'chair' ? -CHAIR_SEAT_H : -HIGH_SEAT_H;
      console.log(
        `  ${clip.padEnd(23)} standing frame: soles ${fmt(f.sole)} vs floor ${floor.toFixed(2)} ` +
          `(off by ${fmt(f.sole - floor)}), heels z ${fmt(f.heel)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

const verifyClip = process.argv.includes('--verify')
  ? process.argv[process.argv.indexOf('--verify') + 1]
  : null;

if (process.argv.includes('--prep')) {
  await prep();
} else if (process.argv.includes('--report')) {
  await report(await io.read(OUT));
} else {
  if (!existsSync(SOURCE)) throw new Error(`${SOURCE} missing: run blender_sit_clips.py first`);
  const srcDoc = await io.read(SOURCE);
  const shipDoc = await io.read(RIG);
  const srcRig = readRig(srcDoc);
  const shipRig = readRig(shipDoc);
  const order = jointOrder(shipRig);
  if (verifyClip) {
    const worst = verify(verifyClip, srcDoc, srcRig, shipDoc, shipRig, order);
    // A degree of slack absorbs the 30 fps resample against the source's own keys.
    process.exit(worst > (1.5 * Math.PI) / 180 ? 1 : 0);
  }
  const out = build(srcDoc, srcRig, shipRig, order);
  // EXT_meshopt_compression, like every other clip-only GLB beside it (the byte codec is
  // lossless on these unfiltered float keys: the shipped values are the baked values).
  await MeshoptEncoder.ready;
  await out.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(OUT, out);
  console.log(`wrote ${OUT}`);
  await report(await io.read(OUT));
}
