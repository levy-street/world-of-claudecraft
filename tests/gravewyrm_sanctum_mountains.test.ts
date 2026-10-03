// The Gravewyrm Sanctum's cirque (the eroded heightfield built by
// docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_mountains.py, shipped
// by scripts/assets/gravewyrm_sanctum_mountains/build.mjs): the shipped GLB is
// the current sources', its textures are KTX2, nothing of it rises into the
// walkable field (everything inside lies under the crevasse void), and the
// ring closes the bowl on EVERY side, high above the floor (never a horizon of
// sea or mist, never an island), with the pass behind the Gate Landing and the
// glacier rising north behind the Calving Face.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSET, sourceFingerprint } from '../scripts/assets/gravewyrm_sanctum_mountains/build.mjs';

const FILE = ASSET.target;
const have = existsSync(FILE);
// The walkable field (instance-local yards, z north) and the crevasse void.
const FIELD = { minX: -114, maxX: 114, minZ: -236, maxZ: 238 };
const VOID = -60;
const LANDING = { x: 0, z: -222, y: 55 };
const LAKE = { x: 0, z: 188, y: 0 };

const points: [number, number, number][] = [];
let extras: Record<string, unknown> = {};
let mimes: string[] = [];

beforeAll(async () => {
  if (!have) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(FILE)));
  extras = (doc.getRoot().getExtras() ?? {}) as Record<string, unknown>;
  mimes = doc
    .getRoot()
    .listTextures()
    .map((t) => t.getMimeType());
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        points.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
    }
  }
});

const inside = (x: number, z: number): boolean =>
  x >= FIELD.minX && x <= FIELD.maxX && z >= FIELD.minZ && z <= FIELD.maxZ;

describe('the Gravewyrm Sanctum cirque', () => {
  it.skipIf(!have)('ships the current sources, with KTX2 textures, inside the size budget', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(mimes.length).toBe(2);
    for (const m of mimes) expect(m).toBe('image/ktx2');
    expect(statSync(FILE).size).toBeLessThanOrEqual(6 * 1024 * 1024);
    expect(points.length).toBeGreaterThan(30000);
  });

  it.skipIf(!have)('holds everything inside the walkable field under the crevasse void', () => {
    let held = 0;
    for (const [x, y, z] of points) {
      if (!inside(x, z)) continue;
      held++;
      expect(y, `${x}, ${z}`).toBeLessThan(VOID - 2);
    }
    expect(held).toBeGreaterThan(2000);
  });

  it.skipIf(!have)('closes the bowl on every side, high over the floor, from the lake', () => {
    // The skyline by bearing from the lake: the highest point seen in each
    // sector, as an elevation angle. Every sector is walled (no gap to a
    // horizon) and the ring stands 120 yd and more over the floor.
    const sectors = 36;
    const sky = new Array<number>(sectors).fill(-1);
    const height = new Array<number>(sectors).fill(-Infinity);
    for (const [x, y, z] of points) {
      const dx = x - LAKE.x;
      const dz = z - LAKE.z;
      const r = Math.hypot(dx, dz);
      if (r < 60) continue;
      const s = Math.floor(((Math.atan2(dx, dz) + Math.PI) / (Math.PI * 2)) * sectors) % sectors;
      sky[s] = Math.max(sky[s], Math.atan2(y - LAKE.y, r));
      height[s] = Math.max(height[s], y);
    }
    for (let s = 0; s < sectors; s++) {
      expect(sky[s], `sector ${s}`).toBeGreaterThan(0.12);
      expect(height[s], `sector ${s}`).toBeGreaterThan(120);
    }
  });

  it.skipIf(!have)('walls the Gate Landing in on its pass, and raises the glacier north', () => {
    // Behind the landing (south, just past the field) the rim stands over it.
    const behind = points.filter(
      ([x, , z]) => Math.abs(x - LANDING.x) < 30 && z < FIELD.minZ - 20 && z > FIELD.minZ - 60,
    );
    expect(behind.length).toBeGreaterThan(10);
    expect(Math.max(...behind.map((p) => p[1]))).toBeGreaterThan(LANDING.y + 40);
    // North of the face the Quench climbs away from the lake.
    const near = points.filter(([x, , z]) => Math.abs(x) < 60 && z > 300 && z < 360);
    const far = points.filter(([x, , z]) => Math.abs(x) < 60 && z > 600 && z < 700);
    const mean = (a: [number, number, number][]) => a.reduce((t, p) => t + p[1], 0) / a.length;
    expect(mean(near)).toBeGreaterThan(80);
    expect(mean(far)).toBeGreaterThan(mean(near) + 40);
  });
});
