// The Lagoon Eel holds its head level (scripts/assets/drowned_temple_creatures/
// eel.py): its column ripples in an S-wave, but the head never yaws, rolls or
// swings sideways in any living clip. Playtesters read the old clips as the
// eel shaking its head: the coil's yaw reached the head on Walk and Run, the
// column's side bends swung it 1.3 to 2.8 yd, and the second attack rolled it
// half over. Forward kinematics on the SHIPPED GLB, sampled at every key.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type V3 = [number, number, number];
type Q = [number, number, number, number];

interface Gltf {
  nodes: { name?: string; children?: number[]; translation?: V3; rotation?: Q }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number }[];
  animations: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number }[];
  }[];
}

const buf = readFileSync('public/models/creatures/temple_eel.glb');
const jsonLen = buf.readUInt32LE(12);
const gl = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
const binStart = 20 + jsonLen + 8;

function accessor(i: number): number[][] {
  const a = gl.accessors[i];
  const n = a.type === 'SCALAR' ? 1 : a.type === 'VEC3' ? 3 : 4;
  const off = binStart + (gl.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[][] = [];
  for (let k = 0; k < a.count; k++) {
    const v: number[] = [];
    for (let j = 0; j < n; j++) v.push(buf.readFloatLE(off + (k * n + j) * 4));
    out.push(v);
  }
  return out;
}

function qmul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qrot(q: Q, v: V3): V3 {
  const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [r[0], r[1], r[2]];
}

const parent = gl.nodes.map(() => -1);
gl.nodes.forEach((n, i) => {
  for (const c of n.children ?? []) parent[c] = i;
});
const HEAD = gl.nodes.findIndex((n) => n.name === 'Head');

function headWorld(pose: { t: V3; r: Q }[]): { q: Q; t: V3 } {
  const chain: number[] = [];
  for (let k = HEAD; k >= 0; k = parent[k]) chain.unshift(k);
  let q: Q = [0, 0, 0, 1];
  let t: V3 = [0, 0, 0];
  for (const k of chain) {
    const lt = qrot(q, pose[k].t);
    t = [t[0] + lt[0], t[1] + lt[1], t[2] + lt[2]];
    q = qmul(q, pose[k].r);
  }
  return { q, t };
}

/** The head's sideways reach over a clip: its heading off straight ahead,
 *  its roll, and how far it swings side to side (yards, peak to peak). */
function headSway(clip: string): { yaw: number; roll: number; side: number } {
  const an = gl.animations.find((a) => a.name === clip);
  if (!an) throw new Error(`no ${clip}`);
  const rest = gl.nodes.map((n) => ({
    t: (n.translation ?? [0, 0, 0]) as V3,
    r: (n.rotation ?? [0, 0, 0, 1]) as Q,
  }));
  const channels = an.channels.map((c) => ({
    node: c.target.node,
    path: c.target.path,
    times: accessor(an.samplers[c.sampler].input).map((v) => v[0]),
    values: accessor(an.samplers[c.sampler].output),
  }));
  const keys = channels[0].times;
  let yaw = 0;
  let roll = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < keys.length; k++) {
    const pose = rest.map((p) => ({ t: [...p.t] as V3, r: [...p.r] as Q }));
    for (const c of channels) {
      const v = c.values[Math.min(k, c.values.length - 1)];
      if (c.path === 'rotation') pose[c.node].r = v as Q;
      else if (c.path === 'translation') pose[c.node].t = v as V3;
    }
    const w = headWorld(pose);
    const fwd = qrot(w.q, [0, 1, 0]);
    const across = qrot(w.q, [1, 0, 0]);
    yaw = Math.max(yaw, Math.abs((Math.atan2(fwd[0], fwd[2]) * 180) / Math.PI));
    roll = Math.max(
      roll,
      Math.abs((Math.asin(Math.max(-1, Math.min(1, across[1]))) * 180) / Math.PI),
    );
    minX = Math.min(minX, w.t[0]);
    maxX = Math.max(maxX, w.t[0]);
  }
  return { yaw, roll, side: maxX - minX };
}

describe('the Lagoon Eel holds its head level', () => {
  for (const clip of ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Coil', 'Spit']) {
    it(`${clip}: no head yaw, no roll, no sideways swing`, () => {
      const s = headSway(clip);
      expect(s.yaw).toBeLessThan(2);
      expect(s.roll).toBeLessThan(2);
      expect(s.side).toBeLessThan(0.4);
    });
  }
});
