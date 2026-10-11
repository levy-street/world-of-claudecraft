// The WOC character LOD generator (scripts/assets/woc_character/lod_indices.mjs): every level it
// writes is held to its MEASURED deviation bound by an independent brute-force measure, the mid
// level never goes under its 40% floor, a level that would not save a tenth of the triangles is
// left out (so a primitive may carry the far level alone, or nothing), the vertices, uvs and
// morph targets are never touched, and a primitive of more than 65,535 vertices gets 32-bit
// level indices. The file side of the levels is tests/woc_lod_extension.test.ts.
import { Accessor, Document } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addLodIndices,
  characterSpace,
  LOD_LADDER,
  LOD_LEVELS,
  LOD_MIN_SAVING,
  LOD_NORMAL_WEIGHT,
  LOD_UV_WEIGHT,
  lodMorphWeights,
  measureDeviation,
} from '../scripts/assets/woc_character/lod_indices.mjs';
import { WOC_LOD, type WocLod } from '../scripts/assets/woc_character/woc_lod_extension.mjs';
import { bruteDeviation, gridPrimitive, hang, waves } from './helpers/woc_lod_fixtures';

beforeAll(async () => {
  await MeshoptSimplifier.ready;
});

const levelsOf = (prim: { getExtension(name: string): unknown }) =>
  (prim.getExtension(WOC_LOD) as WocLod | null)?.listLevels() ?? [];

const trianglesOf = (level: { getIndices(): Accessor | null }) =>
  (level.getIndices()?.getCount() ?? 0) / 3;

const bytesOf = (accessor: Accessor | null) =>
  Buffer.from((accessor?.getArray() ?? new Uint8Array(0)).slice().buffer);

describe('woc lod indices: the settings', () => {
  it('keeps the study settings: mid 0.45% with locked borders over a 40% floor, far 1.25% free', () => {
    expect(LOD_LEVELS.map((l) => ({ ...l }))).toEqual([
      { name: 'mid', limit: 0.0045, floor: 0.4, lockBorder: true },
      { name: 'far', limit: 0.0125, floor: 0, lockBorder: false },
    ]);
    expect(LOD_NORMAL_WEIGHT).toBe(0.5);
    expect(LOD_UV_WEIGHT).toBe(1);
    expect(LOD_MIN_SAVING).toBe(0.1);
    expect(LOD_LADDER[0]).toBe(0.9);
    expect(LOD_LADDER.at(-1)).toBe(0.01);
    expect([...LOD_LADDER].sort((a, b) => b - a)).toEqual([...LOD_LADDER]);
  });

  it('pushes the eye and brow controls both ways and every other control one way', () => {
    expect(lodMorphWeights('FS_Eyes_Size')).toEqual([1, -1]);
    expect(lodMorphWeights('FS_Brows_Height')).toEqual([1, -1]);
    expect(lodMorphWeights('FS_Chin_Softness')).toEqual([1]);
    expect(lodMorphWeights('FS_Tuck_quiff')).toEqual([1]);
  });
});

describe('woc lod indices: the measured deviation', () => {
  it('agrees with a brute-force measure on random surfaces', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 5; round++) {
      const count = 300;
      const pos = new Float32Array(count * 3).map(() => rand());
      const lod: number[] = [];
      for (let t = 0; t < 60; t++) {
        lod.push(
          Math.floor(rand() * 150),
          Math.floor(rand() * 150),
          150 + Math.floor(rand() * 150),
        );
      }
      const all = Array.from({ length: count }, (_, i) => i);
      const fast = measureDeviation(pos, all, lod).max;
      expect(fast).toBeCloseTo(bruteDeviation(pos, all, lod), 6);
    }
  });

  it('reads every instance in the scene space: a node scale scales the deviation', () => {
    const doc = new Document();
    doc.createBuffer();
    const prim = gridPrimitive(doc, { n: 4, height: waves });
    const { node } = hang(doc, 'piece');
    node.getMesh()?.addPrimitive(prim);
    const near = characterSpace(prim, node);
    node.setScale([3, 3, 3]).setTranslation([1, 2, 3]);
    const far = characterSpace(prim, node);
    for (let i = 0; i < near.count; i++) {
      expect(far.pos[i * 3]).toBeCloseTo(3 * near.pos[i * 3] + 1, 5);
      expect(far.pos[i * 3 + 1]).toBeCloseTo(3 * near.pos[i * 3 + 1] + 2, 5);
    }
    // normals stay unit length through the scale
    expect(Math.hypot(far.nrm[0], far.nrm[1], far.nrm[2])).toBeCloseTo(1, 6);
  });
});

describe('woc lod indices: the levels', () => {
  it('keeps every emitted level within its measured bound, over level 0 vertices', async () => {
    const doc = new Document();
    doc.createBuffer();
    const prim = gridPrimitive(doc, { n: 24, height: waves });
    hang(doc, 'surface', prim);
    // a short character: both bounds bind (the floor and the ladder's end do not)
    const height = 0.2;
    const report = await addLodIndices(doc, { height });
    const levels = levelsOf(prim);
    expect(levels).toHaveLength(2);
    const row = report.primitives[0];
    expect(row.mid?.ladder).toBeGreaterThan(LOD_LEVELS[0].floor);
    expect(row.far?.ladder).toBeGreaterThan(LOD_LADDER.at(-1) ?? 0);
    const base = prim.getIndices()?.getArray() as Uint32Array;
    const pos = prim.getAttribute('POSITION')?.getArray() as Float32Array;
    const t0 = base.length / 3;
    levels.forEach((level, i) => {
      const spec = LOD_LEVELS[i];
      const ix = level.getIndices()?.getArray() as Uint16Array;
      const measured = bruteDeviation(pos, base, ix);
      // within the bound, and no more than the deviation the level records (rounded up)
      expect(measured, spec.name).toBeLessThanOrEqual(spec.limit * height);
      expect(measured, spec.name).toBeLessThanOrEqual(level.getMaxDeviation() + 1e-9);
      expect(level.getMaxDeviation() - measured, spec.name).toBeLessThan(2e-6);
      expect(ix.length / 3, spec.name).toBeLessThanOrEqual(0.9 * t0);
      // only the primitive's own vertices, and only ones level 0 draws
      const drawn = new Set(base);
      for (const v of ix) expect(drawn.has(v)).toBe(true);
    });
    expect(row.mid?.triangles).toBe(trianglesOf(levels[0]));
    expect(row.far?.triangles).toBeLessThan(row.mid?.triangles ?? 0);
    expect(report.totals).toMatchObject({ primitives: 1, withMid: 1, withFar: 1, triangles: t0 });
  });

  it('never takes the mid level under 40% of the triangles, however flat the surface', async () => {
    const doc = new Document();
    doc.createBuffer();
    const prim = gridPrimitive(doc, { n: 20 });
    hang(doc, 'flat', prim);
    const report = await addLodIndices(doc, { height: 1 });
    const [mid, far] = levelsOf(prim).map(trianglesOf);
    const t0 = 2 * 20 * 20;
    // a flat sheet simplifies for free: only the floor stops the mid level, at its 40% step
    expect(report.primitives[0].mid?.ladder).toBe(0.4);
    expect(mid).toBeGreaterThanOrEqual(Math.floor(0.4 * t0) - 2);
    expect(mid).toBeLessThanOrEqual(Math.ceil(0.4 * t0));
    // the far level has no floor, and on a flat sheet it costs nothing (float noise, rounded up
    // to the recorded micron)
    expect(far).toBeLessThan(0.1 * t0);
    expect(report.primitives[0].far?.maxDeviation).toBeLessThanOrEqual(1e-6);
  });

  it('leaves out a level that would not save a tenth of the triangles', async () => {
    // a tiny character: no collapse of these waves stays within its bound, so nothing saves
    const tiny = new Document();
    tiny.createBuffer();
    const still = gridPrimitive(tiny, { n: 12, height: waves });
    hang(tiny, 'tiny', still);
    const none = await addLodIndices(tiny, { height: 1e-4 });
    expect(levelsOf(still)).toEqual([]);
    expect(still.getExtension(WOC_LOD)).toBeNull();
    // and with no level anywhere the extension is not even created
    expect(
      tiny
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName),
    ).not.toContain(WOC_LOD);
    expect(none.primitives[0]).toMatchObject({ mid: null, far: null });

    // a saving threshold the mid level misses and the far level clears: the far level alone
    const doc = new Document();
    doc.createBuffer();
    const prim = gridPrimitive(doc, { n: 24, height: waves });
    hang(doc, 'surface', prim);
    const free = await addLodIndices(doc, { height: 1 });
    const midSaving = 1 - (free.primitives[0].mid?.share ?? 1);
    const farSaving = 1 - (free.primitives[0].far?.share ?? 1);
    expect(farSaving).toBeGreaterThan(midSaving + 0.05);
    const minSaving = (midSaving + farSaving) / 2;
    const report = await addLodIndices(doc, { height: 1, minSaving });
    const levels = levelsOf(prim);
    expect(levels).toHaveLength(1);
    expect(report.primitives[0].mid).toBeNull();
    expect(report.primitives[0].far?.triangles).toBe(trianglesOf(levels[0]));
    expect(levels[0].getMaxDeviation()).toBe(report.primitives[0].far?.maxDeviation);
    // the replaced run's accessors went with it: the levels' two plus level 0's four
    expect(doc.getRoot().listAccessors()).toHaveLength(4 + 1);
  });

  it('never touches the vertices, uvs, base indices or morph targets', async () => {
    const doc = new Document();
    doc.createBuffer();
    const prim = gridPrimitive(doc, {
      n: 16,
      height: waves,
      morph: (x, z) => [0, 0.02 * Math.exp(-8 * (x * x + z * z)), 0],
    });
    const { mesh } = hang(doc, 'face', prim);
    mesh.setExtras({ targetNames: ['FS_Chin_Softness'] });
    const target = prim.listTargets()[0];
    const watched = [prim.getIndices(), ...prim.listAttributes(), ...target.listAttributes()];
    const before = new Map(watched.map((a) => [a, bytesOf(a)]));
    const report = await addLodIndices(doc, { height: 1 });
    expect(levelsOf(prim).length).toBeGreaterThan(0);
    expect(prim.listTargets()).toEqual([target]);
    for (const [accessor, bytes] of before) expect(bytesOf(accessor).equals(bytes)).toBe(true);
    expect(prim.getIndices()).toBe(watched[0]);
    // the morph check: each level under the slider at full weight, against level 0 under it
    const morph = report.primitives[0].morph;
    expect(morph?.targets).toBe(1);
    expect(morph?.mid?.target).toBe('FS_Chin_Softness');
    expect(morph?.mid?.weight).toBe(1);
    expect(morph?.mid?.deviationShare).toBeLessThan(LOD_LEVELS[0].limit);
  });

  it('writes 32-bit level indices for a primitive of more than 65,535 vertices', async () => {
    const big = new Document();
    big.createBuffer();
    // the grid's own vertices numbered past 65,535: only 32-bit indices can name them
    const wide = gridPrimitive(big, { n: 20, height: waves, padding: 66000 });
    hang(big, 'wide', wide);
    await addLodIndices(big, { height: 1 });
    const levels = levelsOf(wide);
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) {
      const indices = level.getIndices() as Accessor;
      expect(indices.getComponentType()).toBe(Accessor.ComponentType.UNSIGNED_INT);
      expect(indices.getArray()).toBeInstanceOf(Uint32Array);
      expect(Math.min(...(indices.getArray() ?? []))).toBeGreaterThanOrEqual(66000);
    }

    const small = new Document();
    small.createBuffer();
    const narrow = gridPrimitive(small, { n: 20, height: waves });
    hang(small, 'narrow', narrow);
    await addLodIndices(small, { height: 1 });
    for (const level of levelsOf(narrow)) {
      expect(level.getIndices()?.getComponentType()).toBe(Accessor.ComponentType.UNSIGNED_SHORT);
    }
  });

  it('reports a primitive it cannot take levels for, and leaves it alone', async () => {
    const doc = new Document();
    doc.createBuffer();
    const prim = gridPrimitive(doc, { n: 4 });
    prim.setIndices(null);
    hang(doc, 'loose', prim);
    const report = await addLodIndices(doc, { height: 1 });
    expect(report.primitives[0].skipped).toBe('not indexed');
    expect(prim.getExtension(WOC_LOD)).toBeNull();
    await expect(addLodIndices(doc, { height: 0 })).rejects.toThrow(/height/);
  });

  it('holds a mesh drawn by several nodes to the bound in each, and counts every one', async () => {
    const height = 0.6;
    // one mesh on a node at scale 1 AND on one at 3x, where every deviation reads 3x larger
    const pair = new Document();
    pair.createBuffer();
    const shared = gridPrimitive(pair, { n: 24, height: waves });
    const { mesh } = hang(pair, 'small', shared);
    pair
      .getRoot()
      .listScenes()[0]
      .addChild(pair.createNode('big').setMesh(mesh).setScale([3, 3, 3]));
    const report = await addLodIndices(pair, { height });
    const base = shared.getIndices()?.getArray() as Uint32Array;
    const pos = shared.getAttribute('POSITION')?.getArray() as Float32Array;
    const pos3 = pos.map((v) => 3 * v);
    const levels = levelsOf(shared);
    expect(levels).toHaveLength(2);
    levels.forEach((level, i) => {
      const ix = level.getIndices()?.getArray() as Uint16Array;
      const near = bruteDeviation(pos, base, ix);
      const far = bruteDeviation(pos3, base, ix);
      expect(far).toBeCloseTo(3 * near, 6);
      // the 3x node holds the level to the bound, and the recorded deviation is its
      expect(far).toBeLessThanOrEqual(LOD_LEVELS[i].limit * height);
      expect(level.getMaxDeviation() - far).toBeLessThan(2e-6);
      expect(level.getMaxDeviation()).toBeGreaterThanOrEqual(far - 1e-9);
    });
    // drawn at scale 1 alone, the same bound lets the far level go further
    const solo = new Document();
    solo.createBuffer();
    const single = gridPrimitive(solo, { n: 24, height: waves });
    hang(solo, 'small', single);
    await addLodIndices(solo, { height });
    expect(trianglesOf(levelsOf(single)[1])).toBeLessThan(trianglesOf(levels[1]));
    // the totals count what is drawn: the one mesh twice
    expect(report.primitives[0].spaces).toBe(2);
    expect(report.totals.triangles).toBe(2 * 2 * 24 * 24);
    expect(report.totals.far).toBe(2 * trianglesOf(levels[1]));
  });
});
