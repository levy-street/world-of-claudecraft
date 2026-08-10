import { beforeAll, describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { ROW_TREES, TALENTS } from '../src/sim/content/talents';
import { tEntity } from '../src/ui/entity_i18n';
import { setLanguage } from '../src/ui/i18n';
import { tTalent } from '../src/ui/talent_i18n';

beforeAll(() => {
  setLanguage('en');
});

describe('Paladin player-facing names', () => {
  it('uses the in-game specialization identities', () => {
    expect(TALENTS.paladin.specs.map(({ name }) => name)).toEqual([
      'Sunmender',
      'Faithwarden',
      'Dawnreaver',
    ]);
  });

  it('renames Aura Mastery to Sacred Concord everywhere players see it', () => {
    const talent = ROW_TREES.paladin
      .flatMap(({ options }) => options)
      .find(({ id }) => id === 'pal_r20_aura_mastery');
    expect(talent?.name).toBe('Sacred Concord');
    if (!talent) throw new Error('Missing pal_r20_aura_mastery');
    expect(tTalent({ kind: 'talentChoice', choice: talent, field: 'name' })).toBe('Sacred Concord');
    expect(ABILITIES.aura_mastery.name).toBe('Sacred Concord');
    expect(tEntity({ kind: 'ability', id: 'aura_mastery', field: 'name' })).toBe('Sacred Concord');
  });

  it('keeps every visible Paladin English tooltip name aligned with the sim', () => {
    for (const ability of Object.values(ABILITIES)) {
      if (ability.class !== 'paladin' || ability.hiddenFromPlayer === true) continue;
      expect(tEntity({ kind: 'ability', id: ability.id, field: 'name' }), ability.id).toBe(
        ability.name,
      );
    }
  });

  it('does not expose legacy specialization labels in visible Paladin descriptions', () => {
    const forbidden = ['Retribution:', 'Protection Paladins', 'Protection only.', 'Holy only.'];
    for (const ability of Object.values(ABILITIES)) {
      if (ability.class !== 'paladin' || ability.hiddenFromPlayer === true) continue;
      const translatedDescription = tEntity({
        kind: 'ability',
        id: ability.id,
        field: 'description',
      });
      for (const phrase of forbidden) {
        expect(ability.description, `${ability.id}: ${phrase}`).not.toContain(phrase);
        expect(translatedDescription, `${ability.id} localized: ${phrase}`).not.toContain(phrase);
      }
    }
  });
});
