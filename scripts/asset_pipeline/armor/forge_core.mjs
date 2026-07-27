// Armor forge core: glTF math shared by forge.mjs and forge_verify.mjs.
// Two design rules, both bought with pain:
// 1. Armor never crosses skeletons at runtime. Every set is fitted and skinned
//    OFFLINE against the target body and emitted as Armor_<Slot> meshes inside
//    a copy of that body's GLB, the one pattern proven to animate everywhere.
// 2. Never trust stored bind data. These bodies are quantized part-assemblies:
//    every mesh's IBMs fold in a private dequantization transform, so raw
//    POSITION arrays live in per-mesh spaces. All forge math therefore runs in
//    TPOSE CLIP SPACE: joints are posed by the body's own TPose clip (the
//    artist ships one on purpose), body verts are skinned into that space with
//    each mesh's own stored IBMs, and the forged armor skin gets fresh IBMs
//    computed as inverse(T-pose joint worlds). Self-consistent by construction.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

let _io = null;
export function io() {
  if (!_io) {
    _io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  }
  return _io;
}

export async function readDoc(path) {
  return io().read(path);
}

export async function writeDoc(doc, path) {
  await io().write(path, doc);
}

/** Drop the meshopt compression extension so re-writes emit plain buffers. */
export function stripCompression(doc) {
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  }
}

// --- mat4 helpers (column-major, glTF layout) -------------------------------
export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function mat4Invert(m) {
  const inv = new Float32Array(16);
  inv[0] =
    m[5] * m[10] * m[15] -
    m[5] * m[11] * m[14] -
    m[9] * m[6] * m[15] +
    m[9] * m[7] * m[14] +
    m[13] * m[6] * m[11] -
    m[13] * m[7] * m[10];
  inv[4] =
    -m[4] * m[10] * m[15] +
    m[4] * m[11] * m[14] +
    m[8] * m[6] * m[15] -
    m[8] * m[7] * m[14] -
    m[12] * m[6] * m[11] +
    m[12] * m[7] * m[10];
  inv[8] =
    m[4] * m[9] * m[15] -
    m[4] * m[11] * m[13] -
    m[8] * m[5] * m[15] +
    m[8] * m[7] * m[13] +
    m[12] * m[5] * m[11] -
    m[12] * m[7] * m[9];
  inv[12] =
    -m[4] * m[9] * m[14] +
    m[4] * m[10] * m[13] +
    m[8] * m[5] * m[14] -
    m[8] * m[6] * m[13] -
    m[12] * m[5] * m[10] +
    m[12] * m[6] * m[9];
  inv[1] =
    -m[1] * m[10] * m[15] +
    m[1] * m[11] * m[14] +
    m[9] * m[2] * m[15] -
    m[9] * m[3] * m[14] -
    m[13] * m[2] * m[11] +
    m[13] * m[3] * m[10];
  inv[5] =
    m[0] * m[10] * m[15] -
    m[0] * m[11] * m[14] -
    m[8] * m[2] * m[15] +
    m[8] * m[3] * m[14] +
    m[12] * m[2] * m[11] -
    m[12] * m[3] * m[10];
  inv[9] =
    -m[0] * m[9] * m[15] +
    m[0] * m[11] * m[13] +
    m[8] * m[1] * m[15] -
    m[8] * m[3] * m[13] -
    m[12] * m[1] * m[11] +
    m[12] * m[3] * m[9];
  inv[13] =
    m[0] * m[9] * m[14] -
    m[0] * m[10] * m[13] -
    m[8] * m[1] * m[14] +
    m[8] * m[2] * m[13] +
    m[12] * m[1] * m[10] -
    m[12] * m[2] * m[9];
  inv[2] =
    m[1] * m[6] * m[15] -
    m[1] * m[7] * m[14] -
    m[5] * m[2] * m[15] +
    m[5] * m[3] * m[14] +
    m[13] * m[2] * m[7] -
    m[13] * m[3] * m[6];
  inv[6] =
    -m[0] * m[6] * m[15] +
    m[0] * m[7] * m[14] +
    m[4] * m[2] * m[15] -
    m[4] * m[3] * m[14] -
    m[12] * m[2] * m[7] +
    m[12] * m[3] * m[6];
  inv[10] =
    m[0] * m[5] * m[15] -
    m[0] * m[7] * m[13] -
    m[4] * m[1] * m[15] +
    m[4] * m[3] * m[13] +
    m[12] * m[1] * m[7] -
    m[12] * m[3] * m[5];
  inv[14] =
    -m[0] * m[5] * m[14] +
    m[0] * m[6] * m[13] +
    m[4] * m[1] * m[14] -
    m[4] * m[2] * m[13] -
    m[12] * m[1] * m[6] +
    m[12] * m[2] * m[5];
  inv[3] =
    -m[1] * m[6] * m[11] +
    m[1] * m[7] * m[10] +
    m[5] * m[2] * m[11] -
    m[5] * m[3] * m[10] -
    m[9] * m[2] * m[7] +
    m[9] * m[3] * m[6];
  inv[7] =
    m[0] * m[6] * m[11] -
    m[0] * m[7] * m[10] -
    m[4] * m[2] * m[11] +
    m[4] * m[3] * m[10] +
    m[8] * m[2] * m[7] -
    m[8] * m[3] * m[6];
  inv[11] =
    -m[0] * m[5] * m[11] +
    m[0] * m[7] * m[9] +
    m[4] * m[1] * m[11] -
    m[4] * m[3] * m[9] -
    m[8] * m[1] * m[7] +
    m[8] * m[3] * m[5];
  inv[15] =
    m[0] * m[5] * m[10] -
    m[0] * m[6] * m[9] -
    m[4] * m[1] * m[10] +
    m[4] * m[2] * m[9] +
    m[8] * m[1] * m[6] -
    m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (Math.abs(det) < 1e-12) return mat4Identity();
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

export function mat4TransformPoint(m, p, out = [0, 0, 0]) {
  const [x, y, z] = p;
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

export function mat4FromTRS(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  const [sx, sy, sz] = s;
  return new Float32Array([
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    t[0],
    t[1],
    t[2],
    1,
  ]);
}

// --- animation sampling (shared with the verify gate) -----------------------
/** Materialize an accessor as real floats. getArray() returns RAW storage, so
 *  quantized (normalized integer) accessors, common in meshopt-compressed
 *  bodies, come out as garbage ints unless denormalized element by element. */
export function accessorToFloats(acc) {
  const arr = acc.getArray();
  if ((arr instanceof Float32Array || arr instanceof Float64Array) && !acc.getNormalized()) {
    return arr;
  }
  const size = acc.getElementSize();
  const count = acc.getCount();
  const out = new Float32Array(count * size);
  const el = new Array(size).fill(0);
  for (let i = 0; i < count; i++) {
    acc.getElement(i, el);
    out.set(el, i * size);
  }
  return out;
}

export function slerp(a, b, t) {
  const [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    const out = [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, aw + (bw - aw) * t];
    const l = Math.hypot(...out) || 1;
    return out.map((v) => v / l);
  }
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb];
}

function sliceValue(values, index, size, interpolation) {
  // CUBICSPLINE stores in-tangent, value, out-tangent triplets; take the value.
  const stride = interpolation === 'CUBICSPLINE' ? size * 3 : size;
  const offset = interpolation === 'CUBICSPLINE' ? index * stride + size : index * stride;
  return [...values.slice(offset, offset + size)];
}

export function sampleChannel(times, values, size, interpolation, t) {
  const n = times.length;
  if (n === 1 || t <= times[0]) return sliceValue(values, 0, size, interpolation);
  if (t >= times[n - 1]) return sliceValue(values, n - 1, size, interpolation);
  let hi = 1;
  while (times[hi] < t) hi += 1;
  const lo = hi - 1;
  const span = times[hi] - times[lo] || 1e-9;
  const alpha = (t - times[lo]) / span;
  if (interpolation === 'STEP') return sliceValue(values, lo, size, interpolation);
  const a = sliceValue(values, lo, size, interpolation);
  const b = sliceValue(values, hi, size, interpolation);
  if (size === 4) return slerp(a, b, alpha);
  return a.map((v, i) => v + (b[i] - v) * alpha);
}

// Quaternion helpers (x, y, z, w) for the synthetic T-pose.
function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

function quatFromUnitVectors(from, to) {
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (dot > 0.99999) return [0, 0, 0, 1];
  if (dot < -0.99999) {
    // Opposite: rotate 180 degrees about any perpendicular axis.
    let axis = [1, 0, 0];
    if (Math.abs(from[0]) > 0.9) axis = [0, 1, 0];
    const c = cross(from, axis);
    const l = Math.hypot(...c) || 1;
    return [c[0] / l, c[1] / l, c[2] / l, 0];
  }
  const c = cross(from, to);
  const q = [c[0], c[1], c[2], 1 + dot];
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Rotation part of a world matrix as a unit quaternion (scale-normalized). */
function quatFromMat4(m) {
  const cols = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ].map((c) => {
    const l = Math.hypot(...c) || 1;
    return [c[0] / l, c[1] / l, c[2] / l];
  });
  const [r00, r10, r20] = cols[0];
  const [r01, r11, r21] = cols[1];
  const [r02, r12, r22] = cols[2];
  const trace = r00 + r11 + r22;
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s, s / 4];
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    q = [s / 4, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s];
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    q = [(r01 + r10) / s, s / 4, (r12 + r21) / s, (r02 - r20) / s];
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    q = [(r02 + r20) / s, (r12 + r21) / s, s / 4, (r10 - r01) / s];
  }
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
}

function worldPos(worlds, node) {
  const m = worlds.get(node);
  return [m[12], m[13], m[14]];
}

/** The shipped "TPose" clips are 1-frame copies of the rest pose (arms
 *  hanging), not a real T-pose, so armor authored on true T-pose concepts
 *  cannot be fitted against them. This synthesizes the real thing: straighten
 *  each arm chain (upper arm, then forearm) to run horizontally along +-x,
 *  expressed as local-rotation overrides on top of the base pose. */
// Bone chains retargeted from an artist pose, parent link before child link.
const RETARGET_CHAINS = [
  ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2', 'mixamorigNeck'],
  ['mixamorigNeck', 'mixamorigHead'],
  ['mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand'],
  ['mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand'],
  ['mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot', 'mixamorigLeftToeBase'],
  ['mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot', 'mixamorigRightToeBase'],
];

function normalize3(v) {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
/** Character frame from joint world positions: up = hips to head, lateral =
 *  right leg to left leg, forward completes the basis. Convention-agnostic,
 *  so it normalizes an FBX bind frame against the body's own. */
function characterBasis(posOf) {
  const up = normalize3(sub3(posOf('mixamorigHead'), posOf('mixamorigHips')));
  let lat = normalize3(sub3(posOf('mixamorigLeftUpLeg'), posOf('mixamorigRightUpLeg')));
  const fwd = normalize3(cross3(lat, up));
  lat = normalize3(cross3(up, fwd));
  // Column-major 3x3: columns lat, up, fwd.
  return [lat[0], lat[1], lat[2], up[0], up[1], up[2], fwd[0], fwd[1], fwd[2]];
}
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function mat3MulVec(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}
function mat3TMulVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Retarget an artist pose (bind world positions from tmp/mage_tpose_dump.mjs)
 *  onto this body by BONE DIRECTION, chain by chain: rotate each joint so its
 *  child bone runs the way the artist's does, in a normalized character frame.
 *  Direction-based transfer survives differing local joint frames between the
 *  FBX and GLB exports of the same rig (raw local-rotation transplant does
 *  not: it yaws and slumps the whole pose). Root and translations stay the
 *  body's own. */
export function artistPoseLocals(doc, tree, base, artist) {
  const artistByName = new Map(artist.map((b) => [b.name, b]));
  const nodeByName = new Map();
  for (const node of doc.getRoot().listNodes()) {
    if (!nodeByName.has(node.getName())) nodeByName.set(node.getName(), node);
  }
  const overrides = new Map(base);
  const aPos = (n) => artistByName.get(n)?.world;
  const basisA = characterBasis(aPos);
  const worlds0 = evalWorlds(tree, overrides);
  const bPos = (n) => {
    const node = nodeByName.get(n);
    const m = node ? worlds0.get(node) : null;
    return m ? [m[12], m[13], m[14]] : null;
  };
  const basisB = characterBasis(bPos);
  // Square the root first: some bodies export a YAWED posed frame as rest
  // (the v03 mage does), and the TPose must face the game's +z like every
  // other clip. Rotate the hips by basisB^T so the character frame becomes
  // axis-aligned (lateral=+x, up=+y, forward=+z).
  const hips = nodeByName.get('mixamorigHips');
  if (hips) {
    const b = basisB;
    const fixMat = [b[0], b[3], b[6], 0, b[1], b[4], b[7], 0, b[2], b[5], b[8], 0, 0, 0, 0, 1];
    const fixQ = quatFromMat4(fixMat);
    const parent = tree.parents.get(hips);
    const parentRot = parent ? quatFromMat4(worlds0.get(parent)) : [0, 0, 0, 1];
    const worldRot = quatFromMat4(worlds0.get(hips));
    const newLocal = quatMultiply(quatConjugate(parentRot), quatMultiply(fixQ, worldRot));
    const prev = overrides.get(hips) ?? overrides.get(hips.getName()) ?? {};
    overrides.set(hips, { ...prev, rotation: newLocal });
  }
  // Map an artist-frame world direction into the (now axis-aligned) game
  // frame: identity target basis, so only the artist basis needs undoing.
  const mapDir = (d) => mat3TMulVec(basisA, d);

  for (const chain of RETARGET_CHAINS) {
    for (let i = 0; i < chain.length - 1; i++) {
      const node = nodeByName.get(chain[i]);
      const childNode = nodeByName.get(chain[i + 1]);
      const aj = aPos(chain[i]);
      const ac = aPos(chain[i + 1]);
      if (!node || !childNode || !aj || !ac) continue;
      const target = normalize3(mapDir(sub3(ac, aj)));
      const worlds = evalWorlds(tree, overrides);
      const a = worldPos(worlds, node);
      const b = worldPos(worlds, childNode);
      const cur = normalize3(sub3(b, a));
      const delta = quatFromUnitVectors(cur, target);
      const parent = tree.parents.get(node);
      const parentRot = parent ? quatFromMat4(worlds.get(parent)) : [0, 0, 0, 1];
      const worldRot = quatFromMat4(worlds.get(node));
      const newLocal = quatMultiply(quatConjugate(parentRot), quatMultiply(delta, worldRot));
      const prev = overrides.get(node) ?? overrides.get(node.getName()) ?? {};
      overrides.set(node, { ...prev, rotation: newLocal });
    }
  }
  // Direction alignment cannot carry TWIST, and these exports bake a head
  // turn into the posed rest frame, so the neck and head take their FULL
  // world orientation from the artist bind (both files bind the same
  // authored rig, so bone axes agree and world orientations transplant).
  const ba = basisA;
  const mapMat = [
    ba[0],
    ba[3],
    ba[6],
    0,
    ba[1],
    ba[4],
    ba[7],
    0,
    ba[2],
    ba[5],
    ba[8],
    0,
    0,
    0,
    0,
    1,
  ];
  const mapQ = quatFromMat4(mapMat);
  for (const name of ['mixamorigNeck', 'mixamorigHead']) {
    const node = nodeByName.get(name);
    const aw = artistByName.get(name)?.worldQuat;
    if (!node || !aw) continue;
    const worlds = evalWorlds(tree, overrides);
    const parent = tree.parents.get(node);
    const parentRot = parent ? quatFromMat4(worlds.get(parent)) : [0, 0, 0, 1];
    const target = quatMultiply(mapQ, aw);
    const prev = overrides.get(node) ?? overrides.get(node.getName()) ?? {};
    overrides.set(node, { ...prev, rotation: quatMultiply(quatConjugate(parentRot), target) });
  }
  return overrides;
}

/** Lowest skinned Y of the leg segments in an extracted body: the sole line. */
export function soleY(body) {
  let minY = Infinity;
  for (const name of ['Legs', 'Pants']) {
    const seg = body.segments.get(name);
    if (!seg) continue;
    for (let i = 1; i < seg.positions.length; i += 3) {
      if (seg.positions[i] < minY) minY = seg.positions[i];
    }
  }
  return minY;
}

/** Shift a pose by a world-space dy via the hips translation (expressed in
 *  the hips parent's local frame), used to ground a retargeted T-pose at
 *  soles = 0: the source export's hips height belongs to a crouched action
 *  pose, so straightened legs otherwise push through the floor. */
export function shiftPoseWorldY(doc, tree, locals, dy) {
  const root = doc.getRoot();
  let hips = null;
  for (const node of root.listNodes()) {
    if (node.getName() === 'mixamorigHips') {
      hips = node;
      break;
    }
  }
  if (!hips) return;
  const worlds = evalWorlds(tree, locals);
  const parent = tree.parents.get(hips);
  const inv = parent ? mat4Invert(worlds.get(parent)) : mat4Identity();
  const lx = inv[4] * dy;
  const ly = inv[5] * dy;
  const lz = inv[6] * dy;
  const over = locals.get(hips) ?? locals.get('mixamorigHips') ?? {};
  const t = over.translation ?? hips.getTranslation();
  locals.set(hips, { ...over, translation: [t[0] + lx, t[1] + ly, t[2] + lz] });
}

export function synthesizeTPoseArms(doc, tree, baseOverrides) {
  const root = doc.getRoot();
  const byName = new Map();
  for (const node of root.listNodes()) {
    if (!byName.has(node.getName())) byName.set(node.getName(), node);
  }
  const overrides = new Map(baseOverrides);
  for (const side of ['Left', 'Right']) {
    const xhat = side === 'Left' ? [1, 0, 0] : [-1, 0, 0];
    for (const [joint, child] of [
      [`mixamorig${side}Arm`, `mixamorig${side}ForeArm`],
      [`mixamorig${side}ForeArm`, `mixamorig${side}Hand`],
    ]) {
      const node = byName.get(joint);
      const childNode = byName.get(child);
      if (!node || !childNode) continue;
      const worlds = evalWorlds(tree, overrides);
      const a = worldPos(worlds, node);
      const b = worldPos(worlds, childNode);
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(...d) || 1;
      const delta = quatFromUnitVectors([d[0] / l, d[1] / l, d[2] / l], xhat);
      const parent = tree.parents.get(node);
      const parentRot = parent ? quatFromMat4(worlds.get(parent)) : [0, 0, 0, 1];
      const worldRot = quatFromMat4(worlds.get(node));
      const newLocal = quatMultiply(quatConjugate(parentRot), quatMultiply(delta, worldRot));
      const prev = overrides.get(node) ?? overrides.get(node.getName()) ?? {};
      overrides.set(node, { ...prev, rotation: newLocal });
    }
  }
  return overrides;
}

/** Walk the default scene; returns nodes in parent-before-child order plus a
 *  parent map. */
export function hierarchy(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const parents = new Map();
  const order = [];
  const visit = (node, parent) => {
    parents.set(node, parent);
    order.push(node);
    for (const child of node.listChildren()) visit(child, node);
  };
  for (const child of scene.listChildren()) visit(child, null);
  return { order, parents };
}

/** Sample every channel of a clip at time t: Map(node -> {translation?,
 *  rotation?, scale?}). */
export function samplePose(anim, t) {
  const overrides = new Map();
  for (const ch of anim.listChannels()) {
    const target = ch.getTargetNode();
    const sampler = ch.getSampler();
    const path = ch.getTargetPath();
    if (!target || !sampler || path === 'weights') continue;
    const size = path === 'rotation' ? 4 : 3;
    const v = sampleChannel(
      accessorToFloats(sampler.getInput()),
      accessorToFloats(sampler.getOutput()),
      size,
      sampler.getInterpolation(),
      t,
    );
    let e = overrides.get(target);
    if (!e) {
      e = {};
      overrides.set(target, e);
    }
    e[path] = v;
  }
  return overrides;
}

export const POSE_CLIP_NAMES = ['TPose', 'T-Pose', 'T_Pose'];

/** Replace the shipped TPose clip (a mislabeled rest-pose snapshot) with the
 *  REAL synthesized T-pose as a 1-key STEP clip covering every joint, so the
 *  clip named TPose finally shows a T-pose in any viewer. */
export function writeTPoseClip(doc, tree, overrides) {
  const root = doc.getRoot();
  for (const anim of [...root.listAnimations()]) {
    if (!POSE_CLIP_NAMES.includes(anim.getName())) continue;
    for (const ch of [...anim.listChannels()]) {
      const sampler = ch.getSampler();
      ch.dispose();
      sampler?.dispose();
    }
    anim.dispose();
  }
  const joints = new Set();
  for (const skin of root.listSkins()) for (const j of skin.listJoints()) joints.add(j);
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const anim = doc.createAnimation('TPose');
  // Two identical keys, not one: a zero-duration clip samples only at exactly
  // t=0, so three.js live playback (which advances time immediately) never
  // shows the pose. One second of held pose loops cleanly everywhere.
  const input = doc
    .createAccessor('tpose_time')
    .setType('SCALAR')
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  for (const node of joints) {
    const over = overrides.get(node) ?? overrides.get(node.getName()) ?? {};
    const full = {
      translation: over.translation ?? node.getTranslation(),
      rotation: over.rotation ?? node.getRotation(),
      scale: over.scale ?? node.getScale(),
    };
    for (const path of ['translation', 'rotation', 'scale']) {
      const out = doc
        .createAccessor()
        .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
        .setArray(new Float32Array([...full[path], ...full[path]]))
        .setBuffer(buffer);
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(out)
        .setInterpolation('STEP');
      const channel = doc
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath(path)
        .setSampler(sampler);
      anim.addSampler(sampler);
      anim.addChannel(channel);
    }
  }
}

/** World matrices for every node with per-node TRS overrides applied. */
export function evalWorlds({ order, parents }, overrides = new Map()) {
  const worlds = new Map();
  for (const node of order) {
    const over = overrides.get(node) ?? overrides.get(node.getName()) ?? {};
    const local = mat4FromTRS(
      over.translation ?? node.getTranslation(),
      over.rotation ?? node.getRotation(),
      over.scale ?? node.getScale(),
    );
    const parent = parents.get(node);
    worlds.set(node, parent ? mat4Multiply(worlds.get(parent), local) : local);
  }
  return worlds;
}

// --- slot vocabulary --------------------------------------------------------
export const SLOTS = ['Helm', 'Shoulders', 'Torso', 'Arms', 'Legs'];
const SLOT_ALIASES = {
  helm: 'Helm',
  helmet: 'Helm',
  head: 'Helm',
  hat: 'Helm',
  mask: 'Helm',
  shoulders: 'Shoulders',
  shoulder: 'Shoulders',
  pauldrons: 'Shoulders',
  torso: 'Torso',
  chest: 'Torso',
  breastplate: 'Torso',
  body: 'Torso',
  arms: 'Arms',
  bracers: 'Arms',
  gauntlets: 'Arms',
  gloves: 'Arms',
  legs: 'Legs',
  pants: 'Legs',
  greaves: 'Legs',
  boots: 'Legs',
};
export function slotForName(name) {
  const clean = name
    .replace(/^(Set_|Armor_)/, '')
    .replace(/[._]\d+$/, '')
    .toLowerCase();
  return SLOT_ALIASES[clean] ?? null;
}

// Which body segment meshes feed each slot's weight transfer, in priority
// order; the first list whose segments exist on the body wins.
const SLOT_WEIGHT_SOURCES = {
  Helm: [['Head']],
  Shoulders: [['Shoulders'], ['Torso']],
  Torso: [['Torso']],
  Arms: [['Arms']],
  Legs: [['Legs'], ['Pants']],
};
// The body segment a forged piece is compared against by the verify gate.
export const SLOT_VERIFY_SEGMENT = {
  Helm: ['Head'],
  Shoulders: ['Shoulders', 'Torso'],
  Torso: ['Torso'],
  Arms: ['Arms'],
  Legs: ['Legs', 'Pants'],
};
const BODY_SEGMENT_NAMES = new Set(['Head', 'Torso', 'Arms', 'Shoulders', 'Legs', 'Pants']);

// --- body extraction --------------------------------------------------------
/** Merge duplicate same-named joint nodes (co-located exporter copies): every
 *  skin joint and animation channel is re-pointed at the first node seen for
 *  each name, stray children are reparented, and the copies are removed. */
export function dedupeJoints(doc) {
  const root = doc.getRoot();
  const jointNames = new Set();
  for (const skin of root.listSkins())
    for (const j of skin.listJoints()) jointNames.add(j.getName());
  const keeper = new Map();
  const dups = [];
  const visit = (node) => {
    const name = node.getName();
    if (jointNames.has(name)) {
      if (!keeper.has(name)) keeper.set(name, node);
      else if (keeper.get(name) !== node) dups.push(node);
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of root.listScenes()) for (const child of scene.listChildren()) visit(child);
  if (!dups.length) return 0;
  const dupSet = new Set(dups);
  for (const skin of root.listSkins()) {
    // Joint ORDER pairs with IBM rows and vertex JOINTS_0 indices by position,
    // so substitute dups IN PLACE. A naive removeJoint+addJoint appends the
    // keeper at the END, shifting every later index and silently scrambling
    // the bind (the shaman v03 cooked-arms bug).
    const joints = skin.listJoints();
    if (joints.some((j) => dupSet.has(j))) {
      const ordered = joints.map((j) => (dupSet.has(j) ? keeper.get(j.getName()) : j));
      for (const j of joints) skin.removeJoint(j);
      for (const j of ordered) skin.addJoint(j);
      const after = skin.listJoints();
      if (after.length !== ordered.length || after.some((j, i) => j !== ordered[i])) {
        throw new Error(
          `dedupeJoints: joint order not preserved for skin '${skin.getName()}' (` +
            `${after.length} vs ${ordered.length}); refusing to emit a scrambled bind`,
        );
      }
    }
    const skel = skin.getSkeleton();
    if (skel && dupSet.has(skel)) skin.setSkeleton(keeper.get(skel.getName()));
  }
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const target = ch.getTargetNode();
      if (target && dupSet.has(target)) ch.setTargetNode(keeper.get(target.getName()));
    }
  }
  for (const dup of dups) {
    for (const child of [...dup.listChildren()]) {
      if (!dupSet.has(child)) keeper.get(dup.getName()).addChild(child);
    }
  }
  for (const dup of dups) dup.dispose();
  return dups.length;
}

const POSE_CLIPS = ['TPose', 'T-Pose', 'T_Pose'];

/** Extract everything the forge needs from a body document, all in T-pose
 *  clip space. `poseDonor` (Map of joint name -> local TRS override) covers
 *  bodies shipped without their own TPose clip; `poseSource` reports which
 *  path was used. */
export function extractBody(doc, { poseDonor = null, synthArms = true } = {}) {
  const root = doc.getRoot();
  const tree = hierarchy(doc);

  let overrides = new Map();
  let poseSource = 'rest';
  const poseClip = root.listAnimations().find((a) => POSE_CLIPS.includes(a.getName()));
  if (poseClip) {
    overrides = samplePose(poseClip, 0);
    poseSource = `clip:${poseClip.getName()}`;
  } else if (poseDonor) {
    overrides = poseDonor;
    poseSource = 'donor';
  }
  // The shipped pose clips are rest-pose snapshots (arms hanging), so force a
  // real T-pose by straightening the arm chains; a no-op when already flat.
  // synthArms=false keeps the RAW clip pose: whole-set fitting must happen in
  // the exact pose viewers render (the clip), or sleeves fitted to synthetic
  // straight arms float off the clip's slightly drooped arms.
  if (synthArms) {
    overrides = synthesizeTPoseArms(doc, tree, overrides);
    poseSource += '+synthT';
  }
  const worlds = evalWorlds(tree, overrides);

  const jointInfo = new Map(); // name -> { node }
  for (const skin of root.listSkins()) {
    for (const j of skin.listJoints()) {
      if (!jointInfo.has(j.getName())) jointInfo.set(j.getName(), { node: j });
    }
  }
  const jointOrder = [...jointInfo.keys()].sort();
  const jointIndex = new Map(jointOrder.map((n, i) => [n, i]));
  const bindPos = new Map();
  const myIbm = new Map();
  for (const [name, info] of jointInfo) {
    const w = worlds.get(info.node);
    bindPos.set(name, [w[12], w[13], w[14]]);
    myIbm.set(name, mat4Invert(w));
  }

  // Export the pose as name-keyed local TRS so another body can borrow it.
  const poseLocals = new Map();
  for (const [node, over] of overrides) {
    const name = typeof node === 'string' ? node : node.getName();
    poseLocals.set(name, over);
  }

  // Segments: canonical body meshes, verts skinned into T-pose space with each
  // mesh's OWN stored IBMs (the only correct way out of per-mesh quant space).
  const segments = new Map();
  const meshNames = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName() || mesh.getName();
    meshNames.push(name);
    // Hair cosmetics ride along as segments: the hat fit seats the brim on
    // top of the hair, not the bare scalp.
    if (!BODY_SEGMENT_NAMES.has(name) && !/^Head_(Male|Female)_Hair/.test(name)) continue;
    const skin = node.getSkin();
    if (!skin) continue;
    const joints = skin.listJoints();
    const ibmArr = accessorToFloats(skin.getInverseBindMatrices());
    const skinMats = joints.map((j, i) =>
      mat4Multiply(worlds.get(j), ibmArr.slice(i * 16, i * 16 + 16)),
    );
    const canonical = joints.map((j) => jointIndex.get(j.getName()) ?? 0);
    let total = 0;
    const parts = [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const jAcc = prim.getAttribute('JOINTS_0');
      const wAcc = prim.getAttribute('WEIGHTS_0');
      if (!pos || !jAcc || !wAcc) continue;
      parts.push({ pos, jAcc, wAcc, count: pos.getCount() });
      total += pos.getCount();
    }
    const positions = new Float32Array(total * 3);
    const inflJ = new Uint16Array(total * 4);
    const inflW = new Float32Array(total * 4);
    let off = 0;
    const pv = [0, 0, 0];
    const jv = [0, 0, 0, 0];
    const wv = [0, 0, 0, 0];
    for (const part of parts) {
      for (let i = 0; i < part.count; i++) {
        part.pos.getElement(i, pv);
        part.jAcc.getElement(i, jv);
        part.wAcc.getElement(i, wv);
        let x = 0;
        let y = 0;
        let z = 0;
        for (let k = 0; k < 4; k++) {
          const w = wv[k];
          if (w <= 1e-6) continue;
          const m = skinMats[jv[k]];
          x += w * (m[0] * pv[0] + m[4] * pv[1] + m[8] * pv[2] + m[12]);
          y += w * (m[1] * pv[0] + m[5] * pv[1] + m[9] * pv[2] + m[13]);
          z += w * (m[2] * pv[0] + m[6] * pv[1] + m[10] * pv[2] + m[14]);
        }
        const vi = off + i;
        positions[vi * 3] = x;
        positions[vi * 3 + 1] = y;
        positions[vi * 3 + 2] = z;
        for (let k = 0; k < 4; k++) {
          inflJ[vi * 4 + k] = canonical[jv[k]] ?? 0;
          inflW[vi * 4 + k] = wv[k];
        }
      }
      off += part.count;
    }
    segments.set(name, { positions, inflJ, inflW });
  }
  return {
    doc,
    jointInfo,
    jointOrder,
    jointIndex,
    bindPos,
    myIbm,
    segments,
    meshNames,
    poseSource,
    poseLocals,
  };
}

// --- armor source extraction ------------------------------------------------
/** Read a static armor GLB: bake node world transforms into vertices and
 *  classify each mesh into a slot by name. */
export function extractArmor(doc, { forceSlot = null } = {}) {
  const root = doc.getRoot();
  const worlds = evalWorlds(hierarchy(doc));
  const pieces = new Map();
  const unknown = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName() || mesh.getName();
    const slot = forceSlot ?? slotForName(name);
    if (!slot) {
      unknown.push(name);
      continue;
    }
    const world = worlds.get(node) ?? mat4Identity();
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      if (!posAcc) continue;
      const count = posAcc.getCount();
      const positions = new Float32Array(count * 3);
      const pv = [0, 0, 0];
      const out = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        posAcc.getElement(i, pv);
        mat4TransformPoint(world, pv, out);
        positions.set(out, i * 3);
      }
      const normals = readVec(prim.getAttribute('NORMAL'), count, 3);
      const uvs = readVec(prim.getAttribute('TEXCOORD_0'), count, 2);
      const idxAcc = prim.getIndices();
      const indices = idxAcc ? new Uint32Array(idxAcc.getArray()) : null;
      // Capture the base color per prim: a set plus a separate hat GLB carry
      // two different atlases, so the emit builds one material per image.
      const material = prim.getMaterial();
      const baseTex = material?.getBaseColorTexture();
      const ghost = {
        alphaMode: material?.getAlphaMode() ?? 'OPAQUE',
        alphaCutoff: material?.getAlphaCutoff() ?? 0.5,
        doubleSided: material?.getDoubleSided() ?? false,
        emissiveFactor: material?.getEmissiveFactor() ?? [0, 0, 0],
        emissiveUsesBaseTex:
          !!material?.getEmissiveTexture() && material.getEmissiveTexture() === baseTex,
      };
      const tex = {
        ...ghost,
        image: baseTex?.getImage() ?? null,
        mimeType: baseTex?.getMimeType() || 'image/png',
        factor: material?.getBaseColorFactor() ?? [1, 1, 1, 1],
      };
      if (!pieces.has(slot)) pieces.set(slot, []);
      pieces.get(slot).push({ positions, normals, uvs, indices, material, tex, srcName: name });
    }
  }
  return { pieces, unknown };
}

function readVec(acc, count, size) {
  if (!acc) return null;
  const out = new Float32Array(count * size);
  const v = new Array(size).fill(0);
  for (let i = 0; i < count; i++) {
    acc.getElement(i, v);
    out.set(v, i * size);
  }
  return out;
}

// --- fit --------------------------------------------------------------------
// Per-slot fit rules: which body segments the piece wraps, which axes size it,
// how much shell clearance it gets, and how it seats vertically. This makes
// the fit source-agnostic: a unit-box-normalized Tripo export and a rig-scale
// artist export land identically, because each piece is measured against the
// real body segment it covers.
const SLOT_FIT = {
  Helm: { targets: [['Head']], axes: [0, 2], shell: 1.12, yMode: 'top', yPad: 0.015 },
  // Pauldrons CAP the shoulder: each side is seated on its arm joint, lifted
  // so the piece crowns the joint instead of swallowing the upper arm.
  Shoulders: {
    targets: [['Shoulders'], ['Torso']],
    axes: [0],
    shell: 1.2,
    mode: 'sideJoints',
    lift: 0.08,
  },
  Torso: { targets: [['Torso']], axes: [0, 1], shell: 1.18, yMode: 'center', yPad: 0 },
  Arms: { mode: 'bones' },
  // Greaves span the real leg exactly, waist to sole, so boots plant on the
  // ground instead of floating at bbox-ratio height.
  Legs: { targets: [['Legs'], ['Pants']], mode: 'span', shellXZ: 1.1, yDrop: 0.006 },
};
// Caster helms are HATS: a big tilted wizard hat riding on TOP of the hair
// (face, beard, and hair all stay visible) instead of enclosing the head like
// a great helm. The fit target is the union of Head + every hair style, so
// the brim clears the tallest hair; crownSink drops the brim into the hair so
// no gap shows, and tilt/pitch give the classic jaunty silhouette.
const HAT_FIT = {
  targets: [['Head']],
  includeHair: true,
  axes: [0, 2],
  shell: 1.55,
  yMode: 'crown',
  crownSink: 0.68,
  yPad: 0,
  pitchDeg: -12,
  tiltDeg: 8,
  forwardFrac: 0.25,
};
// A face MASK sits flat on the FRONT of the face (ritual/druid style): sized
// to the face width, centered on the face, its back plane seated just off the
// head's front surface. Head, hair, and beard all stay visible around it.
const MASK_FIT = {
  targets: [['Head']],
  axes: [0],
  shell: 1.04,
  yMode: 'faceFront',
  yPad: -0.008,
  faceGap: 0.006,
};

/** Tilt a piece in source space: pitch about X (front-back, negative raises
 *  the +z front) then roll about Z (side lean), around the piece center, so
 *  all downstream bounds/scale/seat math uses the tilted shape. Normals get
 *  the same rotation. */
function rotateTilt(positions, normals, center, rule) {
  const px = ((rule.pitchDeg ?? 0) * Math.PI) / 180;
  const rz = ((rule.tiltDeg ?? 0) * Math.PI) / 180;
  const cx = Math.cos(px);
  const sx = Math.sin(px);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const rot = (v) => {
    const [x, y, z] = v;
    let y2 = y * cx - z * sx;
    const z2 = y * sx + z * cx;
    const x2 = x * cz - y2 * sz;
    y2 = x * sz + y2 * cz;
    return [x2, y2, z2];
  };
  const outP = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const r = rot([
      positions[i] - center[0],
      positions[i + 1] - center[1],
      positions[i + 2] - center[2],
    ]);
    outP[i] = r[0] + center[0];
    outP[i + 1] = r[1] + center[1];
    outP[i + 2] = r[2] + center[2];
  }
  let outN = null;
  if (normals) {
    outN = new Float32Array(normals.length);
    for (let i = 0; i < normals.length; i += 3) {
      const r = rot([normals[i], normals[i + 1], normals[i + 2]]);
      outN[i] = r[0];
      outN[i + 1] = r[1];
      outN[i + 2] = r[2];
    }
  }
  return { positions: outP, normals: outN };
}

function boundsOf(arrays) {
  const min = [1e9, 1e9, 1e9];
  const max = [-1e9, -1e9, -1e9];
  for (const positions of arrays) {
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[i + k]);
        max[k] = Math.max(max[k], positions[i + k]);
      }
    }
  }
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

/** Arms are fitted per SIDE directly onto the forearm bone line (the only
 *  robust reference: baggy sleeves make bbox math lie): length maps the
 *  bracer onto elbow-to-past-wrist, girth maps its radius onto the arm's
 *  real radial thickness measured from forearm-weighted body verts. Assumes
 *  synth-T space where both forearms run along +-x. */
function fitArmsToBones(parts, body, nudge, { overlay = false } = {}) {
  const ns = nudge.s ?? 1;
  const nd = nudge.d ?? [0, 0, 0];
  const armsSeg = body.segments.get('Arms');
  const sides = {};
  for (const side of ['Left', 'Right']) {
    const F = body.bindPos.get(`mixamorig${side}Arm`);
    const H = body.bindPos.get(`mixamorig${side}Hand`);
    if (!F || !H) throw new Error(`fit: missing ${side} arm joints`);
    const d = [H[0] - F[0], H[1] - F[1], H[2] - F[2]];
    const len = Math.hypot(...d) || 1e-3;
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    // Radial thickness of the whole real arm (mean perpendicular distance
    // from the shoulder-to-hand line) and the true fingertip reach along it:
    // the glove tip must land exactly where the body's mitt ends, so a held
    // weapon at the hand bone sits inside the visible fist.
    let radial = 0.03;
    let reach = len * 1.3;
    if (armsSeg) {
      let sum = 0;
      let n = 0;
      const count = armsSeg.positions.length / 3;
      for (let i = 0; i < count; i++) {
        const sameSide =
          side === 'Left' ? armsSeg.positions[i * 3] >= 0 : armsSeg.positions[i * 3] < 0;
        if (!sameSide) continue;
        const px = armsSeg.positions[i * 3] - F[0];
        const py = armsSeg.positions[i * 3 + 1] - F[1];
        const pz = armsSeg.positions[i * 3 + 2] - F[2];
        const t = px * dir[0] + py * dir[1] + pz * dir[2];
        if (t < -0.05 || t > len * 2.2) continue;
        reach = Math.max(reach, t);
        const rx = px - dir[0] * t;
        const ry = py - dir[1] * t;
        const rz = pz - dir[2] * t;
        sum += Math.hypot(rx, ry, rz);
        n += 1;
      }
      if (n >= 8) radial = sum / n;
    }
    sides[side] = { F, dir, len, radial, reach };
  }
  const report = {};
  const outParts = parts.map((part) => {
    const src = part.positions;
    const count = src.length / 3;
    // Split the piece's verts by authored side (left bracer at +x).
    const stats = {
      Left: { min: 1e9, max: -1e9, cy: 0, cz: 0, r: 0, n: 0 },
      Right: { min: 1e9, max: -1e9, cy: 0, cz: 0, r: 0, n: 0 },
    };
    const sideOf = (x) => (x >= 0 ? 'Left' : 'Right');
    for (let i = 0; i < count; i++) {
      const s = stats[sideOf(src[i * 3])];
      s.min = Math.min(s.min, src[i * 3]);
      s.max = Math.max(s.max, src[i * 3]);
      s.cy += src[i * 3 + 1];
      s.cz += src[i * 3 + 2];
      s.n += 1;
    }
    for (const s of Object.values(stats)) {
      if (s.n) {
        s.cy /= s.n;
        s.cz /= s.n;
      }
    }
    for (let i = 0; i < count; i++) {
      const s = stats[sideOf(src[i * 3])];
      s.r += Math.hypot(src[i * 3 + 1] - s.cy, src[i * 3 + 2] - s.cz);
    }
    for (const s of Object.values(stats)) if (s.n) s.r /= s.n;

    const positions = new Float32Array(src.length);
    for (let i = 0; i < count; i++) {
      const side = sideOf(src[i * 3]);
      const a = stats[side];
      const b = sides[side];
      const authorLen = Math.max(a.max - a.min, 1e-4);
      // The sleeve covers the whole arm: shoulder to the body's fingertip.
      // Overlay sleeves (sets whose Arms piece has no hand geometry) stop
      // just past the wrist and wrap OVER the visible body arm instead, so
      // the body's own hands poke out of the cuff.
      const reach = overlay ? b.len * 1.12 : b.reach * 1.02;
      const sx = (reach / authorLen) * ns;
      const syz = ((b.radial * (overlay ? 1.24 : 1.18)) / Math.max(a.r, 1e-4)) * ns;
      const along = (side === 'Left' ? src[i * 3] - a.min : a.max - src[i * 3]) * sx - b.len * 0.04;
      const ry = (src[i * 3 + 1] - a.cy) * syz;
      const rz = (src[i * 3 + 2] - a.cz) * syz;
      positions[i * 3] = b.F[0] + b.dir[0] * along + nd[0];
      positions[i * 3 + 1] = b.F[1] + b.dir[1] * along + ry + nd[1];
      positions[i * 3 + 2] = b.F[2] + b.dir[2] * along + rz + nd[2];
      report[side] = { scale: Math.round(sx * 1e3) / 1e3, girth: Math.round(syz * 1e3) / 1e3 };
    }
    return { ...part, positions };
  });
  return { outParts, report };
}

/** Fit each armor piece directly onto the body segment it covers: uniform
 *  scale from the segment-to-piece size ratio on the slot's sizing axes, then
 *  a slot-specific vertical seat (helm collars the head bottom, greaves hang
 *  from the waist, bracers wrap the forearm line). Optional per-slot nudges:
 *  { Helm: { d: [x,y,z], s: 1.0 } }. */
/** WHOLE-SET fit: the suit was authored as ONE connected outfit (helm collar
 *  meets torso, torso hem meets belt, sleeves meet arm holes), so move it as a
 *  single rigid unit and every authored seam survives by construction. Anchor:
 *  the Torso piece maps onto the body's Torso segment (geomean x/y ratio x a
 *  worn-over shell), the whole suit follows, then the boots are planted on the
 *  body's sole height. Per-slot nudges still layer on top for fine tuning
 *  (d verbatim; s about the piece's own center). Use for artist suits authored
 *  around the class body; the per-slot mode remains for grab-bag sets. */
function fitWhole(pieces, body, nudges = {}, opts = {}) {
  const torsoParts = pieces.get('Torso');
  if (!torsoParts) throw new Error('whole fit needs a Torso piece as the anchor');
  const seg = body.segments.get('Torso');
  if (!seg) throw new Error('whole fit: body has no Torso segment');
  const torsoBox = boundsOf(torsoParts.map((p) => p.positions));
  const segBox = boundsOf([seg.positions]);
  // SIZE from overall HEIGHT: the suit is a full figure (helm crest to boot
  // soles), so map its height onto the body's full height (head top to sole,
  // hair excluded since it is not a segment) with a small crest allowance.
  // Anchoring size on the small Torso chest piece inflated the whole suit ~30%
  // (user round: "way bigger than the base model").
  const suitBox = boundsOf([...pieces.values()].flat().map((p) => p.positions));
  let bodyMinY = Infinity;
  let bodyMaxY = -Infinity;
  for (const bodySeg of body.segments.values()) {
    for (let i = 1; i < bodySeg.positions.length; i += 3) {
      const y = bodySeg.positions[i];
      if (y < bodyMinY) bodyMinY = y;
      if (y > bodyMaxY) bodyMaxY = y;
    }
  }
  const s = ((bodyMaxY - bodyMinY) * (opts.wholeHeight ?? 1.04)) / Math.max(suitBox.size[1], 1e-4);
  const fitted = new Map();
  for (const [slot, parts] of pieces) {
    fitted.set(
      slot,
      parts.map((part) => {
        const positions = new Float32Array(part.positions.length);
        for (let i = 0; i < part.positions.length; i += 3) {
          positions[i] = (part.positions[i] - torsoBox.center[0]) * s + segBox.center[0];
          positions[i + 1] = (part.positions[i + 1] - torsoBox.center[1]) * s + segBox.center[1];
          positions[i + 2] = (part.positions[i + 2] - torsoBox.center[2]) * s + segBox.center[2];
        }
        return { ...part, positions };
      }),
    );
  }
  // Sleeves: rigid placement leaves the suit's authored straight-out sleeves
  // wherever the artist drew them; the BODY's clip-pose arms droop slightly.
  // Aim each side's sleeve at the body's actual shoulder-to-hand direction
  // (rotation about the shoulder joint, so the arm-hole seam stays put), then
  // map its length onto the arm's real fingertip reach along that direction.
  const armsParts = fitted.get('Arms');
  const armsSeg = body.segments.get('Arms');
  if (armsParts && armsSeg) {
    for (const side of ['Left', 'Right']) {
      const S = body.bindPos.get(`mixamorig${side}Arm`);
      const H = body.bindPos.get(`mixamorig${side}Hand`);
      if (!S || !H) continue;
      const dir = [H[0] - S[0], H[1] - S[1], H[2] - S[2]];
      const dlen = Math.hypot(...dir) || 1;
      dir[0] /= dlen;
      dir[1] /= dlen;
      dir[2] /= dlen;
      const a = [side === 'Left' ? 1 : -1, 0, 0];
      const axis = [
        a[1] * dir[2] - a[2] * dir[1],
        a[2] * dir[0] - a[0] * dir[2],
        a[0] * dir[1] - a[1] * dir[0],
      ];
      const sinA = Math.hypot(...axis);
      const cosA = a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2];
      const k = sinA > 1e-6 ? axis.map((v) => v / sinA) : [0, 0, 1];
      const rot = (x, y, z) => {
        if (sinA <= 1e-6) return [x, y, z];
        const dotkp = k[0] * x + k[1] * y + k[2] * z;
        return [
          x * cosA + (k[1] * z - k[2] * y) * sinA + k[0] * dotkp * (1 - cosA),
          y * cosA + (k[2] * x - k[0] * z) * sinA + k[1] * dotkp * (1 - cosA),
          z * cosA + (k[0] * y - k[1] * x) * sinA + k[2] * dotkp * (1 - cosA),
        ];
      };
      const sameSide = (x) => (side === 'Left' ? x >= 0 : x < 0);
      let reach = 0;
      for (let i = 0; i < armsSeg.positions.length; i += 3) {
        if (!sameSide(armsSeg.positions[i])) continue;
        const t =
          (armsSeg.positions[i] - S[0]) * dir[0] +
          (armsSeg.positions[i + 1] - S[1]) * dir[1] +
          (armsSeg.positions[i + 2] - S[2]) * dir[2];
        reach = Math.max(reach, t);
      }
      let outer = 0;
      for (const part of armsParts) {
        for (let i = 0; i < part.positions.length; i += 3) {
          if (!sameSide(part.positions[i])) continue;
          const r = rot(
            part.positions[i] - S[0],
            part.positions[i + 1] - S[1],
            part.positions[i + 2] - S[2],
          );
          part.positions[i] = r[0] + S[0];
          part.positions[i + 1] = r[1] + S[1];
          part.positions[i + 2] = r[2] + S[2];
          outer = Math.max(outer, r[0] * dir[0] + r[1] * dir[1] + r[2] * dir[2]);
        }
      }
      if (outer > reach && reach > 0) {
        const ks = reach / outer;
        for (const part of armsParts) {
          for (let i = 0; i < part.positions.length; i += 3) {
            if (!sameSide(part.positions[i])) continue;
            const px = part.positions[i] - S[0];
            const py = part.positions[i + 1] - S[1];
            const pz = part.positions[i + 2] - S[2];
            const t = px * dir[0] + py * dir[1] + pz * dir[2];
            if (t <= 0) continue;
            const shift = t * (ks - 1);
            part.positions[i] += dir[0] * shift;
            part.positions[i + 1] += dir[1] * shift;
            part.positions[i + 2] += dir[2] * shift;
          }
        }
      }
    }
  }
  // Plant the suit: boots bottom onto the body's sole height.
  const legs = fitted.get('Legs');
  if (legs) {
    let suitMin = Infinity;
    for (const part of legs)
      for (let i = 1; i < part.positions.length; i += 3)
        suitMin = Math.min(suitMin, part.positions[i]);
    let soleMin = Infinity;
    for (const name of ['Legs', 'Pants']) {
      const bodySeg = body.segments.get(name);
      if (bodySeg)
        for (let i = 1; i < bodySeg.positions.length; i += 3)
          soleMin = Math.min(soleMin, bodySeg.positions[i]);
    }
    if (Number.isFinite(suitMin) && Number.isFinite(soleMin)) {
      const dy = soleMin - suitMin;
      for (const parts of fitted.values())
        for (const part of parts)
          for (let i = 1; i < part.positions.length; i += 3) part.positions[i] += dy;
    }
  }
  const report = { slots: {} };
  for (const [slot, parts] of fitted) {
    const n = nudges[slot];
    if (n) {
      const box = boundsOf(parts.map((p) => p.positions));
      const ns = n.s ?? 1;
      const nd = n.d ?? [0, 0, 0];
      for (const part of parts) {
        for (let i = 0; i < part.positions.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            part.positions[i + k] =
              (part.positions[i + k] - box.center[k]) * ns + box.center[k] + nd[k];
          }
        }
      }
    }
    report.slots[slot] = { scale: Math.round(s * (n?.s ?? 1) * 1e3) / 1e3, seat: ['whole'] };
  }
  return { fitted, report };
}

/** ANCHORED fit: one GLOBAL height-derived scale keeps the suit's authored
 *  size relationships (no per-piece scale distortion), then each piece is
 *  TRANSLATED onto its own body part: helm centered on the head, pauldrons on
 *  the shoulder pads, torso on the chest, sleeves aimed down the real arms,
 *  boots planted. Fixes suits authored on a different frame than the body
 *  (rigid whole-fit inherits their piece offsets; per-slot fit distorts their
 *  proportions). Runs in the RAW clip pose like whole mode. */
function fitAnchored(pieces, body, nudges = {}, opts = {}) {
  const suitBox = boundsOf([...pieces.values()].flat().map((p) => p.positions));
  let bodyMinY = Infinity;
  let bodyMaxY = -Infinity;
  for (const bodySeg of body.segments.values()) {
    for (let i = 1; i < bodySeg.positions.length; i += 3) {
      const y = bodySeg.positions[i];
      if (y < bodyMinY) bodyMinY = y;
      if (y > bodyMaxY) bodyMaxY = y;
    }
  }
  const s = ((bodyMaxY - bodyMinY) * (opts.wholeHeight ?? 1.04)) / Math.max(suitBox.size[1], 1e-4);
  const segBox = (names) => {
    const arrays = [];
    for (const n of names) {
      const seg = body.segments.get(n);
      if (seg) arrays.push(seg.positions);
    }
    return arrays.length ? boundsOf(arrays) : null;
  };
  const fitted = new Map();
  for (const [slot, parts] of pieces) {
    fitted.set(
      slot,
      parts.map((part) => {
        const positions = new Float32Array(part.positions.length);
        for (let i = 0; i < part.positions.length; i += 3) {
          positions[i] = (part.positions[i] - suitBox.center[0]) * s;
          positions[i + 1] = (part.positions[i + 1] - suitBox.center[1]) * s;
          positions[i + 2] = (part.positions[i + 2] - suitBox.center[2]) * s;
        }
        return { ...part, positions };
      }),
    );
  }
  const translate = (parts, d, filter = null) => {
    for (const part of parts) {
      for (let i = 0; i < part.positions.length; i += 3) {
        if (filter && !filter(part.positions[i])) continue;
        part.positions[i] += d[0];
        part.positions[i + 1] += d[1];
        part.positions[i + 2] += d[2];
      }
    }
  };
  const partsBox = (parts, filter = null) => {
    const b = { min: [9e9, 9e9, 9e9], max: [-9e9, -9e9, -9e9] };
    for (const part of parts) {
      for (let i = 0; i < part.positions.length; i += 3) {
        if (filter && !filter(part.positions[i])) continue;
        for (let k = 0; k < 3; k++) {
          b.min[k] = Math.min(b.min[k], part.positions[i + k]);
          b.max[k] = Math.max(b.max[k], part.positions[i + k]);
        }
      }
    }
    b.center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    return b;
  };

  // Helm: center on the head (x/z), crest allowed to poke a little above.
  const helm = fitted.get('Helm');
  const headBox = segBox(['Head']);
  if (helm && headBox) {
    const hb = partsBox(helm);
    translate(helm, [
      headBox.center[0] - hb.center[0],
      headBox.max[1] + 0.09 - hb.max[1],
      headBox.center[2] - hb.center[2],
    ]);
  }
  // Torso: center on the chest segment.
  const torso = fitted.get('Torso');
  const torsoBox = segBox(['Torso']);
  if (torso && torsoBox) {
    const tb = partsBox(torso);
    translate(torso, [
      torsoBox.center[0] - tb.center[0],
      torsoBox.center[1] - tb.center[1],
      torsoBox.center[2] - tb.center[2],
    ]);
  }
  // Legs: center x/z on the hips, soles planted on the body's sole height.
  const legs = fitted.get('Legs');
  const legsBox = segBox(['Legs', 'Pants']);
  if (legs && legsBox) {
    const lb = partsBox(legs);
    translate(legs, [
      legsBox.center[0] - lb.center[0],
      legsBox.min[1] - lb.min[1],
      legsBox.center[2] - lb.center[2],
    ]);
  }
  // Arms: seat each side's inner end at the shoulder joint, then aim down the
  // body's real arm and map length to the fingertip reach (same math as whole
  // mode, but position is anchored instead of inherited). The per-side seating
  // shift is recorded so the pauldrons can ride along (below).
  const sideShift = {};
  const armsParts = fitted.get('Arms');
  const armsSeg = body.segments.get('Arms');
  if (armsParts && armsSeg) {
    for (const side of ['Left', 'Right']) {
      const S = body.bindPos.get(`mixamorig${side}Arm`);
      const H = body.bindPos.get(`mixamorig${side}Hand`);
      if (!S || !H) continue;
      const sideOf = (x) => (side === 'Left' ? x >= 0 : x < 0);
      const sb = partsBox(armsParts, sideOf);
      if (!Number.isFinite(sb.center[0])) continue;
      // inner end = the 15% band nearest the body centerline
      const span = sb.max[0] - sb.min[0];
      const innerBand = (x) =>
        side === 'Left' ? x <= sb.min[0] + span * 0.15 : x >= sb.max[0] - span * 0.15;
      const ib = partsBox(armsParts, (x) => sideOf(x) && innerBand(x));
      const innerCenter = [side === 'Left' ? sb.min[0] : sb.max[0], ib.center[1], ib.center[2]];
      sideShift[side] = [S[0] - innerCenter[0], S[1] - innerCenter[1], S[2] - innerCenter[2]];
      translate(armsParts, sideShift[side], sideOf);
      const dir = [H[0] - S[0], H[1] - S[1], H[2] - S[2]];
      const dlen = Math.hypot(...dir) || 1;
      dir[0] /= dlen;
      dir[1] /= dlen;
      dir[2] /= dlen;
      const a = [side === 'Left' ? 1 : -1, 0, 0];
      const axis = [
        a[1] * dir[2] - a[2] * dir[1],
        a[2] * dir[0] - a[0] * dir[2],
        a[0] * dir[1] - a[1] * dir[0],
      ];
      const sinA = Math.hypot(...axis);
      const cosA = a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2];
      const k = sinA > 1e-6 ? axis.map((v) => v / sinA) : [0, 0, 1];
      let outer = 0;
      for (const part of armsParts) {
        for (let i = 0; i < part.positions.length; i += 3) {
          if (!sideOf(part.positions[i])) continue;
          const px = part.positions[i] - S[0];
          const py = part.positions[i + 1] - S[1];
          const pz = part.positions[i + 2] - S[2];
          let r = [px, py, pz];
          if (sinA > 1e-6) {
            const dotkp = k[0] * px + k[1] * py + k[2] * pz;
            r = [
              px * cosA + (k[1] * pz - k[2] * py) * sinA + k[0] * dotkp * (1 - cosA),
              py * cosA + (k[2] * px - k[0] * pz) * sinA + k[1] * dotkp * (1 - cosA),
              pz * cosA + (k[0] * py - k[1] * px) * sinA + k[2] * dotkp * (1 - cosA),
            ];
          }
          part.positions[i] = r[0] + S[0];
          part.positions[i + 1] = r[1] + S[1];
          part.positions[i + 2] = r[2] + S[2];
          outer = Math.max(outer, r[0] * dir[0] + r[1] * dir[1] + r[2] * dir[2]);
        }
      }
      let reach = 0;
      for (let i = 0; i < armsSeg.positions.length; i += 3) {
        if (!sideOf(armsSeg.positions[i])) continue;
        const t =
          (armsSeg.positions[i] - S[0]) * dir[0] +
          (armsSeg.positions[i + 1] - S[1]) * dir[1] +
          (armsSeg.positions[i + 2] - S[2]) * dir[2];
        reach = Math.max(reach, t);
      }
      if (outer > reach && reach > 0) {
        const ks = reach / outer;
        for (const part of armsParts) {
          for (let i = 0; i < part.positions.length; i += 3) {
            if (!sideOf(part.positions[i])) continue;
            const px = part.positions[i] - S[0];
            const py = part.positions[i + 1] - S[1];
            const pz = part.positions[i + 2] - S[2];
            const t = px * dir[0] + py * dir[1] + pz * dir[2];
            if (t <= 0) continue;
            const shift = t * (ks - 1);
            part.positions[i] += dir[0] * shift;
            part.positions[i + 1] += dir[1] * shift;
            part.positions[i + 2] += dir[2] * shift;
          }
        }
      }
    }
  }
  // Pauldrons: ride the SAME per-side shift that seated the sleeves at the
  // shoulder joints, so the artist's pauldron-to-sleeve relationship (perched
  // over the shoulder, not on the body's low cloth pads) survives verbatim.
  // Fallback when there is no Arms piece: perch over the arm joint.
  const shoulders = fitted.get('Shoulders');
  if (shoulders) {
    for (const side of ['Left', 'Right']) {
      const sideOf = (x) => (side === 'Left' ? x >= 0 : x < 0);
      if (sideShift[side]) {
        translate(shoulders, sideShift[side], sideOf);
        continue;
      }
      const joint = body.bindPos.get(`mixamorig${side}Arm`);
      if (!joint) continue;
      const pb = partsBox(shoulders, sideOf);
      if (!Number.isFinite(pb.center[0])) continue;
      translate(
        shoulders,
        [
          joint[0] - pb.center[0],
          joint[1] + (pb.max[1] - pb.min[1]) * 0.28 - pb.center[1],
          joint[2] - pb.center[2],
        ],
        sideOf,
      );
    }
  }
  const report = { slots: {} };
  for (const [slot, parts] of fitted) {
    const n = nudges[slot];
    if (n) {
      const box = partsBox(parts);
      const ns = n.s ?? 1;
      const nd = n.d ?? [0, 0, 0];
      for (const part of parts) {
        for (let i = 0; i < part.positions.length; i += 3) {
          for (let kk = 0; kk < 3; kk++) {
            part.positions[i + kk] =
              (part.positions[i + kk] - box.center[kk]) * ns + box.center[kk] + nd[kk];
          }
        }
      }
    }
    report.slots[slot] = { scale: Math.round(s * (n?.s ?? 1) * 1e3) / 1e3, seat: ['anchored'] };
  }
  return { fitted, report };
}

export function fitPieces(pieces, body, nudges = {}, opts = {}) {
  if (opts.fitMode === 'whole') return fitWhole(pieces, body, nudges, opts);
  if (opts.fitMode === 'anchored') return fitAnchored(pieces, body, nudges, opts);
  const report = { slots: {} };
  const fitted = new Map();
  for (const [slot, parts] of pieces) {
    let rule = SLOT_FIT[slot];
    if (slot === 'Helm' && opts.helmMode === 'hat') rule = HAT_FIT;
    if (slot === 'Helm' && opts.helmMode === 'mask') rule = MASK_FIT;
    if (!rule) throw new Error(`fit: no rule for slot ${slot}`);
    if (rule.mode === 'bones') {
      const { outParts, report: sideReport } = fitArmsToBones(parts, body, nudges[slot] ?? {}, {
        overlay: opts.armsOverlay ?? false,
      });
      fitted.set(slot, outParts);
      report.slots[slot] = {
        scale: sideReport.Left?.scale ?? 1,
        seat: ['bones'],
        girth: sideReport.Left?.girth ?? 1,
      };
      continue;
    }
    let segArrays = null;
    for (const wanted of rule.targets) {
      const found = wanted.map((n) => body.segments.get(n)).filter(Boolean);
      if (found.length) {
        segArrays = found.map((seg) => seg.positions);
        break;
      }
    }
    if (!segArrays) segArrays = [...body.segments.values()].map((seg) => seg.positions);
    if (rule.includeHair) {
      // Seat on the DEFAULT hair style (the first by name), not the union of
      // all styles: a taller alternate style would float the hat above the
      // one actually worn.
      const hairNames = [...body.segments.keys()]
        .filter((n) => /^Head_(Male|Female)_Hair/.test(n))
        .sort();
      if (hairNames.length) segArrays.push(body.segments.get(hairNames[0]).positions);
    }
    const T = boundsOf(segArrays);
    let fitParts = parts;
    if (rule.pitchDeg || rule.tiltDeg) {
      const A0 = boundsOf(parts.map((p) => p.positions));
      fitParts = parts.map((part) => {
        const rot = rotateTilt(part.positions, part.normals, A0.center, rule);
        return { ...part, positions: rot.positions, normals: rot.normals };
      });
    }
    const A = boundsOf(fitParts.map((p) => p.positions));
    const nudge = nudges[slot] ?? {};
    const nd0 = nudge.d ?? [0, 0, 0];

    if (rule.mode === 'span') {
      // Exact vertical mapping (segment top to bottom) plus a shelled radial
      // fit; the piece's soles land exactly on the body's.
      const sy = (T.size[1] / Math.max(A.size[1], 1e-4)) * (nudge.s ?? 1);
      const sxz =
        rule.shellXZ *
        Math.sqrt(
          (T.size[0] / Math.max(A.size[0], 1e-4)) * (T.size[2] / Math.max(A.size[2], 1e-4)),
        ) *
        (nudge.s ?? 1);
      const outParts = parts.map((part) => {
        const positions = new Float32Array(part.positions.length);
        for (let i = 0; i < part.positions.length; i += 3) {
          positions[i] = T.center[0] + (part.positions[i] - A.center[0]) * sxz + nd0[0];
          positions[i + 1] =
            T.min[1] - (rule.yDrop ?? 0) + (part.positions[i + 1] - A.min[1]) * sy + nd0[1];
          positions[i + 2] = T.center[2] + (part.positions[i + 2] - A.center[2]) * sxz + nd0[2];
        }
        return { ...part, positions };
      });
      fitted.set(slot, outParts);
      report.slots[slot] = {
        scale: Math.round(sxz * 1e3) / 1e3,
        seat: T.min.map((v) => Math.round(v * 1e3) / 1e3),
      };
      continue;
    }

    if (rule.mode === 'sideJoints') {
      // The body's own Shoulders segment (the base outfit's shoulder pads)
      // marks exactly where a pauldron sits: fit each side's piece over its
      // pad, bbox to bbox. Bodies without pads fall back to a seat derived
      // from the arm joint (constants measured from the warrior's pads).
      const padSeg = body.segments.get('Shoulders');
      const s0 = rule.shell * (T.size[0] / Math.max(A.size[0], 1e-4)) * (nudge.s ?? 1);
      const padStats = { Left: null, Right: null };
      if (padSeg) {
        for (const side of ['Left', 'Right']) {
          const min = [1e9, 1e9, 1e9];
          const max = [-1e9, -1e9, -1e9];
          let n = 0;
          for (let i = 0; i < padSeg.positions.length; i += 3) {
            const x = padSeg.positions[i];
            if ((side === 'Left') !== x >= 0) continue;
            for (let k = 0; k < 3; k++) {
              min[k] = Math.min(min[k], padSeg.positions[i + k]);
              max[k] = Math.max(max[k], padSeg.positions[i + k]);
            }
            n += 1;
          }
          if (n >= 8) {
            padStats[side] = {
              center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
              size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
            };
          }
        }
      }
      const outParts = parts.map((part) => {
        const src = part.positions;
        const count = src.length / 3;
        const stats = {
          Left: { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], n: 0 },
          Right: { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], n: 0 },
        };
        const sideOf = (x) => (x >= 0 ? 'Left' : 'Right');
        for (let i = 0; i < count; i++) {
          const st = stats[sideOf(src[i * 3])];
          for (let k = 0; k < 3; k++) {
            st.min[k] = Math.min(st.min[k], src[i * 3 + k]);
            st.max[k] = Math.max(st.max[k], src[i * 3 + k]);
          }
          st.n += 1;
        }
        const positions = new Float32Array(src.length);
        for (let i = 0; i < count; i++) {
          const side = sideOf(src[i * 3]);
          const st = stats[side];
          const center = [
            (st.min[0] + st.max[0]) / 2,
            (st.min[1] + st.max[1]) / 2,
            (st.min[2] + st.max[2]) / 2,
          ];
          const pad = padStats[side];
          let s = s0;
          let target;
          if (pad) {
            const rx = pad.size[0] / Math.max(st.max[0] - st.min[0], 1e-4);
            const ry = pad.size[1] / Math.max(st.max[1] - st.min[1], 1e-4);
            s = 1.15 * Math.sqrt(rx * ry) * (nudge.s ?? 1);
            target = [pad.center[0], pad.center[1] + 0.01, pad.center[2]];
          } else {
            const joint = body.bindPos.get(`mixamorig${side}Arm`);
            const sideH = (st.max[1] - st.min[1]) * s0;
            const sideW = (st.max[0] - st.min[0]) * s0;
            const dirOut = side === 'Left' ? 1 : -1;
            target = joint
              ? [joint[0] + dirOut * sideW * 0.35, joint[1] + sideH * 0.45, joint[2]]
              : center;
          }
          const mirror = side === 'Left' ? 1 : -1;
          positions[i * 3] = target[0] + (src[i * 3] - center[0]) * s + mirror * nd0[0];
          positions[i * 3 + 1] = target[1] + (src[i * 3 + 1] - center[1]) * s + nd0[1];
          positions[i * 3 + 2] = target[2] + (src[i * 3 + 2] - center[2]) * s + nd0[2];
        }
        return { ...part, positions };
      });
      fitted.set(slot, outParts);
      report.slots[slot] = { scale: Math.round(s0 * 1e3) / 1e3, seat: ['pads'] };
      continue;
    }

    let ratio = 1;
    let n = 0;
    for (const axis of rule.axes) {
      if (A.size[axis] > 1e-4 && T.size[axis] > 1e-4) {
        ratio *= T.size[axis] / A.size[axis];
        n += 1;
      }
    }
    const s = (n ? ratio ** (1 / n) : 1) * rule.shell * (nudge.s ?? 1);

    const target = [...T.center];
    if (rule.yMode === 'bottom') {
      target[1] = T.min[1] + (A.center[1] - A.min[1]) * s + rule.yPad;
    } else if (rule.yMode === 'top') {
      target[1] = T.max[1] - (A.max[1] - A.center[1]) * s + rule.yPad;
    } else if (rule.yMode === 'crown') {
      // Seat the piece's BOTTOM (the hat brim) just below the head's top.
      target[1] = T.max[1] - rule.crownSink * T.size[1] + (A.center[1] - A.min[1]) * s + rule.yPad;
      // A hat wants to sit over the FACE side, not centered on the hair mass
      // (long styles bulge backward): push it toward +z by a fraction of the
      // head's own depth.
      if (rule.forwardFrac) {
        const head = body.segments.get('Head');
        if (head) target[2] += boundsOf([head.positions]).size[2] * rule.forwardFrac;
      }
    } else if (rule.yMode === 'faceFront') {
      // Center on the face, straddling the head's front plane: the mask's
      // back half hugs the face, any crest/foliage sweeps forward and up.
      target[1] = T.center[1] + rule.yPad;
      target[2] = T.max[2] + (rule.faceGap ?? 0.005);
    } else if (rule.yMode === 'joints') {
      const ys = rule.joints.map((j) => body.bindPos.get(j)?.[1]).filter((v) => v !== undefined);
      if (ys.length) target[1] = ys.reduce((a, b) => a + b, 0) / ys.length + rule.yPad;
    } else {
      target[1] += rule.yPad;
    }
    const nd = nudge.d ?? [0, 0, 0];

    const outParts = fitParts.map((part) => {
      const positions = new Float32Array(part.positions.length);
      for (let i = 0; i < part.positions.length; i += 3) {
        positions[i] = target[0] + (part.positions[i] - A.center[0]) * s + nd[0];
        positions[i + 1] = target[1] + (part.positions[i + 1] - A.center[1]) * s + nd[1];
        positions[i + 2] = target[2] + (part.positions[i + 2] - A.center[2]) * s + nd[2];
      }
      return { ...part, positions };
    });
    fitted.set(slot, outParts);
    report.slots[slot] = {
      scale: Math.round(s * 1e3) / 1e3,
      seat: target.map((v) => Math.round(v * 1e3) / 1e3),
    };
  }
  return { fitted, report };
}

// --- weight transfer --------------------------------------------------------
class Grid {
  constructor(positions, cell) {
    this.positions = positions;
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < positions.length / 3; i++) {
      const key = this.key(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      let arr = this.map.get(key);
      if (!arr) {
        arr = [];
        this.map.set(key, arr);
      }
      arr.push(i);
    }
  }
  key(x, y, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  candidates(x, y, z) {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let ring = 1; ring <= 6; ring++) {
      const out = [];
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iy = cy - ring; iy <= cy + ring; iy++) {
          for (let iz = cz - ring; iz <= cz + ring; iz++) {
            const arr = this.map.get(`${ix},${iy},${iz}`);
            if (arr) out.push(...arr);
          }
        }
      }
      if (out.length >= 8) return out;
    }
    return [...Array(this.positions.length / 3).keys()];
  }
}

/** Transfer skin weights onto armor verts from the nearest body verts of the
 *  slot's source segments. K nearest, inverse-square blend, top 4 joints. */
export function transferWeights(positions, sourceSegments) {
  let total = 0;
  for (const seg of sourceSegments) total += seg.positions.length / 3;
  const srcPos = new Float32Array(total * 3);
  const srcJ = new Uint16Array(total * 4);
  const srcW = new Float32Array(total * 4);
  {
    let off = 0;
    for (const seg of sourceSegments) {
      srcPos.set(seg.positions, off * 3);
      srcJ.set(seg.inflJ, off * 4);
      srcW.set(seg.inflW, off * 4);
      off += seg.positions.length / 3;
    }
  }
  const min = [1e9, 1e9, 1e9];
  const max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < srcPos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], srcPos[i + k]);
      max[k] = Math.max(max[k], srcPos[i + k]);
    }
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const grid = new Grid(srcPos, Math.max(diag / 24, 1e-3));
  const count = positions.length / 3;
  const outJ = new Uint16Array(count * 4);
  const outW = new Float32Array(count * 4);
  const K = 6;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const cand = grid.candidates(x, y, z);
    const best = [];
    for (const c of cand) {
      const dx = srcPos[c * 3] - x;
      const dy = srcPos[c * 3 + 1] - y;
      const dz = srcPos[c * 3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (best.length < K) {
        best.push({ c, d2 });
        best.sort((a, b) => a.d2 - b.d2);
      } else if (d2 < best[K - 1].d2) {
        best[K - 1] = { c, d2 };
        best.sort((a, b) => a.d2 - b.d2);
      }
    }
    const acc = new Map();
    for (const { c, d2 } of best) {
      const q = 1 / (d2 + 1e-8);
      for (let k = 0; k < 4; k++) {
        const w = srcW[c * 4 + k];
        if (w <= 1e-6) continue;
        const j = srcJ[c * 4 + k];
        acc.set(j, (acc.get(j) ?? 0) + w * q);
      }
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0;
    for (const [, w] of top) sum += w;
    for (let k = 0; k < 4; k++) {
      if (k < top.length && sum > 0) {
        outJ[i * 4 + k] = top[k][0];
        outW[i * 4 + k] = top[k][1] / sum;
      } else {
        outJ[i * 4 + k] = 0;
        outW[i * 4 + k] = 0;
      }
    }
  }
  return { joints: outJ, weights: outW };
}

export function weightSources(slot, segments) {
  for (const wanted of SLOT_WEIGHT_SOURCES[slot]) {
    const found = wanted.map((n) => segments.get(n)).filter(Boolean);
    if (found.length) return found;
  }
  return [...segments.values()];
}

// --- emit -------------------------------------------------------------------
/** Add the fitted, skinned armor pieces into the body document as
 *  Armor_<Slot> skinned meshes bound to the body's own joint nodes, with IBMs
 *  computed from the T-pose worlds (body.myIbm). Each distinct base color
 *  image (part.tex, captured at extract) becomes its own material, so a set
 *  atlas and a separate hat texture both survive the merge. */
export function addArmorToBody(body, fitted, skinned) {
  const doc = body.doc;
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  const ibmData = new Float32Array(body.jointOrder.length * 16);
  body.jointOrder.forEach((name, i) => {
    ibmData.set(body.myIbm.get(name), i * 16);
  });
  const ibmAcc = doc
    .createAccessor('armor_ibm')
    .setType('MAT4')
    .setArray(ibmData)
    .setBuffer(buffer);
  const skin = doc.createSkin('ArmorSkin').setInverseBindMatrices(ibmAcc);
  for (const name of body.jointOrder) skin.addJoint(body.jointInfo.get(name).node);

  const matCache = new Map();
  const materialFor = (tex) => {
    const key = tex?.image ?? 'flat';
    if (matCache.has(key)) return matCache.get(key);
    const suffix = matCache.size ? `_${matCache.size + 1}` : '';
    const material = doc
      .createMaterial(`ArmorSetMat${suffix}`)
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setBaseColorFactor(tex?.factor ?? [1, 1, 1, 1]);
    if (tex?.alphaMode && tex.alphaMode !== 'OPAQUE') {
      material.setAlphaMode(tex.alphaMode);
      if (tex.alphaMode === 'MASK') material.setAlphaCutoff(tex.alphaCutoff);
    }
    if (tex?.doubleSided) material.setDoubleSided(true);
    if (tex?.emissiveFactor?.some((v) => v > 0)) material.setEmissiveFactor(tex.emissiveFactor);
    if (tex?.image) {
      const image = doc
        .createTexture(`ArmorSetTex${suffix}`)
        .setImage(tex.image)
        .setMimeType(tex.mimeType || 'image/png');
      material.setBaseColorTexture(image);
      if (tex.emissiveUsesBaseTex) material.setEmissiveTexture(image);
    }
    matCache.set(key, material);
    return material;
  };

  for (const [slot, parts] of fitted) {
    const mesh = doc.createMesh(`Armor_${slot}`);
    parts.forEach((part, pi) => {
      const skinData = skinned.get(slot)[pi];
      const count = part.positions.length / 3;
      const prim = doc.createPrimitive();
      prim.setAttribute(
        'POSITION',
        doc.createAccessor().setType('VEC3').setArray(part.positions).setBuffer(buffer),
      );
      if (part.normals) {
        prim.setAttribute(
          'NORMAL',
          doc.createAccessor().setType('VEC3').setArray(part.normals).setBuffer(buffer),
        );
      }
      if (part.uvs) {
        prim.setAttribute(
          'TEXCOORD_0',
          doc.createAccessor().setType('VEC2').setArray(part.uvs).setBuffer(buffer),
        );
      }
      prim.setAttribute(
        'JOINTS_0',
        doc.createAccessor().setType('VEC4').setArray(skinData.joints).setBuffer(buffer),
      );
      prim.setAttribute(
        'WEIGHTS_0',
        doc.createAccessor().setType('VEC4').setArray(skinData.weights).setBuffer(buffer),
      );
      if (part.indices) {
        const IndexArray = count <= 65535 ? Uint16Array : Uint32Array;
        prim.setIndices(
          doc
            .createAccessor()
            .setType('SCALAR')
            .setArray(new IndexArray(part.indices))
            .setBuffer(buffer),
        );
      }
      prim.setMaterial(materialFor(part.tex));
      mesh.addPrimitive(prim);
    });
    const node = doc.createNode(`Armor_${slot}`).setMesh(mesh).setSkin(skin);
    scene.addChild(node);
  }
}

/** Strip body meshes and animations from a combined doc, keeping only the
 *  skeleton and Armor_* meshes (the lightweight set-only artifact). */
export async function stripToSet(doc) {
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName() || mesh.getName();
    if (!name.startsWith('Armor_')) {
      node.setMesh(null);
      node.setSkin(null);
      mesh.dispose();
    }
  }
  for (const anim of [...root.listAnimations()]) anim.dispose();
  await doc.transform(prune());
}
