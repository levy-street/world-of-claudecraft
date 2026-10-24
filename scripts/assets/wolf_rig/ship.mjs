// Ship a wolf rebuilt by build.py: the raw Blender export in, the game file out.
//
//   node scripts/assets/wolf_rig/ship.mjs <raw.glb> <shipped.glb> <out.glb>
//
// <shipped.glb> is the wolf as it ships now (the texture's source of truth): its
// KTX2 texture goes into the new file byte for byte, and its material settings
// with it, so the rebuild never re-encodes the art. Then dedup, prune, a lossless
// key reduction, and meshopt with quantization (the game's loader carries the
// decoder), exactly what the old file carried. Before writing, the result is read
// back and checked: exactly the contract's clips and joints (contract.mjs), the
// weights, the texture codec, and that compression moved no joint of any clip by
// more than MAX_TURN (radians) or MAX_SHIFT (units, or that share of a move longer
// than one unit).
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { WOLF_CLIPS, WOLF_JOINT_NAMES } from './contract.mjs';

const MAX_TURN = 2e-3;
const MAX_SHIFT = 1e-3;

function snapshot(doc) {
  const out = new Map();
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const s = ch.getSampler();
      const key = `${anim.getName()}|${ch.getTargetNode()?.getName()}|${ch.getTargetPath()}`;
      const times = Array.from(s.getInput().getArray());
      const size = s.getOutput().getElementSize();
      const vals = [];
      for (let i = 0; i < s.getOutput().getCount(); i++)
        vals.push(s.getOutput().getElement(i, new Array(size)));
      out.set(key, { times, vals });
    }
  }
  return out;
}

// A rotation key may come back with its sign flipped: meshopt's quaternion filter
// stores the largest component positive, so a key whose x and w are nearly equal
// can land on the other hemisphere from its neighbour. The game's slerp takes the
// short way between them; so does this check (a plain lerp across the flip read a
// 6 degree error on Greyjaw's ear that the game never shows).
function sampleAt({ times, vals }, t, rot = false) {
  if (t <= times[0]) return vals[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const u = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
      const a = vals[i - 1];
      let b = vals[i];
      if (rot && a.reduce((s, x, k) => s + x * b[k], 0) < 0) b = b.map((x) => -x);
      return b.map((v, k) => a[k] + (v - a[k]) * u);
    }
  }
  return vals[vals.length - 1];
}

const REST_TOLERANCE = 1e-4;

function restValue(node, path) {
  if (path === 'translation') return node.getTranslation();
  if (path === 'rotation') return node.getRotation();
  return node.getScale();
}

function restOf(doc) {
  return new Map(
    doc
      .getRoot()
      .listNodes()
      .map((n) => [n.getName(), n]),
  );
}

/** Remove every channel whose value never leaves its node's rest value. */
function dropRestTracks(doc) {
  const dropped = new Set();
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const out = ch.getSampler().getOutput();
      const rest = restValue(node, path);
      const el = new Array(out.getElementSize()).fill(0);
      let still = true;
      for (let i = 0; i < out.getCount() && still; i++) {
        out.getElement(i, el);
        const sign = path === 'rotation' && el.reduce((s, v, k) => s + v * rest[k], 0) < 0 ? -1 : 1;
        still = el.every((v, k) => Math.abs(v * sign - rest[k]) < REST_TOLERANCE);
      }
      if (!still) continue;
      dropped.add(`${anim.getName()}|${node.getName()}|${path}`);
      const sampler = ch.getSampler();
      ch.dispose();
      sampler.dispose();
    }
  }
  return dropped;
}

/** Rotations as normalised 16-bit quaternions (meshopt's QUATERNION filter). */
function quantizeRotations(doc) {
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== 'rotation') continue;
      const out = ch.getSampler().getOutput();
      if (out.getComponentType() !== 5126) continue;
      const src = out.getArray();
      const q = new Int16Array(src.length);
      for (let i = 0; i < src.length; i++)
        q[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767);
      out.setArray(q).setNormalized(true);
    }
  }
}

function drift(before, after, nodes, dropped) {
  let turn = 0;
  let shift = 0;
  let worst = '';
  let worstTurn = '';
  for (const [key, a] of before) {
    let b = after.get(key);
    if (!b && dropped.has(key)) {
      const [, nodeName, path] = key.split('|');
      const rest = restValue(nodes.get(nodeName), path);
      b = { times: [0], vals: [rest] };
    }
    if (!b) throw new Error(`channel lost in shipping: ${key}`);
    const rot = key.endsWith('|rotation');
    for (let i = 0; i < a.times.length; i++) {
      const v = a.vals[i];
      const w = sampleAt(b, a.times[i], rot);
      if (rot) {
        const dot =
          Math.abs(v.reduce((s, x, k) => s + x * w[k], 0)) /
          (Math.hypot(...v) * Math.hypot(...w) || 1);
        const t = 2 * Math.acos(Math.min(1, dot));
        if (t > turn) {
          turn = t;
          worstTurn = `${key} at t=${a.times[i].toFixed(3)}`;
        }
      } else {
        // relative past one unit: the codec keeps a fixed number of bits, so the
        // Jump's 2-unit lunge moves a millimetre where an idle bob moves nothing
        const d = Math.hypot(...v.map((x, k) => x - w[k])) / Math.max(1, Math.hypot(...v));
        if (d > shift) {
          shift = d;
          worst = `${key} at t=${a.times[i].toFixed(3)}, value ${v.map((x) => x.toFixed(3)).join(', ')}`;
        }
      }
    }
  }
  return { turn, shift, worst, worstTurn };
}

async function main() {
  const [, , rawPath, shippedPath, outPath] = process.argv;
  if (!rawPath || !shippedPath || !outPath) {
    console.error('usage: ship.mjs <raw.glb> <shipped.glb> <out.glb>');
    process.exit(1);
  }
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
  const doc = await io.readBinary(fs.readFileSync(rawPath));
  const shipped = await io.readBinary(fs.readFileSync(shippedPath));
  const root = doc.getRoot();

  // 1. the shipped art, untouched
  const [oldTex] = shipped.getRoot().listTextures();
  const [oldMat] = shipped.getRoot().listMaterials();
  if (oldTex?.getMimeType() !== 'image/ktx2') throw new Error('shipped file has no KTX2 texture');
  const textures = root.listTextures();
  if (textures.length !== 1)
    throw new Error(`expected one texture in the export, found ${textures.length}`);
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  textures[0]
    .setImage(oldTex.getImage())
    .setMimeType('image/ktx2')
    .setURI('')
    .setName(oldTex.getName());
  for (const mat of root.listMaterials()) {
    mat
      .setBaseColorFactor(oldMat.getBaseColorFactor())
      .setRoughnessFactor(oldMat.getRoughnessFactor())
      .setMetallicFactor(oldMat.getMetallicFactor())
      .setAlphaMode(oldMat.getAlphaMode())
      .setDoubleSided(oldMat.getDoubleSided())
      .setEmissiveFactor(oldMat.getEmissiveFactor());
  }

  // 2. drop the tracks that never leave the rest pose (Blender writes position,
  //    rotation and scale for every joint of every clip; only the Pelvis travels and
  //    nothing scales), then store rotations as 16-bit, as the old file did
  const before = snapshot(doc);
  const dropped = dropRestTracks(doc);
  await doc.transform(dedup(), prune(), resample({ tolerance: 1e-5 }));
  quantizeRotations(doc);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const buf = Buffer.from(await io.writeBinary(doc));

  // 3. read back and check
  const check = await io.readBinary(buf);
  const croot = check.getRoot();
  const clips = croot.listAnimations().map((a) => a.getName());
  const missing = WOLF_CLIPS.filter((c) => !clips.includes(c));
  const extra = clips.filter((c) => !WOLF_CLIPS.includes(c));
  if (missing.length || extra.length) {
    throw new Error(
      `clips missing: ${missing.join(', ') || '-'}; not in the contract: ${extra.join(', ') || '-'}`,
    );
  }
  const skins = croot.listSkins();
  const [skin] = skins;
  const joints = skin ? skin.listJoints().map((j) => j.getName()) : [];
  const strayJoints = joints.filter((j) => !WOLF_JOINT_NAMES.includes(j));
  if (skins.length !== 1 || joints.length !== WOLF_JOINT_NAMES.length || strayJoints.length) {
    throw new Error(
      `expected one skin with the ${WOLF_JOINT_NAMES.length} contract joints, found ${skins.length} skins, ${joints.length} joints (not in the contract: ${strayJoints.join(', ') || '-'})`,
    );
  }
  for (const mesh of croot.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const w = prim.getAttribute('WEIGHTS_0');
      if (!w) throw new Error('a primitive lost its weights');
      const el = [0, 0, 0, 0];
      for (let i = 0; i < w.getCount(); i++) {
        w.getElement(i, el);
        const s = el[0] + el[1] + el[2] + el[3];
        if (Math.abs(s - 1) > 0.01) throw new Error(`vertex ${i} weights sum to ${s}`);
      }
    }
  }
  const imgs = croot.listTextures().map((t) => t.getMimeType());
  if (imgs.some((m) => m !== 'image/ktx2'))
    throw new Error(`non-KTX2 texture shipped: ${imgs.join(', ')}`);
  const { turn, shift, worst, worstTurn } = drift(before, snapshot(check), restOf(check), dropped);
  if (turn > MAX_TURN || shift > MAX_SHIFT) {
    throw new Error(
      `compression moved the motion: ${turn.toFixed(5)} rad (worst turn: ${worstTurn}), ${shift.toFixed(5)} units (worst shift: ${worst})`,
    );
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log(
    `${path.basename(outPath)}: ${buf.length} bytes, ${clips.length} clips, ${skin.listJoints().length} joints,` +
      ` compression drift ${turn.toFixed(5)} rad / ${shift.toFixed(5)} units`,
  );
}

await main();
