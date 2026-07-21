import { describe, expect, it } from 'vitest';
import {
  adjacentCrafts,
  CRAFT_RING,
  craftById,
  oppositeCraft,
} from '../src/sim/content/professions';
import { COMBO_RECIPES } from '../src/sim/content/recipes';
import { ARCHETYPE_PAIR_TARGETS, archetypePairId } from '../src/sim/professions/archetype';

describe('professions craft ring', () => {
  it('defines exactly the ten production crafts in the design-doc ring order', () => {
    expect(CRAFT_RING).toHaveLength(10);
    const ids = CRAFT_RING.map((c) => c.id);
    expect(new Set(ids).size).toBe(10);
    // The canonical order from the professions design doc (#1148), adopted by
    // the Professions 2.0 ring reorder. Pinned as literals deliberately: a
    // reorder changes every adjacency, opposite, hobby default, and persisted
    // pair id, so it must redden here and be re-pinned consciously.
    expect(ids).toEqual([
      'engineering',
      'alchemy',
      'cooking',
      'leatherworking',
      'tailoring',
      'inscription',
      'enchanting',
      'jewelcrafting',
      'weaponcrafting',
      'armorcrafting',
    ]);
  });

  it('pins the ten canonical adjacent-pair ids in ring order', () => {
    // Persisted surface: these exact strings are stored in saves
    // (ArchetypeState.attunedPairs) and sent on the wire, so any change here
    // is a save-format change and must be deliberate.
    expect([...ARCHETYPE_PAIR_TARGETS]).toEqual([
      'engineering+alchemy',
      'alchemy+cooking',
      'cooking+leatherworking',
      'leatherworking+tailoring',
      'tailoring+inscription',
      'inscription+enchanting',
      'enchanting+jewelcrafting',
      'jewelcrafting+weaponcrafting',
      'weaponcrafting+armorcrafting',
      'armorcrafting+engineering',
    ]);
  });

  it('every content combo recipe pair stays ring-adjacent and canonically attunable', () => {
    // A future ring reorder that breaks the adjacency of a COMBO_RECIPES pair
    // would strand that recipe behind the common ceiling with no attunable
    // pair able to craft it. Iterate the REAL content entries so new combo
    // recipes are covered automatically.
    const withCombo = COMBO_RECIPES.filter((recipe) => recipe.comboRequirement);
    expect(withCombo.length).toBeGreaterThan(0);
    for (const recipe of withCombo) {
      const { craftA, craftB } = recipe.comboRequirement!;
      expect(
        adjacentCrafts(craftA).map((c) => c.id),
        `${recipe.id}: ${craftA} and ${craftB} must be ring-adjacent`,
      ).toContain(craftB);
      const pairId = archetypePairId(craftA, craftB);
      expect(pairId, `${recipe.id}: ${craftA}+${craftB} must form a canonical pair`).not.toBeNull();
      expect(ARCHETYPE_PAIR_TARGETS).toContain(pairId as string);
    }
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
