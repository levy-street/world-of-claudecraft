import { describe, expect, it } from 'vitest';
import {
  adjacentCrafts,
  CRAFT_RING,
  craftById,
  oppositeCraft,
} from '../src/sim/content/professions';

describe('professions craft ring', () => {
  it('defines exactly the ten production crafts', () => {
    expect(CRAFT_RING).toHaveLength(10);
    const ids = CRAFT_RING.map((c) => c.id);
    expect(new Set(ids).size).toBe(10);
    expect(ids).toEqual([
      'armorcrafting',
      'weaponcrafting',
      'jewelcrafting',
      'alchemy',
      'engineering',
      'cooking',
      'inscription',
      'enchanting',
      'tailoring',
      'leatherworking',
    ]);
  });

  it('every craft has a pole tag from the four poles', () => {
    const poles = new Set(['Material', 'Experimental', 'Formal', 'Cross-cutting']);
    for (const craft of CRAFT_RING) {
      expect(poles.has(craft.pole)).toBe(true);
    }
  });

  it('adjacent crafts match the ring geometry: index (i-1+10)%10 and (i+1)%10', () => {
    for (let i = 0; i < CRAFT_RING.length; i++) {
      const craft = CRAFT_RING[i];
      const [prev, next] = adjacentCrafts(craft.id);
      const expectedPrev = CRAFT_RING[(i - 1 + 10) % 10];
      const expectedNext = CRAFT_RING[(i + 1) % 10];
      expect(prev.id).toBe(expectedPrev.id);
      expect(next.id).toBe(expectedNext.id);
    }
  });

  it('opposite craft matches the ring geometry: index (i+5)%10', () => {
    for (let i = 0; i < CRAFT_RING.length; i++) {
      const craft = CRAFT_RING[i];
      const opposite = oppositeCraft(craft.id);
      const expected = CRAFT_RING[(i + 5) % 10];
      expect(opposite.id).toBe(expected.id);
    }
  });

  it('opposite is symmetric: opposite(opposite(x)) === x', () => {
    for (const craft of CRAFT_RING) {
      const opp = oppositeCraft(craft.id);
      const back = oppositeCraft(opp.id);
      expect(back.id).toBe(craft.id);
    }
  });

  it('adjacency is symmetric: x is adjacent to y iff y is adjacent to x', () => {
    for (const craft of CRAFT_RING) {
      const [prev, next] = adjacentCrafts(craft.id);
      for (const neighbor of [prev, next]) {
        const [nPrev, nNext] = adjacentCrafts(neighbor.id);
        expect([nPrev.id, nNext.id]).toContain(craft.id);
      }
    }
  });

  it('craftById resolves a known craft and throws on an unknown id', () => {
    expect(craftById('alchemy').name).toBe('Alchemy');
    expect(() => craftById('nonexistent')).toThrow();
  });
});
