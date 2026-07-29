import { describe, expect, it } from 'vitest';
import { resolveDirectPickEntityId } from '../src/render/pick_resolution';

type TestPickEntity = {
  id: number;
  kind: 'mob' | 'object' | 'player' | 'npc';
  dead: boolean;
  lootable: boolean;
};

function entities(
  list: Array<{
    id: number;
    kind: TestPickEntity['kind'];
    dead?: boolean;
    lootable?: boolean;
  }>,
): Map<number, TestPickEntity> {
  return new Map(
    list.map((e) => [
      e.id,
      {
        dead: false,
        lootable: false,
        ...e,
      },
    ]),
  );
}

describe('resolveDirectPickEntityId', () => {
  it('keeps a normal single lootable corpse pick unchanged', () => {
    const map = entities([{ id: 10, kind: 'mob', dead: true, lootable: true }]);
    expect(resolveDirectPickEntityId([10], map, 10)).toBe(10);
  });

  it('skips an already-unlootable corpse to reach a stacked lootable corpse', () => {
    const map = entities([
      { id: 10, kind: 'mob', dead: true, lootable: false },
      { id: 11, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([10, 11], map)).toBe(11);
  });

  it('cycles to the next lootable corpse in a stacked direct-hit set', () => {
    const map = entities([
      { id: 10, kind: 'mob', dead: true, lootable: true },
      { id: 11, kind: 'mob', dead: true, lootable: true },
      { id: 12, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([10, 11, 12], map, 10)).toBe(11);
    expect(resolveDirectPickEntityId([10, 11, 12], map, 11)).toBe(12);
    expect(resolveDirectPickEntityId([10, 11, 12], map, 12)).toBe(10);
  });

  it('dedupes repeated child hits before cycling stacked corpses', () => {
    const map = entities([
      { id: 10, kind: 'mob', dead: true, lootable: true },
      { id: 11, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([10, 10, 11], map, 10)).toBe(11);
  });

  it('does not bypass a non-corpse first hit while cycling corpses', () => {
    const map = entities([
      { id: 9, kind: 'mob', dead: false },
      { id: 10, kind: 'mob', dead: true, lootable: true },
      { id: 11, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([9, 10, 11], map, 10)).toBe(9);
  });

  it('preserves unlootable object blocking behavior', () => {
    const map = entities([
      { id: 20, kind: 'object', lootable: false },
      { id: 10, kind: 'mob', dead: true, lootable: true },
    ]);
    expect(resolveDirectPickEntityId([20, 10], map)).toBeNull();
  });

  it('keeps a dead player directly pickable for combat resurrection targeting', () => {
    const map = entities([{ id: 30, kind: 'player', dead: true, lootable: false }]);
    expect(resolveDirectPickEntityId([30], map)).toBe(30);
  });

  describe('issue #2787: live mob wins over an overlapping corpse', () => {
    it('prefers a live mob behind the frontmost corpse instead of opening loot', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true }, // ray hits this first
        { id: 11, kind: 'mob', dead: false }, // the last living mob, farther along the ray
      ]);
      expect(resolveDirectPickEntityId([10, 11], map)).toBe(11);
    });

    it('prefers a live PLAYER over a leading corpse too', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 12, kind: 'player', dead: false },
      ]);
      expect(resolveDirectPickEntityId([10, 12], map)).toBe(12);
    });

    it('picks the NEAREST live mob when several are behind the leading corpse', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 11, kind: 'mob', dead: false },
        { id: 13, kind: 'mob', dead: false },
      ]);
      expect(resolveDirectPickEntityId([10, 11, 13], map)).toBe(11);
    });

    it('still cycles among corpses when no live entity is in the hit set', () => {
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 11, kind: 'mob', dead: true, lootable: true },
      ]);
      expect(resolveDirectPickEntityId([10, 11], map, 10)).toBe(11); // unchanged
    });

    it('ignores a live-but-unselectable object hit behind the corpse', () => {
      // A lootable ground object is never target-selectable (kind 'object'), so
      // it must not steal the pick away from the ordinary corpse-loot branch.
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 14, kind: 'object', lootable: true },
      ]);
      expect(resolveDirectPickEntityId([10, 14], map)).toBe(10); // unchanged
    });

    it('still opens loot when the corpse is genuinely alone (lone-corpse looting preserved)', () => {
      const map = entities([{ id: 10, kind: 'mob', dead: true, lootable: true }]);
      expect(resolveDirectPickEntityId([10], map)).toBe(10);
    });

    it('ignores a live NPC behind the corpse: loot the corpse, not the NPC (OSSBrain review)', () => {
      // A non-hostile NPC is never a valid direct-pick target (npc dialog is
      // opened through interact/proximity, not click-pick priority), so it
      // must not steal the pick away from the ordinary corpse-loot branch,
      // same as the 'object' case above.
      const map = entities([
        { id: 10, kind: 'mob', dead: true, lootable: true },
        { id: 15, kind: 'npc', dead: false },
      ]);
      expect(resolveDirectPickEntityId([10, 15], map)).toBe(10); // unchanged
    });
  });
});
