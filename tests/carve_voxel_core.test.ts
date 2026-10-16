import { describe, expect, it } from 'vitest';
import {
  commitVoxelText,
  growVoxelCut,
  makeVoxelCut,
  pickDigCell,
  resizeVoxelCut,
  restoreVoxels,
  smoothVoxel,
  snapshotVoxels,
  stampVoxel,
  stampWorldBox,
  voxelCovers,
  voxelFields,
  voxelIsEmpty,
  voxelShiftFrom,
} from '../src/editor/carve_voxel_core';
import {
  cutBounds,
  cutSdfAt,
  cutsSdfAt,
  cutVerticalBounds,
  decodeVoxelRle,
  encodeVoxelRle,
  sanitizeTerrainCut,
  VOXEL_ROCK,
  voxelData,
} from '../src/sim/terrain_cuts';

const DOWN = { x: 0, y: -1, z: 0 };
const box = (x: number, y: number, z: number, r: number) => ({
  minX: x - r,
  minY: y - r,
  minZ: z - r,
  maxX: x + r,
  maxY: y + r,
  maxZ: z + r,
});

describe('the run-length codec', () => {
  it('round-trips an Int8 volume, and an empty text is all rock', () => {
    const data = new Int8Array([127, 127, -3, -3, -3, 0, 127]);
    const text = encodeVoxelRle(data);
    expect(text).toBe('2:127,3:-3,1:0,1:127');
    expect(Array.from(decodeVoxelRle(text, 7)!)).toEqual(Array.from(data));
    expect(Array.from(decodeVoxelRle('', 3)!)).toEqual([127, 127, 127]);
  });
  it('rejects a text that does not fill the grid exactly', () => {
    expect(decodeVoxelRle('2:1', 3)).toBeNull();
    expect(decodeVoxelRle('4:1', 3)).toBeNull();
    expect(decodeVoxelRle('x', 1)).toBeNull();
  });
});

describe('the dug rock volume (src/editor/carve_voxel_core.ts)', () => {
  it('a fresh grid is rock everywhere: no cut anywhere inside it', () => {
    const cut = makeVoxelCut(0.5, box(10, 5, -20, 6));
    expect(cut.shape).toBe('voxel');
    expect(cut.carve).toBe(true);
    expect(voxelIsEmpty(cut)).toBe(true);
    expect(cutSdfAt(cut, 10, 5, -20)).toBeGreaterThan(0);
    // Bounds follow the TOUCHED cells, not the padded grid: an untouched
    // grid has no footprint, and one stamp gives it exactly the stamp's.
    const empty = cutBounds(cut);
    expect(empty.maxX - empty.minX).toBe(0);
    stampVoxel(cut, 'dig', { x: 10, y: 5, z: -20 }, 2, { kind: 'round', noise: 0 }, DOWN);
    const b = cutBounds(cut);
    expect(b.minX).toBeLessThanOrEqual(8);
    expect(b.maxX).toBeGreaterThanOrEqual(12);
    expect(b.minX).toBeGreaterThan(0);
    expect(cutVerticalBounds(cut).minY).toBeLessThanOrEqual(3);
    expect(cutVerticalBounds(cut).minY).toBeGreaterThan(-6);
  });

  it('regrows only on the side a stamp passes, and undo crops back exactly', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 4));
    stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 2, { kind: 'round', noise: 0 }, DOWN);
    const before = voxelFields(cut);
    const dug = cutSdfAt(cut, 0, 0, 0);
    // Straight ahead in +x: x grows, y and z stay.
    expect(growVoxelCut(cut, stampWorldBox({ x: 14, y: 0, z: 0 }, 2, 0.5))).toBe(true);
    const after = voxelFields(cut);
    expect(after.ny).toBe(before.ny);
    expect(after.nz).toBe(before.nz);
    expect(after.vy0).toBe(before.vy0);
    expect(after.vx0).toBe(before.vx0);
    expect(after.nx).toBeGreaterThan(before.nx);
    expect(cutSdfAt(cut, 0, 0, 0)).toBeCloseTo(dug, 6);
    const sh = voxelShiftFrom(cut, before);
    expect(sh).toEqual({ x: 0, y: 0, z: 0 });
    stampVoxel(cut, 'dig', { x: 14, y: 0, z: 0 }, 2, { kind: 'round', noise: 0 }, DOWN);
    resizeVoxelCut(cut, before);
    expect(voxelFields(cut)).toEqual(before);
    expect(cutSdfAt(cut, 0, 0, 0)).toBeCloseTo(dug, 6);
    expect(cutSdfAt(cut, 14, 0, 0)).toBeGreaterThan(0);
  });

  it('a restore stamp puts the rock back, and a fully refilled grid reads empty', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 8));
    stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 3, { kind: 'round', noise: 0 }, DOWN);
    expect(voxelIsEmpty(cut)).toBe(false);
    expect(cutSdfAt(cut, 0, 0, 0)).toBeLessThan(0);
    // Half of it back: the far side stays dug.
    stampVoxel(cut, 'restore', { x: 2.5, y: 0, z: 0 }, 2.5, { kind: 'round', noise: 0 }, DOWN);
    expect(cutSdfAt(cut, 2.5, 0, 0)).toBeGreaterThan(0);
    expect(cutSdfAt(cut, -2, 0, 0)).toBeLessThan(0);
    // All of it back: solid rock again, the record can go.
    stampVoxel(cut, 'restore', { x: 0, y: 0, z: 0 }, 6, { kind: 'round', noise: 0 }, DOWN);
    commitVoxelText(cut);
    expect(cutSdfAt(cut, 0, 0, 0)).toBeGreaterThan(0);
    expect(cutSdfAt(cut, -2, 0, 0)).toBeGreaterThan(0);
    expect(voxelIsEmpty(cut)).toBe(true);
  });

  it('picks a coarser cell for a brush one stamp of which would swamp the budget', () => {
    expect(pickDigCell(0.5, 3)).toBe(0.5);
    expect(pickDigCell(0.25, 60)).toBeGreaterThan(0.25);
    expect(pickDigCell(2, 60)).toBe(2);
  });

  it('a dig stamp opens air at its centre and leaves rock past its radius', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 8));
    stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 3, { kind: 'round', noise: 0 }, DOWN);
    // The stored band saturates at VOXEL_RANGE cells (2 yd at this cell).
    expect(cutSdfAt(cut, 0, 0, 0)).toBeLessThanOrEqual(-1.9);
    expect(cutSdfAt(cut, 2.9, 0, 0)).toBeLessThan(0);
    expect(cutSdfAt(cut, 3.4, 0, 0)).toBeGreaterThan(0);
    expect(cutSdfAt(cut, 6, 0, 0)).toBeGreaterThan(1);
    expect(voxelIsEmpty(cut)).toBe(false);
    // The union field reads it like any other carve.
    expect(cutsSdfAt([cut], 0, 0, 0)).toBeLessThan(0);
  });

  it('a half-moon stamp bites deeper along its "into" direction', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 8));
    stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 3, { kind: 'halfmoon', noise: 0 }, DOWN);
    // Deeper below than to the side.
    expect(cutSdfAt(cut, 0, -3.2, 0)).toBeLessThan(0);
    expect(cutSdfAt(cut, 3.2, 0, 0)).toBeGreaterThan(0);
  });

  it('a fill stamp puts the rock back, and rock outside the stamp is untouched', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 8));
    stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 4, { kind: 'round', noise: 0 }, DOWN);
    const before = cutSdfAt(cut, 3.5, 0, 0);
    // A fill grid is its own record in the patch list: filling there means
    // the patch field is negative (solid) inside the stamp.
    const fill = makeVoxelCut(0.5, box(0, 0, 0, 8));
    stampVoxel(fill, 'fill', { x: 0, y: 0, z: 0 }, 2, { kind: 'round', noise: 0 }, DOWN);
    expect(cutSdfAt(fill, 0, 0, 0)).toBeLessThan(0); // solid patch inside
    expect(cutSdfAt(fill, 5, 0, 0)).toBeGreaterThan(0); // nothing outside
    expect(cutSdfAt(cut, 3.5, 0, 0)).toBe(before);
  });

  it('grows to cover a stamp past its edge without losing what was dug', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 4));
    stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 2, { kind: 'round', noise: 0 }, DOWN);
    const dug = cutSdfAt(cut, 0, 0, 0);
    const far = stampWorldBox({ x: 14, y: 0, z: 0 }, 2, 0.5);
    expect(voxelCovers(cut, far)).toBe(false);
    expect(growVoxelCut(cut, far)).toBe(true);
    expect(voxelCovers(cut, far)).toBe(true);
    expect(cutSdfAt(cut, 0, 0, 0)).toBeCloseTo(dug, 6);
    stampVoxel(cut, 'dig', { x: 14, y: 0, z: 0 }, 2, { kind: 'round', noise: 0 }, DOWN);
    expect(cutSdfAt(cut, 14, 0, 0)).toBeLessThan(0);
  });

  it('snapshot + restore undoes a stroke exactly', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 8));
    const b = stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 3, { kind: 'round', noise: 0 }, DOWN);
    const snap = snapshotVoxels(cut, b);
    const s2 = stampVoxel(
      cut,
      'dig',
      { x: 2, y: 0, z: 0 },
      3,
      { kind: 'ragged', noise: 0.5 },
      DOWN,
    );
    expect(s2.x1).toBeGreaterThan(b.x0);
    const after = voxelData(cut).slice();
    restoreVoxels(cut, b, snap);
    // Cells outside the snapshot box were never touched by the first stamp...
    // ...and inside it the first stamp's values are back.
    expect(cutSdfAt(cut, 0, 0, 0)).toBeLessThan(0);
    expect(voxelData(cut)).not.toEqual(after);
  });

  it('smoothing pulls a dug edge toward its neighbours', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 8));
    stampVoxel(cut, 'dig', { x: 0, y: 0, z: 0 }, 3, { kind: 'round', noise: 0 }, DOWN);
    const edgeBefore = cutSdfAt(cut, 3, 0, 0);
    smoothVoxel(cut, { x: 3, y: 0, z: 0 }, 3, 1);
    const edgeAfter = cutSdfAt(cut, 3, 0, 0);
    expect(edgeAfter).not.toBe(edgeBefore);
    expect(Math.abs(edgeAfter)).toBeLessThan(3);
  });

  it('survives the document sanitizer: dims, origin, cell and the volume text', () => {
    const cut = makeVoxelCut(0.5, box(0, 0, 0, 8));
    stampVoxel(cut, 'dig', { x: 1, y: 1, z: 1 }, 3, { kind: 'round', noise: 0 }, DOWN);
    commitVoxelText(cut);
    const json = JSON.parse(JSON.stringify(cut));
    const back = sanitizeTerrainCut(json);
    expect(back).not.toBeNull();
    expect(back?.shape).toBe('voxel');
    expect(back?.carve).toBe(true);
    expect(cutSdfAt(back!, 1, 1, 1)).toBeCloseTo(cutSdfAt(cut, 1, 1, 1), 6);
    expect(cutSdfAt(back!, 7, 7, 7)).toBeGreaterThan(0);
    expect(voxelData(back!)[0]).toBe(VOXEL_ROCK);
  });

  it('refuses a voxel record without a valid grid', () => {
    expect(sanitizeTerrainCut({ x: 0, y: 0, z: 0, radius: 1, shape: 'voxel' })).toBeNull();
    expect(
      sanitizeTerrainCut({
        x: 0,
        y: 0,
        z: 0,
        radius: 1,
        shape: 'voxel',
        cell: 0.5,
        nx: 9999,
        ny: 9999,
        nz: 9999,
        vx0: 0,
        vy0: 0,
        vz0: 0,
        vox: '',
      }),
    ).toBeNull();
  });
});
