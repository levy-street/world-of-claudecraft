import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PAIR_TARGETS } from '../src/sim/professions/archetype';
import {
  ARCHETYPE_IMAGE_ID_BY_PAIR,
  archetypeImageUrl,
  MASTERWORK_SEAL_IMAGE_URL,
  PROFESSION_IMAGE_IDS,
  professionImageUrl,
} from '../src/ui/profession_art';

const EXPECTED_IMAGE_IDS = [
  'archetype_apothecary',
  'archetype_arcanist',
  'archetype_bladewright',
  'archetype_bombardier',
  'archetype_cogsmith',
  'archetype_gembinder',
  'archetype_mageweaver',
  'archetype_outfitter',
  'archetype_smith',
  'archetype_trapper',
  'gather_fishing',
  'gather_herbalism',
  'gather_logging',
  'gather_mining',
  'masterwork_seal',
  'prof_alchemy',
  'prof_armorcrafting',
  'prof_cooking',
  'prof_enchanting',
  'prof_engineering',
  'prof_inscription',
  'prof_jewelcrafting',
  'prof_leatherworking',
  'prof_tailoring',
  'prof_weaponcrafting',
];

describe('profession painted-art registry', () => {
  it('wires every accepted profession-side raster asset exactly once', () => {
    expect([...PROFESSION_IMAGE_IDS].sort()).toEqual(EXPECTED_IMAGE_IDS);
  });

  it('maps every canonical adjacent pair to its commissioned archetype crest', () => {
    // The literal pin below guards accidental edits; this guard ties the key
    // set to the sim's canonical ring-derived pair ids (the char_window title
    // idiom), so a ring reorder or an eleventh craft cannot silently strip
    // every crest via archetypeImageUrl's null arm.
    expect(Object.keys(ARCHETYPE_IMAGE_ID_BY_PAIR).sort()).toEqual(
      [...ARCHETYPE_PAIR_TARGETS].sort(),
    );
    expect(ARCHETYPE_IMAGE_ID_BY_PAIR).toEqual({
      'alchemy+cooking': 'archetype_apothecary',
      'armorcrafting+engineering': 'archetype_cogsmith',
      'cooking+leatherworking': 'archetype_trapper',
      'enchanting+jewelcrafting': 'archetype_gembinder',
      'engineering+alchemy': 'archetype_bombardier',
      'inscription+enchanting': 'archetype_arcanist',
      'jewelcrafting+weaponcrafting': 'archetype_bladewright',
      'leatherworking+tailoring': 'archetype_outfitter',
      'tailoring+inscription': 'archetype_mageweaver',
      'weaponcrafting+armorcrafting': 'archetype_smith',
    });
  });

  it('resolves stable public URLs and rejects unknown or unattuned pairs', () => {
    expect(professionImageUrl('prof_alchemy')).toBe('/ui/professions/prof_alchemy.webp');
    expect(professionImageUrl('not_real')).toBeNull();
    expect(archetypeImageUrl('weaponcrafting+armorcrafting')).toBe(
      '/ui/professions/archetype_smith.webp',
    );
    expect(archetypeImageUrl(null)).toBeNull();
    expect(archetypeImageUrl('not+a+pair')).toBeNull();
    expect(MASTERWORK_SEAL_IMAGE_URL).toBe('/ui/professions/masterwork_seal.webp');
  });
});
