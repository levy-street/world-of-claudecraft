// Forward kinematics and linear-blend skinning over a gltf-transform document,
// dependency-free (no three.js): enough to pose a rig at a clip time and read
// its vertices in world space, which is what the build's verification and the
// height/stride calibration need. Column-major 4x4 matrices, glTF conventions.

export const m4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
  },
  compose(t, q, s) {
    const [x, y, z, w] = q;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    const [sx, sy, sz] = s;
    return [
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
    ];
  },
  apply(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  },
  position: (m) => [m[12], m[13], m[14]],
};

function slerp(a, b, t) {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (cos < 0) {
    cos = -cos;
    bb = b.map((x) => -x);
  }
  if (cos > 0.9995) {
    const r = a.map((x, i) => x + (bb[i] - x) * t);
    const l = Math.hypot(...r);
    return r.map((x) => x / l);
  }
  const th = Math.acos(cos);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((x, i) => x * wa + bb[i] * wb);
}

/** Nodes of a document with their parent links and a name index. */
export function nodeTable(doc) {
  const nodes = doc.getRoot().listNodes();
  const parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  return { nodes, parent, byName: new Map(nodes.map((n) => [n.getName(), n])) };
}

/** World matrix of every node, with `pose` (name -> {t, r, s}) overriding rest transforms. */
export function worldMatrices(table, pose = new Map()) {
  const cache = new Map();
  const world = (n) => {
    const hit = cache.get(n);
    if (hit) return hit;
    const p = pose.get(n.getName());
    const local = m4.compose(
      p?.t ?? n.getTranslation(),
      p?.r ?? n.getRotation(),
      p?.s ?? n.getScale(),
    );
    const par = table.parent.get(n);
    const w = par ? m4.mul(world(par), local) : local;
    cache.set(n, w);
    return w;
  };
  for (const n of table.nodes) world(n);
  return cache;
}

/** Sample an animation into a node-name -> {t, r, s} pose at `time` seconds.
 *  Reads through the accessor API (getScalar / getElement), so quantized and
 *  meshopt-filtered outputs of a shipped file come back as real numbers. */
export function samplePose(anim, time) {
  const pose = new Map();
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    if (!node) continue;
    const s = ch.getSampler();
    const input = s.getInput();
    const out = s.getOutput();
    const el = out.getElementSize();
    const keys = input.getCount();
    let i = 0;
    while (i < keys - 1 && input.getScalar(i + 1) <= time) i++;
    const i1 = Math.min(i + 1, keys - 1);
    const t0 = input.getScalar(i);
    const t1 = input.getScalar(i1);
    const f = t1 > t0 ? Math.max(0, Math.min(1, (time - t0) / (t1 - t0))) : 0;
    const cubic = s.getInterpolation() === 'CUBICSPLINE';
    const read = (k) => {
      const v = new Array(el).fill(0);
      out.getElement(cubic ? k * 3 + 1 : k, v);
      return v;
    };
    const v0 = read(i);
    const v1 = read(i1);
    let v;
    if (s.getInterpolation() === 'STEP') v = v0;
    else if (ch.getTargetPath() === 'rotation') v = slerp(v0, v1, f);
    else v = v0.map((x, k) => x + (v1[k] - x) * f);
    const key =
      ch.getTargetPath() === 'translation' ? 't' : ch.getTargetPath() === 'rotation' ? 'r' : 's';
    const cur = pose.get(node.getName()) ?? {};
    cur[key] = v;
    pose.set(node.getName(), cur);
  }
  return pose;
}

export function clipDuration(anim) {
  let d = 0;
  for (const s of anim.listSamplers()) {
    const input = s.getInput();
    d = Math.max(d, input.getScalar(input.getCount() - 1));
  }
  return d;
}

export function bbox(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max, height: max[1] - min[1] };
}

/** World positions of a skinned mesh's vertices at a pose, blended through the
 *  skin's inverse bind matrices (so quantized primitives read back in real units). */
export function skinnedPositions(mesh, node, worlds) {
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const jointMats = joints.map((j, k) =>
    m4.mul(worlds.get(j), Array.from(ibm.subarray(k * 16, k * 16 + 16))),
  );
  const out = [];
  const p = [0, 0, 0];
  const jn = [0, 0, 0, 0];
  const wt = [0, 0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const posA = prim.getAttribute('POSITION');
    const jnA = prim.getAttribute('JOINTS_0');
    const wtA = prim.getAttribute('WEIGHTS_0');
    for (let i = 0; i < posA.getCount(); i++) {
      posA.getElement(i, p);
      jnA.getElement(i, jn);
      wtA.getElement(i, wt);
      const acc = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const w = wt[k];
        if (w === 0) continue;
        const q = m4.apply(jointMats[jn[k]], p);
        acc[0] += q[0] * w;
        acc[1] += q[1] * w;
        acc[2] += q[2] * w;
      }
      out.push(acc);
    }
  }
  return out;
}

/** World positions of a rigid mesh's vertices under `world`. */
export function rigidPositions(mesh, world) {
  const out = [];
  const p = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const posA = prim.getAttribute('POSITION');
    for (let i = 0; i < posA.getCount(); i++) {
      posA.getElement(i, p);
      out.push(m4.apply(world, [p[0], p[1], p[2]]));
    }
  }
  return out;
}
