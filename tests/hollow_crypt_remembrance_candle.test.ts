// The Remembrance Candle's model (Kit_RemembranceCandle in
// public/models/props/hollow_crypt_kit.glb, built by
// docs/design/dungeon-rework/kit/build_hollow_crypt_kit.py), held to what the
// game reads off it: the sim's pillar (its collider, where the usable body
// stands), the render plan's wick, flame tip and tallow radius
// (morthen_rite_fx_core.ts), the lamp's flame socket (crypt_plan_core.ts), and
// the rule that makes a lit candle and a guttered one unmistakable on every
// graphics tier: everything that glows is on the glow slot, the one batch
// instance the Rite hides (rite_candle_decor.ts).

import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { KIT_FLAME_SOCKETS } from '../src/render/hollow_crypt/crypt_plan_core';
import {
  CANDLE_FLAME_TIP_Y,
  CANDLE_TALLOW_RADIUS,
  CANDLE_WICK_Y,
} from '../src/render/hollow_crypt/morthen_rite_fx_core';
import { tagRiteCandleGlow } from '../src/render/hollow_crypt/rite_candle_decor';
import {
  RITE_CANDLE_RADIUS,
  RITE_CANDLE_SPOTS,
} from '../src/sim/encounters/hollow_crypt/morthen_ids';

/** A player stands 2.6 yd. */
const PLAYER = 2.6;

interface Vert {
  x: number;
  y: number;
  z: number;
  /** Distance from the candle's axis. */
  r: number;
  /** Linear vertex colour. */
  c: [number, number, number];
}

const stone: Vert[] = [];
const glow: Vert[] = [];
let triangles = 0;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(
    new Uint8Array(readFileSync('public/models/props/hollow_crypt_kit.glb')),
  );
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === 'Kit_RemembranceCandle');
  const mesh = node?.getMesh();
  if (!node || !mesh) throw new Error('Kit_RemembranceCandle missing from the shipped kit');
  // The shipped positions are quantized: the node's matrix carries them to yards.
  const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  const p = new THREE.Vector3();
  const el = [0, 0, 0];
  const col = [0, 0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const color = prim.getAttribute('COLOR_0');
    if (!pos || !color) throw new Error('a candle primitive without positions or colours');
    const name = prim.getMaterial()?.getName() ?? '';
    // Stone and glow only: no silk, no texture, nothing that would need a third program.
    expect(['KitStone', 'KitGlow']).toContain(name);
    const into = name === 'KitGlow' ? glow : stone;
    triangles += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      color.getElement(i, col);
      p.fromArray(el).applyMatrix4(world);
      into.push({ x: p.x, y: p.y, z: p.z, r: Math.hypot(p.x, p.z), c: [col[0], col[1], col[2]] });
    }
  }
});

const maxOf = (list: Vert[], f: (v: Vert) => number) =>
  list.reduce((m, v) => Math.max(m, f(v)), -Infinity);
const minOf = (list: Vert[], f: (v: Vert) => number) =>
  list.reduce((m, v) => Math.min(m, f(v)), Infinity);

describe('the Remembrance Candle: the pillar the sim and the click see', () => {
  it('stands on the floor, on its own collider, where the sim puts it', () => {
    expect(RITE_CANDLE_SPOTS).toHaveLength(4);
    expect(minOf(stone, (v) => v.y)).toBeGreaterThanOrEqual(-0.02);
    expect(minOf(stone, (v) => v.y)).toBeLessThan(0.05);
    // The plinth is the collider (a step proud of it, as the old ring was):
    // nothing a player could walk into reaches past it.
    const reach = maxOf([...stone, ...glow], (v) => v.r);
    expect(reach).toBeGreaterThan(RITE_CANDLE_RADIUS);
    expect(reach).toBeLessThanOrEqual(RITE_CANDLE_RADIUS + 0.2);
  });

  it('is clearly taller than a player, and no taller than the room carries', () => {
    const top = maxOf(stone, (v) => v.y);
    expect(top).toBeGreaterThan(PLAYER * 2);
    expect(top).toBeLessThanOrEqual(PLAYER * 2.6);
  });

  it('keeps the wick, the tallow and the flame where the fight draws them', () => {
    // The wick: the dark stub on the axis, at the plan's height.
    const wick = stone.filter((v) => v.r < 0.12 && v.y > 3 && v.y < 4);
    expect(wick.length).toBeGreaterThan(0);
    expect(maxOf(wick, (v) => v.y)).toBeGreaterThan(CANDLE_WICK_Y);
    expect(maxOf(wick, (v) => v.y)).toBeLessThan(CANDLE_WICK_Y + 0.2);
    // The tallow pillar: a fat column on the axis up to the wick, its radius the plan's.
    const tallow = stone.filter((v) => v.y > 1.6 && v.y < 3.2 && v.r < 1.15);
    expect(tallow.length).toBeGreaterThan(30);
    expect(maxOf(tallow, (v) => v.r)).toBeGreaterThan(CANDLE_TALLOW_RADIUS - 0.1);
    expect(maxOf(tallow, (v) => v.r)).toBeLessThan(CANDLE_TALLOW_RADIUS + 0.2);
    // It is tallow: warm (the underside of an old run is the darkest of it),
    // never the grey of the plinth or the iron.
    for (const v of tallow) {
      expect(v.c[0]).toBeGreaterThan(v.c[2] * 1.2);
      expect(v.c[0]).toBeGreaterThan(0.2);
    }
    const mean = tallow.reduce((sum, v) => sum + v.c[0], 0) / tallow.length;
    expect(mean).toBeGreaterThan(0.5);
    // The flame: on the axis, from the wick to the plan's tip.
    const flame = glow.filter((v) => v.y > CANDLE_WICK_Y + 0.05);
    expect(flame.length).toBeGreaterThan(20);
    expect(maxOf(flame, (v) => v.y)).toBeCloseTo(CANDLE_FLAME_TIP_Y, 1);
    expect(maxOf(flame, (v) => v.r)).toBeLessThan(0.6);
    // The lamp's own flame cone burns inside it.
    const [sx, sy, sz] = KIT_FLAME_SOCKETS.Kit_RemembranceCandle;
    expect(Math.hypot(sx, sz)).toBe(0);
    expect(sy).toBeGreaterThan(CANDLE_WICK_Y);
    expect(sy).toBeLessThan(CANDLE_FLAME_TIP_Y);
    // The cage leaves the flame and the column of a relit candle clear.
    const cage = stone.filter((v) => v.y > CANDLE_WICK_Y + 0.3 && v.y < CANDLE_FLAME_TIP_Y);
    expect(cage.length).toBeGreaterThan(0);
    expect(minOf(cage, (v) => v.r)).toBeGreaterThan(1);
  });

  it('is a modest model: four of them stand in the ring', () => {
    expect(triangles).toBeGreaterThan(1500);
    expect(triangles).toBeLessThan(6500);
  });
});

describe('the Remembrance Candle: lit and guttered on every graphics tier', () => {
  it('carries every light on the glow slot, hot colours only', () => {
    expect(glow.length).toBeGreaterThan(60);
    for (const v of glow) {
      // Amber to white-hot: red leads, blue trails.
      expect(v.c[0]).toBeGreaterThan(0.6);
      expect(v.c[0]).toBeGreaterThanOrEqual(v.c[1]);
      expect(v.c[1]).toBeGreaterThan(v.c[2]);
    }
    // Light at three heights: the flame, the names on the plinth, the votive lights at its foot.
    expect(glow.some((v) => v.y > 4)).toBe(true);
    const names = glow.filter((v) => v.y > 0.25 && v.y < 0.7 && v.r > 0.9);
    const votives = glow.filter((v) => v.y > 0.3 && v.y < 1.1 && v.r > 1.15);
    expect(names.length).toBeGreaterThan(20);
    expect(votives.length).toBeGreaterThan(10);
    // The names face all four ways: no side of the ring reads a blank plinth.
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      expect(names.some((v) => v.x * dx + v.z * dz > 0.9)).toBe(true);
    }
  });

  it('leaves nothing warm behind when the glow goes: a dark candle is iron, stone and cold wax', () => {
    // No stone vertex is as hot as the dimmest glow: with the glow batch
    // hidden nothing on the candle still reads as lit.
    const dimmestGlow = minOf(glow, (v) => v.c[0] - v.c[2]);
    const hottestStone = maxOf(stone, (v) => v.c[0] - v.c[2]);
    expect(hottestStone).toBeLessThan(dimmestGlow);
  });

  it('the Rite hides the whole glow slot of one candle and only that one', () => {
    // The batch crypt_kit.ts builds: one instance per candle, tagged by its spot.
    const mesh = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      4,
    );
    const m = new THREE.Matrix4();
    RITE_CANDLE_SPOTS.forEach((s, k) => {
      mesh.setMatrixAt(k, m.makeTranslation(s.x, 0, s.z));
    });
    tagRiteCandleGlow(mesh, RITE_CANDLE_SPOTS);
    const tag = mesh.userData.riteCandleGlow as { instanceOf: number[]; matrices: THREE.Matrix4[] };
    expect(tag.instanceOf).toEqual([0, 1, 2, 3]);
    expect(tag.matrices).toHaveLength(4);
    RITE_CANDLE_SPOTS.forEach((s, k) => {
      expect(tag.matrices[k].elements[12]).toBe(s.x);
      expect(tag.matrices[k].elements[14]).toBe(s.z);
    });
  });
});
