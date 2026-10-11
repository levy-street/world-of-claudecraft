// Pose a shipped GLB at a clip time and read named nodes in world space: where a bone sits and
// which way it points (its +Y). For tests that pin what a clip DOES (a held prop's direction, a
// corpse lying on the floor) rather than only which clips exist. Uniform scales only (the rigs
// this reads are exported unscaled); the clips' samplers are linear (slerp for rotations), as
// pose_blend.mjs reads them.

import { createGlbIO, indexClip, samplePose } from '../../scripts/anim/pose_blend.mjs';

type V3 = [number, number, number];
type Q = [number, number, number, number];

export interface PosedNode {
  pos: V3;
  /** The node's +Y in world space (a bone's direction from its head toward its tail). */
  up: V3;
}

function qmul(a: Q, b: Q): Q {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function qrot(q: Q, v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export interface SkinnedVertex {
  /** The vertex at rest in world space (glTF axes), skinned through its joints' bind matrices,
   *  so a quantized mesh reads true. */
  pos: V3;
  /** Its joints' weights by joint name (weights under 1e-4 dropped). */
  weights: Map<string, number>;
}

type M4 = number[];

function m4mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function m4trs(t: V3, q: Q, s: V3): M4 {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0],
    2 * (x * y + z * w) * s[0],
    2 * (x * z - y * w) * s[0],
    0,
    2 * (x * y - z * w) * s[1],
    (1 - 2 * (x * x + z * z)) * s[1],
    2 * (y * z + x * w) * s[1],
    0,
    2 * (x * z + y * w) * s[2],
    2 * (y * z - x * w) * s[2],
    (1 - 2 * (x * x + y * y)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

/** Every vertex of the GLB's skinned mesh named `meshName` (or its first skinned mesh) at rest,
 *  with its joint weights by name: for tests that pin which bones a region rides. */
export async function restSkinnedVertices(
  path: string,
  meshName?: string,
): Promise<SkinnedVertex[]> {
  const doc = await createGlbIO().read(path);
  const root = doc.getRoot();
  const node = root
    .listNodes()
    .find((n) => n.getSkin() && n.getMesh() && (!meshName || n.getMesh()?.getName() === meshName));
  if (!node) throw new Error(`no skinned mesh ${meshName ?? ''} in ${path}`);
  const skin = node.getSkin();
  const joints = skin?.listJoints() ?? [];
  const ibm = skin?.getInverseBindMatrices();
  const worldOf = new Map<unknown, M4>();
  const world = (n: (typeof joints)[number]): M4 => {
    const hit = worldOf.get(n);
    if (hit) return hit;
    const local = m4trs(n.getTranslation() as V3, n.getRotation() as Q, n.getScale() as V3);
    const parent = n.getParentNode();
    const out = parent ? m4mul(world(parent), local) : local;
    worldOf.set(n, out);
    return out;
  };
  const skinMats = joints.map((j, i) => m4mul(world(j), (ibm?.getElement(i, []) ?? []) as M4));
  const out: SkinnedVertex[] = [];
  for (const prim of node.getMesh()?.listPrimitives() ?? []) {
    const P = prim.getAttribute('POSITION');
    const J = prim.getAttribute('JOINTS_0');
    const W = prim.getAttribute('WEIGHTS_0');
    if (!P || !J || !W) continue;
    for (let i = 0; i < P.getCount(); i++) {
      const v = P.getElement(i, [0, 0, 0]) as V3;
      const ji = J.getElement(i, []);
      const wi = W.getElement(i, []);
      const pos: V3 = [0, 0, 0];
      const weights = new Map<string, number>();
      for (let k = 0; k < 4; k++) {
        const w = wi[k];
        if (w < 1e-4) continue;
        const m = skinMats[ji[k]];
        for (let a = 0; a < 3; a++)
          pos[a] += w * (m[a] * v[0] + m[4 + a] * v[1] + m[8 + a] * v[2] + m[12 + a]);
        const name = joints[ji[k]].getName();
        weights.set(name, (weights.get(name) ?? 0) + w);
      }
      out.push({ pos, weights });
    }
  }
  return out;
}

/** The clip's length in seconds (its samplers' last key). */
export async function clipLength(path: string, clip: string): Promise<number> {
  const doc = await createGlbIO().read(path);
  let end = 0;
  for (const ch of indexClip(doc.getRoot(), clip).values())
    end = Math.max(end, ch.times[ch.times.length - 1]);
  return end;
}

/** The named nodes posed by `clip` at `t` seconds (clamped to the clip). */
export async function posedNodes(
  path: string,
  clip: string,
  t: number,
  names: readonly string[],
): Promise<Record<string, PosedNode>> {
  const doc = await createGlbIO().read(path);
  const root = doc.getRoot();
  const pose = samplePose(indexClip(root, clip), t);
  const nodes = root.listNodes();
  const world = new Map<unknown, { p: V3; q: Q; s: number }>();
  const solve = (n: (typeof nodes)[number]): { p: V3; q: Q; s: number } => {
    const hit = world.get(n);
    if (hit) return hit;
    const name = n.getName();
    const lp = (pose.get(`${name}|translation`) ?? n.getTranslation()) as V3;
    const lq = (pose.get(`${name}|rotation`) ?? n.getRotation()) as Q;
    const ls = ((pose.get(`${name}|scale`) ?? n.getScale()) as V3)[0];
    const parent = n.getParentNode();
    let out: { p: V3; q: Q; s: number };
    if (!parent) {
      out = { p: [...lp] as V3, q: [...lq] as Q, s: ls };
    } else {
      const P = solve(parent);
      const r = qrot(P.q, [lp[0] * P.s, lp[1] * P.s, lp[2] * P.s]);
      out = { p: [P.p[0] + r[0], P.p[1] + r[1], P.p[2] + r[2]], q: qmul(P.q, lq), s: P.s * ls };
    }
    world.set(n, out);
    return out;
  };
  const res: Record<string, PosedNode> = {};
  for (const name of names) {
    const n = nodes.find((x) => x.getName() === name);
    if (!n) throw new Error(`no node ${name} in ${path}`);
    const w = solve(n);
    res[name] = { pos: w.p, up: qrot(w.q, [0, 1, 0]) };
  }
  return res;
}
