// The furniture sitting clips (public/models/chars/players/sit_anims.glb), authored in
// headless Blender (scripts/anim/blender_sit_clips.py) and re-seated onto the shipped
// KayKit Rig_Medium rest pose (scripts/build_sit_anims.mjs). A clip-only GLB layered onto
// every player and modular body through `animUrls`, so its contract is structural: the
// nine names, no geometry, joint names that bind on the shipped rig, loops that close and
// one-shots whose ends are exactly the loops' first frames (so a crossfade never pops).
// Pattern: tests/weapon_skins.test.ts "bow skin attack animation" and
// tests/anim_pipeline_batch1.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Animation, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SIT_GLB = 'public/models/chars/players/sit_anims.glb';
const RIG_GLB = 'public/models/chars/players/knight.glb';
const MODULAR_GLB = 'public/models/chars/modular/warrior_modular.glb';

const CLIPS = [
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
const LOOPS = [
  'Sit_Chair_Idle',
  'Sit_Chair_Relaxed_Idle',
  'Sit_Chair_Talk',
  'Sit_Chair_Drink',
  'Sit_High_Idle',
];
/** Seconds, from the authoring brief: [min, max]. */
const DURATIONS: Record<string, [number, number]> = {
  Sit_Chair_Down: [1.0, 1.2],
  Sit_Chair_Idle: [5, 7],
  Sit_Chair_StandUp: [0.8, 1.0],
  Sit_Chair_Relaxed_Idle: [6, 6],
  Sit_Chair_Talk: [6, 8],
  Sit_Chair_Drink: [3.8, 4.2],
  Sit_High_Down: [0.9, 1.1],
  Sit_High_Idle: [5, 7],
  Sit_High_StandUp: [0.7, 0.9],
};
const EPS = 1e-5;

interface GlbJson {
  nodes?: { name?: string }[];
  meshes?: unknown[];
  skins?: unknown[];
  animations?: {
    name?: string;
    channels: { target: { node?: number; path: string } }[];
  }[];
}

function glbJson(path: string): GlbJson {
  const glb = readFileSync(join(ROOT, path));
  const jsonLen = glb.readUInt32LE(12);
  return JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
}

/** Per channel (`node/path`): the first and last keyed values. */
type Ends = Map<string, { first: number[]; last: number[]; count: number }>;

function channelEnds(anim: Animation): Ends {
  const out: Ends = new Map();
  for (const ch of anim.listChannels()) {
    const acc = ch.getSampler()?.getOutput();
    const node = ch.getTargetNode();
    if (!acc || !node) continue;
    const size = acc.getElementSize();
    const first = new Array(size).fill(0);
    const last = new Array(size).fill(0);
    acc.getElement(0, first);
    acc.getElement(acc.getCount() - 1, last);
    out.set(`${node.getName()}/${ch.getTargetPath()}`, { first, last, count: acc.getCount() });
  }
  return out;
}

/** Largest component difference; quaternions compared up to sign. */
function diff(path: string, a: number[], b: number[]): number {
  const d = (s: number) => Math.max(...a.map((v, i) => Math.abs(v - s * b[i])));
  return path.endsWith('rotation') ? Math.min(d(1), d(-1)) : d(1);
}

let anims: Map<string, Animation>;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(join(ROOT, SIT_GLB));
  anims = new Map(
    doc
      .getRoot()
      .listAnimations()
      .map((a) => [a.getName(), a]),
  );
});

describe('sit_anims.glb: furniture sitting clips on the shared Rig_Medium', () => {
  it('ships exactly the nine clips, clip-only (no mesh, no skin)', () => {
    const json = glbJson(SIT_GLB);
    expect((json.animations ?? []).map((a) => a.name).sort()).toEqual([...CLIPS].sort());
    expect(json.meshes ?? []).toHaveLength(0);
    expect(json.skins ?? []).toHaveLength(0);
  });

  it('carries the Rig_Medium joint hierarchy with byte-identical names', () => {
    const sit = (glbJson(SIT_GLB).nodes ?? []).map((n) => n.name ?? '');
    for (const rig of [RIG_GLB, MODULAR_GLB]) {
      const names = new Set((glbJson(rig).nodes ?? []).map((n) => n.name ?? ''));
      for (const n of sit) expect(names.has(n), `${n} missing from ${rig}`).toBe(true);
    }
    expect(sit).toContain('root');
    expect(sit).toContain('hips');
    expect(sit).toHaveLength(23);
  });

  it('animates only joints the shipped rig has, and never the root (the anchor)', () => {
    const json = glbJson(SIT_GLB);
    const rigNames = new Set((glbJson(RIG_GLB).nodes ?? []).map((n) => n.name ?? ''));
    for (const a of json.animations ?? []) {
      for (const ch of a.channels) {
        const name = json.nodes?.[ch.target.node ?? -1]?.name ?? '';
        expect(rigNames.has(name), `${a.name} animates unknown node ${name}`).toBe(true);
        expect(name, `${a.name} moves the root`).not.toBe('root');
        if (ch.target.path === 'translation') expect(name, a.name).toBe('hips');
      }
    }
  });

  it('keys every joint rotation in every clip (no bone inherited mid-crossfade)', () => {
    const json = glbJson(SIT_GLB);
    for (const a of json.animations ?? []) {
      const rotated = new Set(
        a.channels.filter((c) => c.target.path === 'rotation').map((c) => c.target.node),
      );
      expect(rotated.size, a.name).toBe(22);
    }
  });

  it('runs the authored durations', () => {
    for (const name of CLIPS) {
      const anim = anims.get(name);
      expect(anim, name).toBeDefined();
      let end = 0;
      for (const s of anim?.listSamplers() ?? []) {
        const t = s.getInput()?.getArray();
        if (t?.length) end = Math.max(end, t[t.length - 1]);
      }
      const [lo, hi] = DURATIONS[name];
      expect(end, name).toBeGreaterThanOrEqual(lo - 1e-3);
      expect(end, name).toBeLessThanOrEqual(hi + 1e-3);
    }
  });

  it('closes every loop: last frame equals first frame on every channel', () => {
    for (const name of LOOPS) {
      const ends = channelEnds(anims.get(name) as Animation);
      expect(ends.size, name).toBe(23);
      for (const [key, { first, last }] of ends) {
        expect(diff(key, first, last), `${name} ${key}`).toBeLessThan(EPS);
      }
    }
  });

  it('starts and ends every one-shot exactly on the neighbouring clip frames', () => {
    const pairs: [string, 'first' | 'last', string, 'first' | 'last'][] = [
      // sitting down ends where the seated loop starts
      ['Sit_Chair_Down', 'last', 'Sit_Chair_Idle', 'first'],
      ['Sit_High_Down', 'last', 'Sit_High_Idle', 'first'],
      // standing up starts where the seated loop starts...
      ['Sit_Chair_StandUp', 'first', 'Sit_Chair_Idle', 'first'],
      ['Sit_High_StandUp', 'first', 'Sit_High_Idle', 'first'],
      // ...and ends on the standing pose sitting down starts from
      ['Sit_Chair_StandUp', 'last', 'Sit_Chair_Down', 'first'],
      ['Sit_High_StandUp', 'last', 'Sit_High_Down', 'first'],
      // the chair's talk and drink loops open on the seated idle's first frame, so the
      // renderer can switch between them with no pop even without a crossfade
      ['Sit_Chair_Talk', 'first', 'Sit_Chair_Idle', 'first'],
      ['Sit_Chair_Drink', 'first', 'Sit_Chair_Idle', 'first'],
    ];
    for (const [a, ea, b, eb] of pairs) {
      const A = channelEnds(anims.get(a) as Animation);
      const B = channelEnds(anims.get(b) as Animation);
      expect([...A.keys()].sort(), `${a} vs ${b}`).toEqual([...B.keys()].sort());
      for (const [key, va] of A) {
        const vb = B.get(key);
        expect(vb, key).toBeDefined();
        if (!vb) continue;
        expect(diff(key, va[ea], vb[eb]), `${a}.${ea} vs ${b}.${eb} on ${key}`).toBeLessThan(EPS);
      }
    }
  });

  it('keeps the hip-joint midpoint over the anchor while seated (hips x/z near zero)', () => {
    // hips rest at x = z = 0 on this rig, and the hip joints sit symmetrically under it,
    // so the seated hips translation's x/z IS the hip-joint midpoint's (rig units)
    for (const name of ['Sit_Chair_Idle', 'Sit_Chair_Talk', 'Sit_Chair_Drink', 'Sit_High_Idle']) {
      const anim = anims.get(name) as Animation;
      const ch = anim.listChannels().find((c) => c.getTargetPath() === 'translation');
      const acc = ch?.getSampler()?.getOutput();
      expect(acc, name).toBeDefined();
      const v = [0, 0, 0];
      for (let i = 0; i < (acc?.getCount() ?? 0); i++) {
        acc?.getElement(i, v);
        expect(Math.abs(v[0]), `${name} hips x @${i}`).toBeLessThan(0.02);
        expect(Math.abs(v[2]), `${name} hips z @${i}`).toBeLessThan(0.02);
      }
    }
  });
});
