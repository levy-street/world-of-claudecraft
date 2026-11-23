// Combine: explode a building, join it back, and require the placement that
// comes out to be the one that went in (SPACEY, 2026-09-09: "make it so you can
// join ur split asset back"). Everything else groups instead.
import { describe, expect, it } from 'vitest';
import { PREFAB_PIECES, prefabPiecesFor } from '../src/editor/prefab_pieces.generated';
import { explodePrefab, type PrefabPiecesDef } from '../src/editor/prefab_pieces_core';
import {
  groupMembers,
  newGroupId,
  prefabOfSelection,
  rejoinPrefab,
} from '../src/editor/prefab_rejoin_core';

const DEFS = (
  Array.isArray(PREFAB_PIECES) ? PREFAB_PIECES : Object.values(PREFAB_PIECES)
) as PrefabPiecesDef[];
const GROUND = 20;

describe('joining a split building back together', () => {
  for (const def of DEFS) {
    if (!def.shell) continue;
    it(`${def.assetId}: explode then combine is the same placement`, () => {
      const building: any = {
        assetId: def.assetId,
        x: -74.3,
        z: 393.9,
        rotY: 0.62,
        scale: 12.29,
        collide: true,
        collisionMode: 'baked',
      };
      const pieces = explodePrefab(building, def, { groundAt: () => GROUND });
      const found = prefabOfSelection(pieces, prefabPiecesFor);
      expect(found?.assetId, 'the selection is recognised as one building').toBe(def.assetId);
      const back = rejoinPrefab(pieces, def)!;
      expect(back).toBeTruthy();
      expect(back.assetId).toBe(def.assetId);
      expect(back.x).toBeCloseTo(building.x, 9);
      expect(back.z).toBeCloseTo(building.z, 9);
      expect(back.rotY).toBeCloseTo(building.rotY, 9);
      expect(back.scale).toBeCloseTo(building.scale, 6);
      expect(back.collisionMode).toBe('baked');
      expect(back.hitboxes).toBeUndefined();
      // The model origin lands back where it was: a detached seat reproduces
      // the height the building's own base sat at.
      const kb = (building.scale * 2.2) / def.maxDim;
      expect(back.groundY!).toBeCloseTo(GROUND - def.minY * kb + def.minY * kb, 6);
      expect(back.groundY!).toBeCloseTo(GROUND, 6);
    });
  }

  it('refuses a selection that is not one building', () => {
    const def = DEFS.find((d) => d.shell)!;
    const pieces = explodePrefab(
      { assetId: def.assetId, x: 0, z: 0, rotY: 0, scale: 10 } as never,
      def,
      { groundAt: () => GROUND },
    );
    expect(prefabOfSelection([pieces[0], { assetId: 'props/barrel' }], prefabPiecesFor)).toBeNull();
    expect(
      prefabOfSelection([{ assetId: 'props/barrel' }, { assetId: 'props/well' }], prefabPiecesFor),
    ).toBeNull();
    expect(prefabOfSelection([pieces[0]], prefabPiecesFor), 'one piece is not a set').toBeNull();
    const other = DEFS.find((d) => d.shell && d.assetId !== def.assetId)!;
    const mixed = explodePrefab(
      { assetId: other.assetId, x: 0, z: 0, rotY: 0, scale: 10 } as never,
      other,
      {
        groundAt: () => GROUND,
      },
    );
    expect(prefabOfSelection([pieces[0], mixed[0]], prefabPiecesFor), 'two buildings').toBeNull();
  });

  it('groups everything else, and a group picks as one', () => {
    const id = newGroupId(() => 0.5);
    expect(id).toMatch(/^g[0-9a-z]+$/);
    const list = [{ groupId: id }, { groupId: undefined }, { groupId: id }, { groupId: 'other' }];
    expect(groupMembers(list, 0)).toEqual([0, 2]);
    expect(groupMembers(list, 2)).toEqual([0, 2]);
    expect(groupMembers(list, 1), 'ungrouped stays alone').toEqual([1]);
    expect(groupMembers(list, 3)).toEqual([3]);
  });
});
