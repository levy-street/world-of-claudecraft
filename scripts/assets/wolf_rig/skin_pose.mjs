// Skin a wolf GLB at any clip time with standard glTF math (as three.js does it), so
// a check reads the shipped file exactly as the game draws it, quantized and
// meshopt-compressed files included. Shared by clip_check.mjs and
// tests/wolf_rig.test.ts.
//
// A clip binds to the rig by joint NAME, as the game binds a mesh-free donor clip
// (a VisualDef's animUrls), so a clip may come from another file.
// A joint the clip leaves out holds its rest value (ship.mjs drops every track that
// never leaves the rest pose).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

/** The regions a skinned point can belong to, paws first. */
export const REGIONS = Object.freeze([
  'fore paw',
  'fore low',
  'hind paw',
  'hind low',
  'body',
  'tail',
]);

/** The region of a wolf rig bone (anatomy.py names): the paw soles, the lower limbs
 *  above them, the tail, or the body. */
export function regionOf(bone) {
  if (/Paw/.test(bone)) return /Hind/.test(bone) ? 'hind paw' : 'fore paw';
  if (/Shin|HindPastern/.test(bone)) return 'hind low';
  if (/Forearm|FrontPastern/.test(bone)) return 'fore low';
  if (/Tail/.test(bone)) return 'tail';
  return 'body';
}

/** Read a GLB (meshopt and quantization decoded). */
export async function readWolfGlb(path) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  io.setLogger({ debug() {}, info() {}, warn() {}, error() {} });
  return (await io.read(path)).getRoot();
}

/** The posable parts of a document root: every node, each node's parent, the skinned
 *  meshes, and the nodes by name. */
export function rigOf(root) {
  const nodes = root.listNodes();
  const parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  return {
    nodes,
    parent,
    meshes: nodes.filter((n) => n.getMesh() && n.getSkin()),
    byName: new Map(nodes.map((n) => [n.getName(), n])),
  };
}

/** The last key time of a clip. */
export function clipDuration(anim) {
  let dur = 0;
  for (const channel of anim.listChannels()) {
    const times = channel.getSampler().getInput().getArray();
    dur = Math.max(dur, times[times.length - 1]);
  }
  return dur;
}

/** A channel's value at time t: linear, quaternions the short way (meshopt's
 *  quaternion filter can flip a key's sign; three.js slerps the short way) and
 *  always unit length (a 16-bit key sits a hair off it, which would read as a turn
 *  of nearly a degree between two equal keys). */
export function sample(channel, t) {
  const sampler = channel.getSampler();
  const times = sampler.getInput().getArray();
  const out = sampler.getOutput();
  const n = out.getElementSize();
  const get = (i) => out.getElement(i, new Array(n).fill(0));
  let r;
  if (t <= times[0]) r = get(0);
  else if (t >= times[times.length - 1]) r = get(times.length - 1);
  else {
    let i = 1;
    while (times[i] < t) i++;
    const u = (t - times[i - 1]) / (times[i] - times[i - 1]);
    const a = get(i - 1);
    let b = get(i);
    if (n === 4 && a.reduce((sum, v, k) => sum + v * b[k], 0) < 0) b = b.map((v) => -v);
    r = a.map((v, k) => v + (b[k] - v) * u);
  }
  if (n !== 4) return r;
  const len = Math.hypot(...r);
  return r.map((v) => v / len);
}

/** Every node's local TRS at time t of a clip, bound to the rig by node name. Returns
 *  the pose and the names of any channels that found no node. */
export function localPose(rig, anim, t) {
  const local = new Map();
  for (const n of rig.nodes)
    local.set(n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() });
  const unbound = [];
  for (const channel of anim.listChannels()) {
    const name = channel.getTargetNode()?.getName() ?? '';
    const node = rig.byName.get(name);
    if (!node) {
      unbound.push(name);
      continue;
    }
    const pose = local.get(node);
    const v = sample(channel, t);
    if (channel.getTargetPath() === 'translation') pose.t = v;
    else if (channel.getTargetPath() === 'rotation') pose.r = v;
    else pose.s = v;
  }
  return { local, unbound };
}

/** The local translation that moves a node one unit straight up in the world: world
 *  +Y carried into its parent's frame (the parents' rest chain; the Root and the
 *  armature never animate). */
export function worldUpFor(rig, name) {
  const parent = rig.parent.get(rig.byName.get(name));
  if (!parent) return [0, 1, 0];
  const m = parent.getWorldMatrix();
  // columns of the parent's 3x3; solve M x = (0, 1, 0) by Cramer's rule
  const c0 = [m[0], m[1], m[2]];
  const c1 = [m[4], m[5], m[6]];
  const c2 = [m[8], m[9], m[10]];
  const det3 = (a, b, c) =>
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    b[0] * (a[1] * c[2] - a[2] * c[1]) +
    c[0] * (a[1] * b[2] - a[2] * b[1]);
  const up = [0, 1, 0];
  const det = det3(c0, c1, c2);
  return [det3(up, c1, c2) / det, det3(c0, up, c2) / det, det3(c0, c1, up) / det];
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    }
  }
  return o;
}

function compose(t, q, s) {
  const [x, y, z, w] = q;
  const [sx, sy, sz] = s;
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

/** Visit the world height of every skinned point for one pose, with the region of the
 *  joint that weighs on it most. */
function forEachSkinnedY(rig, local, visit) {
  const world = new Map();
  const worldOf = (n) => {
    if (world.has(n)) return world.get(n);
    const pose = local.get(n);
    const m = compose(pose.t, pose.r, pose.s);
    const p = rig.parent.get(n);
    const w = p ? mul(worldOf(p), m) : m;
    world.set(n, w);
    return w;
  };
  const v = [0, 0, 0];
  const ji = [0, 0, 0, 0];
  const we = [0, 0, 0, 0];
  for (const node of rig.meshes) {
    const skin = node.getSkin();
    const joints = skin.listJoints();
    const ibm = skin.getInverseBindMatrices();
    const jointMats = joints.map((j, i) =>
      mul(worldOf(j), ibm.getElement(i, new Array(16).fill(0))),
    );
    const regions = joints.map((j) => regionOf(j.getName()));
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const jnt = prim.getAttribute('JOINTS_0');
      const wgt = prim.getAttribute('WEIGHTS_0');
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        jnt.getElement(i, ji);
        wgt.getElement(i, we);
        let y = 0;
        let best = 0;
        let region = 'body';
        for (let k = 0; k < 4; k++) {
          if (!we[k]) continue;
          const m = jointMats[ji[k]];
          y += we[k] * (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]);
          if (we[k] > best) {
            best = we[k];
            region = regions[ji[k]];
          }
        }
        visit(y, region);
      }
    }
  }
}

/** The lowest skinned point (world y) of each region for one pose. A point belongs to
 *  the region of the joint that weighs on it most. */
export function lowestByRegion(rig, local) {
  const low = {};
  forEachSkinnedY(rig, local, (y, region) => {
    if (!(region in low) || y < low[region]) low[region] = y;
  });
  return low;
}

/** The lowest and highest skinned point (world y) of one pose. */
export function skinnedBoundsY(rig, local) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  forEachSkinnedY(rig, local, (y) => {
    if (y < min) min = y;
    if (y > max) max = y;
  });
  return { min, max };
}

/** When the game measures a creature: prepareVisual (src/render/characters/assets.ts)
 *  plays the Idle this far in, then sizes the model by that pose's skinned height and
 *  stands its lowest point on the ground. */
export function idleMeasureTime(idle) {
  return Math.min(0.5, clipDuration(idle) * 0.5);
}

function idlePose(rig, root) {
  const idle = root.listAnimations().find((a) => a.getName() === 'Idle');
  if (!idle) throw new Error('no Idle clip to stand the wolf on');
  return localPose(rig, idle, idleMeasureTime(idle)).local;
}

/** The ground the game stands the wolf on: the Idle's lowest skinned point at the
 *  game's measuring time. */
export function idleGround(rig, root) {
  return skinnedBoundsY(rig, idlePose(rig, root)).min;
}

/** The raw height the game divides the VisualDef height by (prepareVisual's rawHeight). */
export function idleHeight(rig, root) {
  const { min, max } = skinnedBoundsY(rig, idlePose(rig, root));
  return max - min;
}

/** The biggest single joint turn (degrees) between two poses, and its joint. */
export function biggestTurn(prev, local) {
  let step = 0;
  let bone = '';
  for (const [n, pose] of local) {
    const q = pose.r;
    const p = prev.get(n).r;
    const dot = Math.abs(q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3] * p[3]);
    const deg = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    if (deg > step) {
      step = deg;
      bone = n.getName();
    }
  }
  return { step, bone };
}
