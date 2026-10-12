// Owner display rename (2026-10-08): the Groveheart heal-over-time Wildbloom is
// now Sporemending, matching the Sporemender Form motif (and the spores its
// target wears, src/render/character_effects_core.ts). Display-only: the
// ability id stays `rejuvenation` (frozen API, saved action bars, the wire),
// so this pins the visible English in both layers, the five non-Latin fills
// the M16 rule owes, and that no player text still names the old spell.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABILITIES, ITEM_SETS } from '../src/sim/data';
import { en } from '../src/ui/i18n.resolved.generated/en';

const NON_LATIN_FILLS = {
  zh_CN: '孢愈术',
  zh_TW: '孢癒術',
  ja_JP: 'スポアメンディング',
  ko_KR: '포자치유',
  ru_RU: 'Спороисцеление',
} as const;

const OLD_NON_LATIN = [
  '野性绽放',
  '野性綻放',
  '野生の芽吹き',
  '야생 개화',
  'Дикий расцвет',
  'Дикого расцвета',
];

describe('Wildbloom is renamed Sporemending (display-only)', () => {
  it('keeps the frozen id and shows the new name in the sim and the English catalog', () => {
    expect(ABILITIES.rejuvenation.id).toBe('rejuvenation');
    expect(ABILITIES.rejuvenation.name).toBe('Sporemending');
    expect(en.entities.abilities.rejuvenation.name).toBe('Sporemending');
  });

  it('every English text that named the spell names it Sporemending', () => {
    expect(ABILITIES.swiftmend.description).toContain('Sporemending and Second Bloom');
    expect(ABILITIES.overbloom.description).toContain('a fresh Sporemending');
    expect(en.entities.abilities.swiftmend.description).toContain('Sporemending');
    expect(en.entities.abilities.overbloom.description).toContain('Sporemending');
    expect(en.hudChrome.auraEffect.verdance).toContain('Each NEW Sporemending');
    expect(ITEM_SETS.grovespring.bonuses.find((bonus) => bonus.pieces === 2)?.text).toContain(
      'your own Sporemending',
    );
    // Nothing in the resolved English table still says the old name.
    expect(JSON.stringify(en)).not.toContain('Wildbloom');
  });

  it('no locale overlay or talent override still carries an old translated name', () => {
    // The Latin rows were stripped to pending for the release fill; a bad merge
    // must not bring the old translation of the spell back. These are the exact
    // former names (whole phrases, so unrelated words sharing a stem pass).
    const oldLatin = [
      'Wildbloom',
      'Wildblüte',
      'Floración Silvestre',
      'Floraison sauvage',
      'Fioritura Selvaggia',
      'Florescer Selvagem',
      'Divoký květ',
      'Wildbloei',
      'Dziki rozkwit',
      'Mekar Liar',
      'Yaban Çiçeği',
      'Vildblomning',
      'Vildblomst',
      'Hoa Nở Hoang Dã',
    ];
    const read = (rel: string): string =>
      readFileSync(new URL(`../src/ui/${rel}`, import.meta.url), 'utf8');
    const sources = [
      'talent_i18n.row_description_overrides.ts',
      ...[
        'cs_CZ',
        'da_DK',
        'de_DE',
        'es',
        'es_ES',
        'fr_FR',
        'id_ID',
        'it_IT',
        'nl_NL',
        'pl_PL',
        'pt_BR',
        'sv_SE',
        'tr_TR',
        'vi_VN',
      ].map((lang) => `i18n.locales/${lang}.ts`),
    ];
    for (const rel of sources) {
      const text = read(rel);
      for (const old of [...oldLatin, ...OLD_NON_LATIN]) {
        expect(text.includes(old), `${rel} still names ${old}`).toBe(false);
      }
    }
  });

  it.each(Object.entries(NON_LATIN_FILLS))(
    '%s carries a real fill of the new name',
    (lang, name) => {
      const overlay = readFileSync(
        new URL(`../src/ui/i18n.locales/${lang}.ts`, import.meta.url),
        'utf8',
      );
      expect(overlay).toContain(`'entities.abilities.rejuvenation.name': '${name}'`);
      for (const old of OLD_NON_LATIN) expect(overlay).not.toContain(old);
    },
  );
});
