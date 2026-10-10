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
