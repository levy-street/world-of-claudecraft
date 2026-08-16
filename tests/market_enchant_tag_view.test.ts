import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { enchantTagStats, marketEnchantTagText } from '../src/ui/market_enchant_tag_view';

describe('market_enchant_tag_view', () => {
  it('reads the enchant def statBonus for a marker copy', () => {
    // enchant_weapon_intellect grants int (named "Spellpower" but the stat is int).
    expect(ENCHANTS.enchant_weapon_intellect.statBonus).toEqual({ int: 2 });
    expect(enchantTagStats({ enchant: 'enchant_weapon_intellect' })).toEqual([
      { stat: 'int', value: 2 },
    ]);
    expect(marketEnchantTagText({ enchant: 'enchant_weapon_intellect' })).toBe('+2 Int');
  });

  it('tags each enchant type distinctly so different-enchant rows are told apart', () => {
    expect(marketEnchantTagText({ enchant: 'enchant_weapon_might' })).toBe('+2 Str');
    expect(marketEnchantTagText({ enchant: 'enchant_weapon_agility' })).toBe('+2 Agi');
    expect(marketEnchantTagText({ enchant: 'enchant_weapon_intellect' })).toBe('+2 Int');
    // A higher-magnitude enchant on a different slot renders its real number.
    expect(marketEnchantTagText({ enchant: 'enchant_chest_stamina' })).toBe('+4 Sta');
  });

  it('returns no tag for a plain, signer-only, or masterwork copy', () => {
    expect(marketEnchantTagText(undefined)).toBe('');
    expect(marketEnchantTagText({})).toBe('');
    expect(marketEnchantTagText({ signer: 'Ada' })).toBe('');
    expect(marketEnchantTagText({ rolled: { masterwork: true, stats: { str: 2 } } })).toBe('');
  });

  it('falls back to baked stats for a legacy enchanted copy (bare rolled.stats, no id)', () => {
    // Pre-marker enchanted copies: rolled.stats present WITHOUT masterwork, no enchant id.
    expect(marketEnchantTagText({ rolled: { stats: { agi: 3 } } })).toBe('+3 Agi');
  });

  it('ignores an unknown enchant id rather than throwing', () => {
    expect(marketEnchantTagText({ enchant: 'enchant_does_not_exist' })).toBe('');
  });

  it('every content enchant produces a non-empty tag from its statBonus', () => {
    // Guards the mapping: if a new stat axis is added to an enchant, this fails until the
    // short-label map covers it, rather than silently dropping the tag.
    for (const [id, def] of Object.entries(ENCHANTS)) {
      const hasStat = Object.values(def.statBonus).some((v) => (v ?? 0) !== 0);
      if (!hasStat) continue;
      expect(marketEnchantTagText({ enchant: id }), `enchant ${id} should tag`).not.toBe('');
    }
  });
});
