// The spirit veil's program family and its per-rig transparent sort
// (src/render/characters/spirit_veil_family_core.ts): the tuple a veil draw
// keys as, per axis three reads off the object, and the draw order that keeps
// each ghost rig one block among the world's transparents.

import { describe, expect, it } from 'vitest';
import {
  createSpiritVeilSortUnit,
  createSpiritVeilTransparentSort,
  SPIRIT_VEIL_FAMILY,
  SPIRIT_VEIL_FAMILY_KEYS,
  SPIRIT_VEIL_PASS_KEY,
  SPIRIT_VEIL_UNIT_KEY,
  type SpiritVeilPass,
  type SpiritVeilShapeObject,
  type SpiritVeilSortItem,
  type SpiritVeilSortUnit,
  spiritVeilKeyOfTuple,
  spiritVeilKeysLinked,
  spiritVeilShapeOf,
  spiritVeilTupleKey,
  spiritVeilTupleOfKey,
} from '../src/render/characters/spirit_veil_family_core';

const morphs = (n: number): unknown[] => Array.from({ length: n }, () => ({}));

function mesh(over: Partial<SpiritVeilShapeObject> = {}, morphCount = 0): SpiritVeilShapeObject {
  return {
    isSkinnedMesh: true,
    geometry: {
      attributes: { position: {}, normal: {} },
      morphAttributes: morphCount > 0 ? { position: morphs(morphCount) } : {},
    },
    ...over,
  };
}

describe('spiritVeilTupleKey', () => {
  it('spells the canonical tuple: pass, skinning, map (colour arms only), morph count', () => {
    const shape = spiritVeilShapeOf(mesh({}, 14));
    expect(spiritVeilTupleKey('color', shape, true)).toBe('color:s+map:14');
    expect(spiritVeilTupleKey('color', shape, false)).toBe('color:s:14');
    expect(spiritVeilTupleKey('decal', shape, true)).toBe('decal:s+map:14');
    // The depth pre-pass carries no map, so the map axis collapses there.
    expect(spiritVeilTupleKey('depth', shape, true)).toBe('depth:s:14');
    expect(spiritVeilTupleKey('depth', shape, false)).toBe('depth:s:14');
    const rigid = spiritVeilShapeOf(mesh({ isSkinnedMesh: false }));
    expect(spiritVeilTupleKey('color', rigid, true)).toBe('color:r+map:0');
  });

  it('keys every other fact three reads as its own flag (one negative per axis)', () => {
    const base = spiritVeilShapeOf(mesh({}, 4));
    const canonical = spiritVeilTupleKey('color', base, false);
    const variants: [string, SpiritVeilShapeObject][] = [
      ['nonormal', { isSkinnedMesh: true, geometry: { attributes: { position: {} } } }],
      ['noposition', { isSkinnedMesh: true, geometry: { attributes: { normal: {} } } }],
      [
        'morphnormal',
        {
          isSkinnedMesh: true,
          geometry: {
            attributes: { position: {}, normal: {} },
            morphAttributes: { position: morphs(4), normal: morphs(4) },
          },
        },
      ],
      [
        'morphcolor',
        {
          isSkinnedMesh: true,
          geometry: {
            attributes: { position: {}, normal: {} },
            morphAttributes: { position: morphs(4), color: morphs(4) },
          },
        },
      ],
      ['instanced', mesh({ isInstancedMesh: true }, 4)],
      ['batched', mesh({ isBatchedMesh: true }, 4)],
    ];
    for (const [flag, object] of variants) {
      const key = spiritVeilTupleKey('color', spiritVeilShapeOf(object), false);
      expect(key, flag).not.toBe(canonical);
      expect(key, flag).toContain(`!${flag}`);
      expect(SPIRIT_VEIL_FAMILY_KEYS.has(key), flag).toBe(false);
      expect(spiritVeilTupleOfKey(key), flag).toBeNull();
    }
  });

  it('keys a map on another uv channel and an empty morph list as their own programs', () => {
    const shape = spiritVeilShapeOf(mesh({}, 0));
    expect(spiritVeilTupleKey('color', shape, true, 1)).toBe('color:s+map:0!uv1');
    // the depth pass carries no map, so its channel never matters
    expect(spiritVeilTupleKey('depth', shape, true, 1)).toBe('depth:s:0');
    const empty = spiritVeilShapeOf({
      isSkinnedMesh: true,
      geometry: { attributes: { position: {}, normal: {} }, morphAttributes: { position: [] } },
    });
    expect(spiritVeilTupleKey('color', empty, false)).toBe('color:s:0!morphempty');
    expect(SPIRIT_VEIL_FAMILY_KEYS.has(spiritVeilTupleKey('color', empty, false))).toBe(false);
  });

  it('reads the morph count the way three does: position, then normal, then colour', () => {
    const normalOnly = spiritVeilShapeOf({
      geometry: {
        attributes: { position: {}, normal: {} },
        morphAttributes: { normal: morphs(3) },
      },
    });
    expect(normalOnly.morphTargets).toBe(3);
    expect(normalOnly.morphNormals).toBe(true);
    expect(spiritVeilShapeOf(mesh({}, 0)).morphTargets).toBe(0);
  });
});

describe('the pinned family', () => {
  it('is 14 colour programs (one of them the decal variant) and 10 depth programs', () => {
    const count = (pass: SpiritVeilPass) =>
      SPIRIT_VEIL_FAMILY.filter((t) => t.pass === pass).length;
    expect(count('color')).toBe(13);
    expect(count('decal')).toBe(1);
    expect(count('depth')).toBe(10);
    expect(SPIRIT_VEIL_FAMILY_KEYS.size).toBe(SPIRIT_VEIL_FAMILY.length);
  });

  it('round-trips every tuple through its key', () => {
    for (const tuple of SPIRIT_VEIL_FAMILY) {
      const key = spiritVeilKeyOfTuple(tuple);
      expect(spiritVeilTupleOfKey(key)).toEqual(tuple);
    }
    expect(spiritVeilTupleOfKey('depth:s+map:4')).toBeNull();
    expect(spiritVeilTupleOfKey('shadow:s:4')).toBeNull();
  });

  it('commits a veil only when every tuple it needs is linked', () => {
    const linked = new Set(['color:s:4', 'depth:s:4']);
    expect(spiritVeilKeysLinked(['color:s:4', 'depth:s:4'], linked)).toBe(true);
    expect(spiritVeilKeysLinked(['color:s:4', 'depth:s:6'], linked)).toBe(false);
    expect(spiritVeilKeysLinked(['color:s:6'], linked)).toBe(false);
  });
});

// three 0.185.1 WebGLRenderLists reversePainterSortStable, the default the
// sort must reproduce for every item outside a veil unit.
function reversePainter(a: SpiritVeilSortItem, b: SpiritVeilSortItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  return a.id - b.id;
}

let nextId = 1;
function item(
  z: number,
  renderOrder = 0,
  unit?: SpiritVeilSortUnit,
  pass?: SpiritVeilPass,
  name = '',
): SpiritVeilSortItem & { name: string } {
  const userData: Record<string, unknown> = {};
  if (unit) {
    userData[SPIRIT_VEIL_UNIT_KEY] = unit;
    userData[SPIRIT_VEIL_PASS_KEY] = pass;
  }
  return { id: nextId++, groupOrder: 0, renderOrder, z, object: { userData }, name };
}

describe('createSpiritVeilTransparentSort', () => {
  it('is three default order for everything outside a veil unit', () => {
    const sort = createSpiritVeilTransparentSort(() => 1);
    const items = [item(5), item(2, 3), item(9), item(2), item(7, 1), item(5)];
    items[3].groupOrder = -1;
    expect([...items].sort(sort)).toEqual([...items].sort(reversePainter));
  });

  it('draws a rig as one block: every depth draw, then the body, then the decals', () => {
    const sort = createSpiritVeilTransparentSort(() => 1);
    const rig = createSpiritVeilSortUnit();
    const list = [
      item(4.2, 0, rig, 'color', 'body'),
      item(4.0, 0, rig, 'decal', 'stubble'),
      item(4.4, 0, rig, 'depth', 'body-depth'),
      item(3.9, 0, rig, 'color', 'hair'),
      item(4.1, 0, rig, 'depth', 'hair-depth'),
    ].sort(sort);
    const passes = list.map((entry) => entry.object.userData[SPIRIT_VEIL_PASS_KEY]);
    expect(passes).toEqual(['depth', 'depth', 'color', 'color', 'decal']);
  });

  it('sorts the whole rig at one depth among the world: a nearer faded wall and water draw after it', () => {
    const sort = createSpiritVeilTransparentSort(() => 1);
    const rig = createSpiritVeilSortUnit();
    const farSmoke = item(20, 0, undefined, undefined, 'far-smoke');
    const wall = item(2, 0, undefined, undefined, 'faded-wall');
    const water = item(4.5, 0, undefined, undefined, 'water');
    const ring = item(1, 5, undefined, undefined, 'selection-ring');
    const list = [
      wall,
      item(5.0, 0, rig, 'color', 'body'),
      ring,
      water,
      item(5.3, 0, rig, 'depth', 'body-depth'),
      farSmoke,
      item(4.8, 0, rig, 'decal', 'stubble'),
    ].sort(sort);
    expect(list.map((entry) => entry.name)).toEqual([
      'far-smoke',
      'body-depth',
      'body',
      'stubble',
      'water',
      'faded-wall',
      'selection-ring',
    ]);
  });

  it('keeps two rigs apart, the far one first, so a far ghost shows through a near one', () => {
    const sort = createSpiritVeilTransparentSort(() => 1);
    const near = createSpiritVeilSortUnit();
    const far = createSpiritVeilSortUnit();
    const list = [
      item(3, 0, near, 'color', 'near-body'),
      item(9, 0, far, 'color', 'far-body'),
      item(3.1, 0, near, 'depth', 'near-depth'),
      item(8.8, 0, far, 'depth', 'far-depth'),
    ].sort(sort);
    expect(list.map((entry) => entry.name)).toEqual([
      'far-depth',
      'far-body',
      'near-depth',
      'near-body',
    ]);
  });

  it('holds a unit to one depth per render and re-reads it on the next', () => {
    let frame = 1;
    const sort = createSpiritVeilTransparentSort(() => frame);
    const rig = createSpiritVeilSortUnit();
    const body = item(5, 0, rig, 'color');
    const other = item(6, 0, rig, 'depth');
    sort(body, item(1));
    expect(rig.z).toBe(5);
    sort(other, item(1));
    expect(rig.z).toBe(5);
    frame = 2;
    sort(other, item(1));
    expect(rig.z).toBe(6);
  });

  it("keeps three's order among the world's transparents when veil units are mixed in", () => {
    // Every band three sorts on, with units of several rigs interleaved and
    // ties on z and on renderOrder between the world items and the units.
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const rigs = [
      createSpiritVeilSortUnit(),
      createSpiritVeilSortUnit(),
      createSpiritVeilSortUnit(),
    ];
    const passes: SpiritVeilPass[] = ['depth', 'color', 'decal'];
    for (let round = 0; round < 40; round++) {
      const sort = createSpiritVeilTransparentSort(() => round);
      const world: SpiritVeilSortItem[] = [];
      const all: SpiritVeilSortItem[] = [];
      for (let i = 0; i < 24; i++) {
        const entry = item(next(6), next(5) - 2);
        entry.groupOrder = next(3) === 0 ? next(3) - 1 : 0;
        world.push(entry);
        all.push(entry);
      }
      for (let i = 0; i < 18; i++) {
        const entry = item(next(6) + next(2) * 0.5, next(5) - 2, rigs[next(3)], passes[next(3)]);
        entry.groupOrder = next(3) === 0 ? next(3) - 1 : 0;
        all.push(entry);
      }
      for (let i = all.length - 1; i > 0; i--) {
        const j = next(i + 1);
        [all[i], all[j]] = [all[j], all[i]];
      }
      const sorted = [...all].sort(sort).filter((entry) => world.includes(entry));
      expect(sorted).toEqual([...world].sort(reversePainter));
    }
  });

  it('puts the unit in the default band whatever renderOrder its meshes carry', () => {
    const sort = createSpiritVeilTransparentSort(() => 1);
    const rig = createSpiritVeilSortUnit();
    const body = item(5, 7, rig, 'color', 'body');
    const vfx = item(9, 3, undefined, undefined, 'vfx');
    expect([vfx, body].sort(sort).map((entry) => entry.name)).toEqual(['body', 'vfx']);
  });
});
