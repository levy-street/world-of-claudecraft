import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  rowTreeFor,
  type TalentAllocation,
} from '../src/sim/content/talents';

const EXPECTED_ROWS = [
  ['Sheltering Step', 'Veil Unbound', 'Processional Grace'],
  ['Last Prayer', 'Shattered Psalm', 'Wounded Halo'],
  ['Hushword', 'Lingering Dread', 'Binding Psalm'],
  ['Stilled Mind', 'Measured Faith', 'Living Covenant'],
  ['Anointing', "Martyr's Aegis", 'Choir of Deliverance'],
  ['Twin Covenant', 'Second Verse', 'Incarnate Spirit'],
] as const;

function allocation(row: 5 | 8 | 11 | 14 | 17 | 20, optionId: string): TalentAllocation {
  return { ...emptyAllocation(), spec: 'discipline', rows: { [row]: optionId } };
}

describe('Priest v0.28 talent grid', () => {
  it('contains the approved 18 talents in exact row order', () => {
    const tree = rowTreeFor('priest');
    expect(tree).not.toBeNull();
    expect(tree?.map((row) => row.options.map((option) => option.name))).toEqual(EXPECTED_ROWS);
  });

  it('keeps only the approved active action additions', () => {
    const tree = rowTreeFor('priest');
    if (!tree) throw new Error('Priest rows missing');
    const expectedGrants = new Map([
      ['Last Prayer', 'desperate_prayer'],
      ['Hushword', 'silence'],
      ['Stilled Mind', 'inner_focus'],
      ['Anointing', 'power_infusion'],
      ["Martyr's Aegis", 'martyrs_aegis'],
      ['Choir of Deliverance', 'choir_of_deliverance'],
    ]);

    for (const row of tree) {
      for (const option of row.options) {
        expect(option.effect.grant?.ability ?? null, option.name).toBe(
          expectedGrants.get(option.name) ?? null,
        );
      }
    }
  });

  it('pins Last Prayer to 30% maximum health', () => {
    expect(ABILITIES.desperate_prayer.effects).toEqual([{ type: 'selfHealPctMax', pct: 0.3 }]);
    expect(ABILITIES.desperate_prayer.cooldown).toBe(90);
  });

  it('gives each level 17 choice exactly one major-prayer action', () => {
    const tree = rowTreeFor('priest');
    const row = tree?.find((candidate) => candidate.level === 17);
    if (!row) throw new Error('level 17 row missing');
    for (const option of row.options) {
      const mods = computeTalentModifiers('priest', allocation(17, option.id), 20);
      const known = abilitiesKnownAt('priest', 20, mods).map(({ def }) => def.id);
      expect(known).toContain(option.effect.grant?.ability);
    }
  });
});
