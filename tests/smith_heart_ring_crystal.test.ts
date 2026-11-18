// The Smith's Heart ring crystal (the heart seal at the Ring's centre: one crystal that holds
// the four elements; src/render/smith_heart/ring_crystal_core.ts plans it, ring_crystal.ts
// paints it, ring_crystal_material.ts is its material; the model is the Tripo build of the
// owner's ChatGPT sheet, docs/design/raid/kit/ring_crystal_src/README.md):
//   - the state it shows: dark with no vein, an element's crystal climbing as its vein
//     lights, the heart glowing as the four fill, the ready swell, the overload and the
//     shatter, every number reading the seal's own timelines;
//   - the pieces' flight: whole until the shatter, then out, the crystal's pieces settling into
//     an orbit round the portal over every head and turning on, the plinth's stones gone;
//   - the shipped GLB: the pieces, its budget, its size, the weights' sides (each element on
//     its own vein's side of the Ring), the heart the remainder, the painting alone in KTX2.
// The glTF frame is the game's (y up, north +z, east +x).

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGateObject, gateObjectPlan } from '../src/render/gate_objects';
import { HEART_PORTAL_OPEN } from '../src/render/smith_heart/heart_portal_core';
import {
  HEART_SEAL_ARRIVAL,
  HEART_SEAL_FILL_SECONDS,
} from '../src/render/smith_heart/heart_seal_core';
import {
  newRingCrystalLast,
  newRingCrystalPiecePose,
  newRingCrystalState,
  RING_CRYSTAL,
  RING_CRYSTAL_CLICK,
  RING_CRYSTAL_CORE_RADIUS,
  RING_CRYSTAL_READY_RISE,
  type RingCrystalPieceKind,
  type RingCrystalState,
  ringCrystalChanged,
  ringCrystalPieceKind,
  ringCrystalPiecePose,
  ringCrystalPieceRole,
  ringCrystalPieceSpans,
  ringCrystalState,
  ringCrystalTremble,
} from '../src/render/smith_heart/ring_crystal_core';
import { ringCrystalMaterial } from '../src/render/smith_heart/ring_crystal_material';
import { buildRingCrystalClickBody } from '../src/render/smith_heart/ring_crystal_pick';
import { SMITH_HEART_SEAL_CRYSTAL_TEMPLATE } from '../src/sim/content/smith_heart';
import {
  HEART_SEAL,
  SMITH_HEART_VEIN_COLORS,
  SMITH_HEART_VEINS,
} from '../src/sim/content/smith_heart_layout';

const DARK = [-1, -1, -1, -1];
const LIT = [999, 999, 999, 999];

describe('the crystal: the state the seal shows', () => {
  it('is dark and whole with no vein lit and nothing ready', () => {
    const s = ringCrystalState(DARK, -1, -1);
    expect(s.fill).toEqual([0, 0, 0, 0]);
    expect(s.level).toEqual([0, 0, 0, 0]);
    expect(s.crown).toBe(0);
    expect(s.ready).toBe(0);
    expect(s.charge).toBe(0);
    expect(s.burstT).toBe(-1);
  });

  it("climbs an element's crystal on its own vein's lighting, once its light has run to the seal", () => {
    // Hammer first (SMITH_HEART_VEINS order), the other three dark.
    const before = ringCrystalState([HEART_SEAL_ARRIVAL - 0.1, -1, -1, -1], -1, -1);
    expect(before.fill[0]).toBe(0);
    const mid = ringCrystalState(
      [HEART_SEAL_ARRIVAL + HEART_SEAL_FILL_SECONDS / 2, -1, -1, -1],
      -1,
      -1,
    );
    expect(mid.fill[0]).toBeGreaterThan(0.5);
    expect(mid.fill[0]).toBeLessThan(1);
    expect(mid.level[0]).toBeGreaterThan(0.7);
    // Only that element: the others stay dark.
    expect(mid.fill.slice(1)).toEqual([0, 0, 0]);
    expect(mid.level.slice(1)).toEqual([0, 0, 0]);
    // Lit long ago: burning steady, to the tip.
    const old = ringCrystalState([999, -1, -1, -1], -1, -1);
    expect(old.fill[0]).toBe(1);
    expect(old.level[0]).toBe(1);
  });

  it('glows the heart as the four fill, and swells the whole crystal once it is ready', () => {
    const one = ringCrystalState([999, -1, -1, -1], -1, -1);
    const all = ringCrystalState(LIT, -1, -1);
    expect(all.crown).toBeGreaterThan(one.crown);
    expect(one.crown).toBeGreaterThan(0);
    expect(all.ready).toBe(0);
    const rising = ringCrystalState(LIT, RING_CRYSTAL_READY_RISE / 2, -1);
    expect(rising.ready).toBeGreaterThan(0);
    expect(rising.ready).toBeLessThan(1);
    const ready = ringCrystalState(LIT, 999, -1);
    expect(ready.ready).toBe(1);
    expect(ready.crown).toBeGreaterThan(all.crown);
    // A crystal that is ready but whose seal is not lit is never ready (the sim derives it
    // from both; a stale bit never swells a dark crystal's heart past its fill).
    expect(ringCrystalState(DARK, -1, -1).ready).toBe(0);
    expect(ringCrystalState(DARK, 999, -1).ready).toBe(0);
  });

  it('waits for the last element to finish filling before it swells, ready bit or not', () => {
    const done = HEART_SEAL_ARRIVAL + HEART_SEAL_FILL_SECONDS;
    // The ready bit arrived with the fourth vein (the Ring was already clear): its light has
    // only just reached the seal, so nothing swells yet.
    const arriving = HEART_SEAL_ARRIVAL + 0.1;
    expect(ringCrystalState([999, 999, 999, arriving], arriving, -1).ready).toBe(0);
    expect(ringCrystalState([999, 999, 999, done - 0.01], done - 0.01, -1).ready).toBe(0);
    // Then the swell rises over its own rise time, counted from the fill's end (ease(1/2)).
    const half = done + RING_CRYSTAL_READY_RISE / 2;
    expect(ringCrystalState([999, 999, 999, half], half, -1).ready).toBeCloseTo(0.5, 6);
    // A Ring cleared long after the fills finished swells from the clearing, not before it.
    const cleared = RING_CRYSTAL_READY_RISE / 2;
    expect(ringCrystalState(LIT, cleared, -1).ready).toBeCloseTo(0.5, 6);
  });

  it('overloads for the charge, then shatters: every element at its full, the swell gone', () => {
    const O = HEART_PORTAL_OPEN;
    const early = ringCrystalState(LIT, 999, O.charge * 0.5);
    expect(early.charge).toBeGreaterThan(0.2);
    expect(early.burstT).toBe(-1);
    expect(early.ready).toBe(0);
    const shatter = ringCrystalState(LIT, 999, O.charge + 1);
    expect(shatter.burstT).toBeCloseTo(1, 6);
    expect(shatter.fill).toEqual([1, 1, 1, 1]);
    for (const l of shatter.level) expect(l).toBeGreaterThanOrEqual(1.1);
    // Even a seal the burst caught half lit burns whole while it goes up.
    const half = ringCrystalState([999, 999, -1, -1], -1, O.charge + 1);
    expect(half.fill).toEqual([1, 1, 1, 1]);
    // Met long after: whole shards, no overload.
    const old = ringCrystalState(LIT, 999, 999);
    expect(old.charge).toBe(0);
    expect(old.burstT).toBeGreaterThan(900);
  });

  it('writes the material for a moving crystal and not for a steady one', () => {
    const last = newRingCrystalLast();
    expect(ringCrystalChanged(ringCrystalState(LIT, 999, -1), last)).toBe(true);
    expect(ringCrystalChanged(ringCrystalState(LIT, 999, -1), last)).toBe(false);
    expect(ringCrystalChanged(ringCrystalState([999, 999, 999, -1], 999, -1), last)).toBe(true);
    expect(ringCrystalChanged(ringCrystalState(LIT, 0.5, -1), last)).toBe(true);
    expect(ringCrystalChanged(ringCrystalState(LIT, 999, 0.3), last)).toBe(true);
  });

  it('notices a one-step move in every field, with every element lit (no packed hash)', () => {
    // The first cut packed the fields into one double: past about 1e16 a double steps by
    // 16, so most one-step changes of the late fields (the overload's whitening) vanished.
    const base = (): RingCrystalState => {
      const s = ringCrystalState(LIT, 999, -1);
      s.charge = 0.5;
      return s;
    };
    const moves: [string, (s: RingCrystalState) => void][] = [
      ['crown', (s) => (s.crown += 1 / 64)],
      ['ready', (s) => (s.ready += 1 / 64)],
      ['charge', (s) => (s.charge += 1 / 64)],
      ...[0, 1, 2, 3].flatMap((i): [string, (s: RingCrystalState) => void][] => [
        [`fill ${i}`, (s) => (s.fill[i] -= 1 / 128)],
        [`level ${i}`, (s) => (s.level[i] += 1 / 64)],
      ]),
    ];
    for (const [name, move] of moves) {
      const last = newRingCrystalLast();
      ringCrystalChanged(base(), last);
      const next = base();
      move(next);
      expect(ringCrystalChanged(next, last), name).toBe(true);
    }
    // And every one-step charge change along the whole overload reads as a change.
    const last = newRingCrystalLast();
    ringCrystalChanged(base(), last);
    for (let q = 33; q <= 64; q++) {
      const s = base();
      s.charge = q / 64;
      expect(ringCrystalChanged(s, last), `charge ${q}`).toBe(true);
    }
  });

  it("windows each piece over the whole's index: prefix spans, in node order", () => {
    expect(ringCrystalPieceSpans([])).toEqual([]);
    expect(ringCrystalPieceSpans([6, 0, 9, 3])).toEqual([
      { start: 0, count: 6 },
      { start: 6, count: 0 },
      { start: 6, count: 9 },
      { start: 15, count: 3 },
    ]);
  });

  it('trembles only through the overload, writing into a caller-owned state', () => {
    expect(ringCrystalTremble(0)).toBe(0);
    expect(ringCrystalTremble(1)).toBeGreaterThan(0.05);
    const out = newRingCrystalState();
    expect(ringCrystalState(LIT, 999, -1, out)).toBe(out);
  });
});

describe('the crystal: the pieces fly', () => {
  const kinds: [RingCrystalPieceKind, { x: number; y: number; z: number }][] = [
    ['plinth', { x: 3.2, y: 0.6, z: 1.1 }],
    ['plinth', { x: -2.5, y: 0.6, z: -2.4 }],
    ['body', { x: 0.2, y: 4, z: -2.6 }],
    ['body', { x: 2.4, y: 5.5, z: 0.3 }],
    ['body', { x: -1.8, y: 8.2, z: 1.2 }],
    ['heart', { x: 0, y: 11.5, z: 0 }],
  ];

  it('holds every piece whole until the shatter', () => {
    for (const [i, [kind, c]] of kinds.entries()) {
      const pose = ringCrystalPiecePose(i, kind, c, -1);
      expect(pose).toEqual({ dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, scale: 1, visible: true });
    }
  });

  it('throws every piece out of its place at the blast', () => {
    for (const [i, [kind, c]] of kinds.entries()) {
      const pose = ringCrystalPiecePose(i, kind, c, 0.3);
      // The plinth's slabs slide and sink (a smaller move); the crystal's pieces are thrown.
      expect(Math.hypot(pose.dx, pose.dy, pose.dz), `${kind} ${i}`).toBeGreaterThan(
        kind === 'plinth' ? 0.8 : 1,
      );
      expect(pose.visible).toBe(true);
    }
  });

  it('classes a body piece wider than any cluster as the grey core', () => {
    expect(ringCrystalPieceRole('body', RING_CRYSTAL_CORE_RADIUS + 0.1)).toBe('core');
    expect(ringCrystalPieceRole('body', RING_CRYSTAL_CORE_RADIUS - 0.1)).toBe('body');
    expect(ringCrystalPieceRole('plinth', 9)).toBe('plinth');
    expect(ringCrystalPieceRole('heart', 9)).toBe('heart');
  });

  it('lets the grey core vanish in the flash where it stood, never thrown', () => {
    const c = { x: 0, y: 4.7, z: 0 };
    expect(ringCrystalPiecePose(6, 'core', c, -1).scale).toBe(1);
    const early = ringCrystalPiecePose(6, 'core', c, 0.1);
    expect([early.dx, early.dy, early.dz, early.rx, early.ry, early.rz]).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect(early.scale).toBeLessThan(1);
    expect(early.scale).toBeGreaterThan(0.5);
    const gone = ringCrystalPiecePose(6, 'core', c, 0.5);
    expect(gone.visible).toBe(false);
    expect(gone.scale).toBe(0);
  });

  it("sinks the plinth's slabs into the dais instead of throwing them up", () => {
    for (const [i, [kind, c]] of kinds.entries()) {
      if (kind !== 'plinth') continue;
      // Never higher than a hand over where it stood, and under the dais by half a second.
      let peak = 0;
      for (let t = 0; t < 0.5; t += 0.02)
        peak = Math.max(peak, ringCrystalPiecePose(i, kind, c, t).dy);
      expect(peak, `${i}`).toBeLessThan(0.3);
      expect(ringCrystalPiecePose(i, kind, c, 0.6).dy + c.y, `${i}`).toBeLessThan(-1);
    }
  });

  it("settles the crystal's pieces into an orbit over every head, and turns them on", () => {
    for (const [i, [kind, c]] of kinds.entries()) {
      if (kind === 'plinth') continue;
      const at = ringCrystalPiecePose(i, kind, c, 60 + i);
      const x = c.x + at.dx;
      const y = c.y + at.dy;
      const z = c.z + at.dz;
      expect(Math.hypot(x, z), `${kind} ${i}`).toBeGreaterThan(6);
      expect(Math.hypot(x, z)).toBeLessThan(12.1);
      // Over a body's head, under the funnel's top.
      expect(y).toBeGreaterThan(6.5);
      expect(y).toBeLessThan(21.6);
      expect(at.scale).toBeGreaterThan(0.4);
      expect(at.visible).toBe(true);
      const later = ringCrystalPiecePose(i, kind, c, 64 + i);
      expect(Math.hypot(later.dx - at.dx, later.dz - at.dz)).toBeGreaterThan(0.2);
    }
  });

  it("lets the plinth's stones fall away and vanish", () => {
    for (const [i, [kind, c]] of kinds.entries()) {
      if (kind !== 'plinth') continue;
      expect(ringCrystalPiecePose(i, kind, c, 0.5).visible).toBe(true);
      const gone = ringCrystalPiecePose(i, kind, c, 6);
      expect(gone.visible).toBe(false);
      expect(gone.scale).toBeLessThan(0.01);
    }
  });

  it('is deterministic and writes into a caller-owned pose', () => {
    const out = newRingCrystalPiecePose();
    const a = { ...ringCrystalPiecePose(3, 'body', kinds[3][1], 1.7, out) };
    const b = { ...ringCrystalPiecePose(3, 'body', kinds[3][1], 1.7) };
    expect(a).toEqual(b);
  });

  it("reads a piece's kind off its node name only", () => {
    expect(ringCrystalPieceKind('Piece_07_body')).toBe('body');
    expect(ringCrystalPieceKind('Piece_00_plinth')).toBe('plinth');
    expect(ringCrystalPieceKind('Piece_17_heart')).toBe('heart');
    expect(ringCrystalPieceKind('Icosphere')).toBeNull();
    expect(ringCrystalPieceKind('SmithHeartRingCrystal')).toBeNull();
  });
});

describe('the crystal: the material', () => {
  it('lights by the seal state, over the painting, with each vein its own colour', () => {
    const map = new THREE.Texture();
    const m = ringCrystalMaterial(map);
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    const u = m.uniforms;
    expect(u.uMap.value).toBe(map);
    for (const name of ['uFill', 'uLevel', 'uCrown', 'uReady', 'uCharge', 'uTime', 'uColors'])
      expect(u[name], name).toBeDefined();
    const colors = u.uColors.value as THREE.Color[];
    expect(colors.map((c) => c.getHex())).toEqual(
      SMITH_HEART_VEINS.map((v) => SMITH_HEART_VEIN_COLORS[v]),
    );
    // The weights ride a custom attribute, never COLOR_0.
    expect(m.vertexShader).toContain('attribute vec4 _weights;');
    expect(m.vertexShader).toContain('attribute float _path;');
    // The world's lights are not read: no program depends on the light census.
    expect(m.lights).toBe(false);
  });
});

// ---- the shipped GLB -------------------------------------------------------------------

// A literal, never the build script's ASSET: importing a ship step runs it.
const MODEL = 'public/models/props/smith_heart_ring_crystal.glb';
const haveModel = existsSync(MODEL);

interface Piece {
  name: string;
  triangles: number;
  /** Per vertex: world position and weights. */
  verts: { p: [number, number, number]; w: [number, number, number, number] }[];
}

const pieces: Piece[] = [];
let textureMime: string[] = [];
let extensionsUsed: string[] = [];
let materialSlots: { base: boolean; normal: boolean; mr: boolean }[] = [];
let extras: Record<string, unknown> = {};

beforeAll(async () => {
  if (!haveModel) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(MODEL)));
  const root = doc.getRoot();
  extras = (root.getExtras() ?? {}) as Record<string, unknown>;
  textureMime = root.listTextures().map((t) => t.getMimeType());
  extensionsUsed = root.listExtensionsUsed().map((e) => e.extensionName);
  materialSlots = root.listMaterials().map((m) => ({
    base: !!m.getBaseColorTexture(),
    normal: !!m.getNormalTexture(),
    mr: !!m.getMetallicRoughnessTexture(),
  }));
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    const verts: Piece['verts'] = [];
    let triangles = 0;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const weights = prim.getAttribute('_WEIGHTS');
      if (!pos) continue;
      triangles += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
      const e: number[] = [];
      const w: number[] = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, e);
        weights?.getElement(i, w);
        verts.push({
          p: [
            m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
            m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
            m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
          ],
          w: weights ? [w[0], w[1], w[2], w[3]] : [NaN, NaN, NaN, NaN],
        });
      }
    }
    pieces.push({ name: node.getName(), triangles, verts });
  }
});

describe('the crystal: the shipped GLB', () => {
  it.skipIf(!haveModel)(
    'is the Tripo build cut into pieces along its own shells, inside its budget',
    () => {
      // Six sectors of the plinth, fourteen clusters of crystals, the heart's shaft.
      expect(pieces.map((p) => p.name).sort()).toEqual(
        Array.from({ length: 21 }, (_, i) => {
          const kind = i < 6 ? 'plinth' : i < 20 ? 'body' : 'heart';
          return `Piece_${String(i).padStart(2, '0')}_${kind}`;
        }),
      );
      for (const p of pieces) expect(ringCrystalPieceKind(p.name), p.name).not.toBeNull();
      const tris = pieces.reduce((n, p) => n + p.triangles, 0);
      expect(tris).toBeLessThanOrEqual(16_000);
      expect(tris).toBeGreaterThan(10_000);
      expect(extras.authoring).toBeTruthy();
    },
  );

  it.skipIf(!haveModel)(
    "stands the size the sim and the plan read: its foot on the dais, its plinth the wall's",
    () => {
      let lo = Infinity;
      let hi = -Infinity;
      let reach = 0;
      for (const p of pieces)
        for (const v of p.verts) {
          lo = Math.min(lo, v.p[1]);
          hi = Math.max(hi, v.p[1]);
          reach = Math.max(reach, Math.hypot(v.p[0], v.p[2]));
        }
      expect(lo).toBeGreaterThan(-0.05);
      expect(lo).toBeLessThan(0.05);
      expect(hi).toBeCloseTo(RING_CRYSTAL.height, 1);
      // The widest shard stands on the seal's inner circle, the plinth's stones just inside it.
      expect(reach).toBeGreaterThan(RING_CRYSTAL.plinthR - 0.3);
      expect(reach).toBeLessThan(HEART_SEAL.r);
    },
  );

  it.skipIf(!haveModel)(
    "puts each element on its own vein's side: the Hammer south, the Breath north, the Quench east, the Heat west",
    () => {
      const sum = [0, 0, 0, 0];
      const cx = [0, 0, 0, 0];
      const cz = [0, 0, 0, 0];
      for (const p of pieces)
        for (const v of p.verts)
          for (let k = 0; k < 4; k++) {
            sum[k] += v.w[k];
            cx[k] += v.w[k] * v.p[0];
            cz[k] += v.w[k] * v.p[2];
          }
      const mean = (k: number): [number, number] => [cx[k] / sum[k], cz[k] / sum[k]];
      const [hx, hz] = mean(SMITH_HEART_VEINS.indexOf('hammer'));
      const [bx, bz] = mean(SMITH_HEART_VEINS.indexOf('breath'));
      const [qx, qz] = mean(SMITH_HEART_VEINS.indexOf('quench'));
      const [fx, fz] = mean(SMITH_HEART_VEINS.indexOf('heat'));
      // The Grand Stair comes down from the south (-z), the North Stair from the north.
      expect(hz).toBeLessThan(-0.8);
      expect(Math.abs(hx)).toBeLessThan(0.5);
      expect(bz).toBeGreaterThan(0.8);
      expect(Math.abs(bx)).toBeLessThan(0.5);
      expect(qx).toBeGreaterThan(0.8);
      expect(Math.abs(qz)).toBeLessThan(0.5);
      expect(fx).toBeLessThan(-0.8);
      expect(Math.abs(fz)).toBeLessThan(0.5);
    },
  );

  it.skipIf(!haveModel)(
    'weighs every vertex at most one, the white-gold heart the remainder at the top',
    () => {
      let hearts = 0;
      let tall = 0;
      for (const p of pieces)
        for (const v of p.verts) {
          for (const x of v.w) {
            expect(Number.isFinite(x), p.name).toBe(true);
            expect(x).toBeGreaterThanOrEqual(-1e-4);
          }
          const total = v.w[0] + v.w[1] + v.w[2] + v.w[3];
          expect(total, p.name).toBeLessThanOrEqual(1.0001);
          if (1 - total > 0.5) {
            hearts++;
            // The heart's shaft stands on the axis (its shells' centres within a third of the
            // reach, the build's crown radius, plus their own width), most of it over the clusters.
            if (v.p[1] > RING_CRYSTAL.height * 0.4) tall++;
            expect(Math.hypot(v.p[0], v.p[2])).toBeLessThan(RING_CRYSTAL.plinthR * 0.55);
          }
        }
      expect(hearts).toBeGreaterThan(100);
      expect(tall).toBeGreaterThan(hearts / 2);
    },
  );

  it.skipIf(!haveModel)('has one grey core wider than any cluster, and nothing else is', () => {
    // The painter classes a body piece by how far its vertices reach from its centre
    // (ring_crystal.ts bakeModel): the mass of dark rock under the crystals is the one piece
    // the burst must not throw as a plate sixteen yards wide.
    const radiusOf = (p: Piece): number => {
      const n = p.verts.length;
      const cx = p.verts.reduce((a, v) => a + v.p[0], 0) / n;
      const cz = p.verts.reduce((a, v) => a + v.p[2], 0) / n;
      return Math.max(...p.verts.map((v) => Math.hypot(v.p[0] - cx, v.p[2] - cz)));
    };
    const roles = pieces.map((p) => {
      const kind = ringCrystalPieceKind(p.name);
      if (!kind) throw new Error(p.name);
      return ringCrystalPieceRole(kind, radiusOf(p));
    });
    expect(roles.filter((r) => r === 'core')).toHaveLength(1);
    expect(roles.filter((r) => r === 'plinth')).toHaveLength(6);
    expect(roles.filter((r) => r === 'body')).toHaveLength(13);
    expect(roles.filter((r) => r === 'heart')).toHaveLength(1);
  });

  it.skipIf(!haveModel)('ships the painting alone, as KTX2, on a material both sides draw', () => {
    expect(materialSlots).toHaveLength(1);
    expect(materialSlots[0]).toEqual({ base: true, normal: false, mr: false });
    expect(textureMime).toEqual(['image/ktx2']);
    expect(extensionsUsed).toContain('KHR_texture_basisu');
  });
});

describe("the crystal's entity: an empty anchor with a click volume, never the generic object", () => {
  const entity = (templateId: string) => ({
    templateId,
    dungeonId: 'smith_heart',
    pos: { x: 0, z: 0 },
  });

  it('plans the pressable crystal as its own anchor, and leaves the markers to theirs', () => {
    const plan = gateObjectPlan(entity(SMITH_HEART_SEAL_CRYSTAL_TEMPLATE));
    expect(plan).toEqual({ heartSealCrystal: true, height: RING_CRYSTAL_CLICK.labelHeight });
    // A marker is still the markers' empty reporting anchor, not the crystal's click body.
    expect(gateObjectPlan(entity('smith_heart_seal_15'))).toEqual({
      encounterAnchor: true,
      height: 2,
    });
  });

  it('is clickable over the whole silhouette and only there, though it draws nothing', () => {
    const plan = gateObjectPlan(entity(SMITH_HEART_SEAL_CRYSTAL_TEMPLATE));
    if (!plan) throw new Error('no plan');
    const body = buildGateObject(plan);
    body.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    body.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].visible).toBe(false);
    const hit = (from: [number, number, number], to: [number, number, number]) => {
      const dir = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
      return new THREE.Raycaster(new THREE.Vector3(...from), dir, 0, 200).intersectObject(
        body,
        true,
      ).length;
    };
    // A ray along the ground-level run from the south, at the foot, mid-height and near the tip.
    for (const y of [0.5, 6, RING_CRYSTAL_CLICK.height - 1]) {
      expect(hit([0, y, -40], [0, y, 0]), `y ${y}`).toBeGreaterThan(0);
    }
    // Past the foot's radius, over the tip and under the floor: a miss.
    expect(hit([RING_CRYSTAL_CLICK.baseR + 2, 3, -40], [RING_CRYSTAL_CLICK.baseR + 2, 3, 0])).toBe(
      0,
    );
    expect(
      hit([0, RING_CRYSTAL_CLICK.height + 2, -40], [0, RING_CRYSTAL_CLICK.height + 2, 0]),
    ).toBe(0);
    // The volume is shared (process lifetime), so a second view never owns its geometry.
    const again = buildRingCrystalClickBody();
    const geometries = new Set<THREE.BufferGeometry>();
    again.traverse((o) => {
      if (o instanceof THREE.Mesh) geometries.add(o.geometry);
    });
    expect(geometries.has(meshes[0].geometry)).toBe(true);
    expect(meshes[0].geometry.userData.sharedRendererResource).toBe(true);
  });

  it('keeps the volume inside the plinth and as tall as the crystal', () => {
    expect(RING_CRYSTAL_CLICK.baseR).toBeLessThanOrEqual(RING_CRYSTAL.plinthR);
    expect(RING_CRYSTAL_CLICK.topR).toBeLessThan(RING_CRYSTAL_CLICK.baseR);
    expect(RING_CRYSTAL_CLICK.height).toBe(RING_CRYSTAL.height);
  });
});
