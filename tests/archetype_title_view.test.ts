import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PAIR_TARGETS } from '../src/sim/professions/archetype';
import { archetypeTitleText } from '../src/ui/hud/professions/archetype_title_view';

const EXPECTED_TITLES: Record<string, string> = {
  'engineering+alchemy': 'Bombardier',
  'alchemy+cooking': 'Apothecary',
  'cooking+leatherworking': 'Trapper',
  'leatherworking+tailoring': 'Outfitter',
  'tailoring+inscription': 'Inkweaver',
  'inscription+enchanting': 'Arcanist',
  'enchanting+jewelcrafting': 'Gembinder',
  'jewelcrafting+weaponcrafting': 'Bladewright',
  'weaponcrafting+armorcrafting': 'Smith',
  'armorcrafting+engineering': 'Gearwright',
};

describe('archetype_title_view', () => {
  it('names every selectable pair using the shared localized titles', () => {
    expect(Object.keys(EXPECTED_TITLES).sort()).toEqual([...ARCHETYPE_PAIR_TARGETS].sort());
    for (const [pair, title] of Object.entries(EXPECTED_TITLES)) {
      expect(archetypeTitleText(pair), pair).toBe(title);
    }
  });

  it('keeps the no-title fallback for null, unknown pairs and bare crafts', () => {
    for (const pair of [null, 'not_a_real_pair', 'armorcrafting']) {
      expect(archetypeTitleText(pair)).toBe('None');
    }
  });
});
