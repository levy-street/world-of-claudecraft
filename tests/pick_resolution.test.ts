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
});
