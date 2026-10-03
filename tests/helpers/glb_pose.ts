// Read-only forward kinematics on a shipped, rigid-skinned GLB: where a point
// modelled on one bone ends up in a clip's key poses. For pins on a creature's
// held weapon or its head, straight off the binary the game loads.

import { readFileSync } from 'node:fs';

type M4 = number[];

interface Gltf {
  nodes: {
    name?: string;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number }[];
  skins: { joints: number[]; inverseBindMatrices: number }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  animations: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number }[];
  }[];
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };

function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function trs(t: number[], q: number[], s: number[]): M4 {
  const [x, y, z, w] = q;
  const m = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c];
  return m;
}

export interface GlbPoser {
  clips: string[];
  /** Where `point` (bind-pose model space, glTF axes) rigidly skinned to
   *  `bone` lies at every key of `clip`. */
  track(clip: string, bone: string, point: [number, number, number]): [number, number, number][];
  /** Is there bind-pose geometry within `tol` of `point`? */
  hasVertexNear(point: [number, number, number], tol: number): boolean;
}

export function loadGlbPoser(path: string): GlbPoser {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const gl = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  const bin = 20 + jsonLen + 8;
  const accessor = (i: number): number[][] => {
    const a = gl.accessors[i];
    const n = WIDTH[a.type];
    const off = bin + (gl.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[][] = [];
    for (let k = 0; k < a.count; k++) {
      const v: number[] = [];
      for (let j = 0; j < n; j++) v.push(buf.readFloatLE(off + (k * n + j) * 4));
      out.push(v);
    }
    return out;
  };
  const parent = gl.nodes.map(() => -1);
  gl.nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parent[c] = i;
  });
  const skin = gl.skins[0];
  const inverseBind = accessor(skin.inverseBindMatrices);
  return {
    clips: gl.animations.map((a) => a.name),
    hasVertexNear(point, tol) {
      for (const mesh of gl.meshes)
        for (const prim of mesh.primitives)
          for (const v of accessor(prim.attributes.POSITION))
            if (Math.hypot(v[0] - point[0], v[1] - point[1], v[2] - point[2]) <= tol) return true;
      return false;
    },
    track(clip, bone, point) {
      const an = gl.animations.find((a) => a.name === clip);
      if (!an) throw new Error(`no clip ${clip}`);
      const node = gl.nodes.findIndex((n) => n.name === bone);
      const joint = skin.joints.indexOf(node);
      if (node < 0 || joint < 0) throw new Error(`no bone ${bone}`);
      const channels = an.channels.map((c) => ({
        node: c.target.node,
        path: c.target.path,
        times: accessor(an.samplers[c.sampler].input),
        values: accessor(an.samplers[c.sampler].output),
      }));
      // Every key time any channel carries, each channel held at its last
      // key at or before it (the clips are densely baked).
      const times = [...new Set(channels.flatMap((c) => c.times.map((v) => v[0])))].sort(
        (a, b) => a - b,
      );
      const out: [number, number, number][] = [];
      for (const t of times) {
        const pose = gl.nodes.map((n) => ({
          t: n.translation ?? [0, 0, 0],
          r: n.rotation ?? [0, 0, 0, 1],
          s: n.scale ?? [1, 1, 1],
        }));
        for (const c of channels) {
          let k = 0;
          while (k + 1 < c.times.length && c.times[k + 1][0] <= t + 1e-6) k++;
          const v = c.values[Math.min(k, c.values.length - 1)];
          if (c.path === 'rotation') pose[c.node].r = v;
          else if (c.path === 'translation') pose[c.node].t = v;
          else if (c.path === 'scale') pose[c.node].s = v;
        }
        let m = trs(pose[node].t, pose[node].r, pose[node].s);
        for (let p = parent[node]; p >= 0; p = parent[p])
          m = mul(trs(pose[p].t, pose[p].r, pose[p].s), m);
        m = mul(m, inverseBind[joint]);
        out.push(
          [0, 1, 2].map(
            (r) => m[r] * point[0] + m[4 + r] * point[1] + m[8 + r] * point[2] + m[12 + r],
          ) as [number, number, number],
        );
      }
      return out;
    },
  };
}
