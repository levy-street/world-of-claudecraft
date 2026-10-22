import { afterEach, describe, expect, it } from 'vitest';
import {
  ambientDecorationKey,
  ambientDecorationsToPlacements,
} from '../src/editor/foliage_edit_core';
import { compileLayoutAdditions } from '../src/editor/world_layout_additions';
import { compileLayoutDecorations } from '../src/editor/world_layout_decorations';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { MapDoc } from '../src/sim/map_doc';
import { decorationKey, generateDecorationsInBounds } from '../src/sim/world';
import { placeLayoutScenery } from '../src/sim/world_layout/scenery';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => setActiveWorldContent(null));

describe('individual generated scenery replacement', () => {
  it('removes only the bound original, adds its moved model and keeps neighbouring generated scenery', () => {
    const bounds = { minX: -180, maxX: 180, minZ: -180, maxZ: 180 };
    const generated = generateDecorationsInBounds(WORLD_SEED, bounds);
    expect(generated.length).toBeGreaterThan(2);
    const key = ambientDecorationKey(generated[0]);
    const source = {
      ...ambientDecorationsToPlacements([generated[0]])[0],
      uid: `decoration:${key}`,
    };
    const placement = { ...source, uid: 'moved', x: source.x + 7 };
    const doc = { placements: [placement] } as MapDoc;
    const edit = {
      uid: 'moved',
      source,
      key,
      reason: 'Retain the authored move from source lineage.',
    };
    const issues: string[] = [];
    const used = new Set<string>();
    const reserved = new Set<number>();
    const result = compileLayoutDecorations(doc, [edit], [source], used, reserved, (id) =>
      issues.push(id),
    );
    expect(issues).toEqual([]);
    expect(result.additions[0].x).toBe(source.x + 7);
    expect(used).toEqual(new Set(['moved']));
    expect(reserved).toEqual(new Set([0]));
    const world = placeLayoutScenery(BUILTIN_WORLD, result);
    expect(world.decorationsMode).toBeUndefined();
    setActiveWorldContent(world);
    const after = generateDecorationsInBounds(WORLD_SEED, bounds);
    expect(after.some((p) => decorationKey(p) === key)).toBe(false);
    expect(after.some((p) => decorationKey(p) === decorationKey(generated[1]))).toBe(true);
    expect(after).toHaveLength(generated.length - 1);
    for (const invalid of [
      { ...edit, key: 'wrong' },
      { ...edit, source: { ...source, scale: 99 } },
    ]) {
      const errors: string[] = [];
      expect(
        compileLayoutDecorations(doc, [invalid], [source], new Set(), new Set(), (id) =>
          errors.push(id),
        ).additions,
      ).toEqual([]);
      expect(errors).toEqual(['decoration:moved']);
    }
  });

  it('does not drop missing assets, unsafe transforms or objective semantics when adding scenery', () => {
    for (const fields of [
      { assetId: 'missing/model' },
      { scale: Number.NaN },
      { regionRole: 'flag0' },
    ]) {
      const placement = {
        uid: 'new',
        assetId: 'props/rock_large_d',
        x: 10,
        z: 20,
        scale: 2,
        rotY: 0,
        collide: true,
        ...fields,
      };
      const errors: string[] = [];
      const additions = compileLayoutAdditions(
        { placements: [placement] } as MapDoc,
        { new: 'Retain authored addition.' },
        new Set(),
        (id) => errors.push(id),
      );
      expect(additions).toEqual([]);
      expect(errors).toEqual(['addition:new']);
    }
  });
});
