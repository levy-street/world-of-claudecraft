import { describe, expect, it } from 'vitest';
import type { AssetPlacement } from '../src/editor/custom_map';
import {
  cloneAssetPlacement,
  copyCampSelection,
  copyNpcSelection,
  copyPlacementSelection,
  marqueePlacementSelection,
  pasteCampSelection,
  pasteNpcSelection,
  pastePlacementSelection,
  toggledKeySelection,
} from '../src/editor/selection_clipboard';
import type { CampDef, NpcDef } from '../src/sim/types';

const placement = (assetId: string, x: number, z: number): AssetPlacement => ({
  assetId,
  x,
  z,
  rotY: 0.5,
  scale: 2,
  collide: true,
  collisionMode: 'baked',
  hitboxes: [{ x: 1, y: 0, z: 0, hx: 2, hy: 3, hz: 4, ry: 0 }],
  ramps: [{ x: 0, z: 1, hx: 2, hz: 3, y0: 0, y1: 2 }],
});

const npc = (id: string, x: number, z: number): NpcDef => ({
  id,
  name: id,
  title: 'Trader',
  pos: { x, z },
  facing: 1,
  color: 0xffffff,
  questIds: ['quest-a'],
  vendorItems: ['item-a'],
  greeting: 'Hello',
});

describe('selection clipboard', () => {
  it('copies and pastes a placement group with independent nested metadata', () => {
    const source = [placement('tree', 1, 2), placement('house', 8, 9)];
    const copied = copyPlacementSelection(source, new Set([1, 0]));
    const pasted = pastePlacementSelection(copied, 2, 3);

    expect(pasted.map(({ assetId, x, z }) => ({ assetId, x, z }))).toEqual([
      { assetId: 'tree', x: 3, z: 5 },
      { assetId: 'house', x: 10, z: 12 },
    ]);
    const pastedHitbox = pasted[0].hitboxes?.[0];
    if (pastedHitbox) pastedHitbox.x = 99;
    const pastedRamp = pasted[0].ramps?.[0];
    if (pastedRamp) pastedRamp.y1 = 99;
    expect(source[0].hitboxes?.[0].x).toBe(1);
    expect(source[0].ramps?.[0].y1).toBe(2);
    expect(pasted.every((copy) => copy.collide && copy.collisionMode === 'baked')).toBe(true);
  });

  it('clones collision fields without aliasing the source asset', () => {
    const source = placement('foliage/mushroom_woc', 4, 5);
    source.collideRadius = 3.5;
    const clone = cloneAssetPlacement(source);

    expect(clone).toMatchObject({
      assetId: 'foliage/mushroom_woc',
      collide: true,
      collisionMode: 'baked',
      collideRadius: 3.5,
    });
    expect(clone.hitboxes).not.toBe(source.hitboxes);
    expect(clone.ramps).not.toBe(source.ramps);
  });

  it('copies selected one-mob camps and preserves their relative layout', () => {
    const camps: CampDef[] = [
      { mobId: 'boar', center: { x: 2, z: 3 }, radius: 0.5, count: 1 },
      { mobId: 'wolf', center: { x: 7, z: 9 }, radius: 0.5, count: 1 },
    ];
    const copied = copyCampSelection(camps);
    expect(pasteCampSelection(copied, 4, -2)).toEqual([
      { mobId: 'boar', center: { x: 6, z: 1 }, radius: 0.5, count: 1 },
      { mobId: 'wolf', center: { x: 11, z: 7 }, radius: 0.5, count: 1 },
    ]);
  });

  it('pastes NPC groups with unique authored ids', () => {
    const existing = { keeper: npc('keeper', 0, 0), keeper_copy: npc('keeper_copy', 4, 4) };
    const copied = copyNpcSelection(existing, new Set(['npc:keeper', 'npc:keeper_copy']));
    const pasted = pasteNpcSelection(existing, copied, 2, 2);

    expect(pasted.map((entry) => entry.key)).toEqual(['keeper_copy_2', 'keeper_copy_copy']);
    expect(pasted.map((entry) => entry.npc.pos)).toEqual([
      { x: 2, z: 2 },
      { x: 6, z: 6 },
    ]);
    pasted[0].npc.questIds.push('quest-b');
    expect(existing.keeper.questIds).toEqual(['quest-a']);
  });

  it('uses plain click for one NPC and Ctrl-click to toggle a group', () => {
    expect(toggledKeySelection(new Set(['npc:a']), 'npc:b', false)).toEqual(new Set(['npc:b']));
    expect(toggledKeySelection(new Set(['npc:a']), 'npc:b', true)).toEqual(
      new Set(['npc:a', 'npc:b']),
    );
    expect(toggledKeySelection(new Set(['npc:a', 'npc:b']), 'npc:a', true)).toEqual(
      new Set(['npc:b']),
    );
  });

  it('replaces a placement pool for Ctrl-drag and accumulates it for Ctrl+Shift-drag', () => {
    const current = new Set([2, 5]);

    expect(marqueePlacementSelection(current, [7, 8], false)).toEqual(new Set([7, 8]));
    expect(marqueePlacementSelection(current, [5, 7, 8], true)).toEqual(new Set([2, 5, 7, 8]));
    expect(marqueePlacementSelection(current, [], true)).toEqual(current);
    expect(current).toEqual(new Set([2, 5]));
  });
});
