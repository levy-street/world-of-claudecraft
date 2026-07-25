// The Source Cave (Phase 6): i18n coverage for the new/confirmed display surfaces.
//  - the dungeon-name lookup (entities.dungeons.source_cave.*), which used to
//    silently render the literal id 'source_cave' (see docs/the-source-cave/state.md);
//  - the Phase 3/4 sim.sourceCave.* / source_cave_mantle keys are still resolvable
//    and unchanged (confirmed, not re-added).

import { describe, expect, it } from 'vitest';
import { SOURCE_CAVE_MOB_BANTER_LINES } from '../src/sim/source_cave';
import { dungeonDisplayName, tEntity } from '../src/ui/entity_i18n';
import {
  ensureLocaleLoaded,
  hasTranslation,
  setLanguage,
  supportedLanguages,
  t,
} from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';
import { localizeSourceCaveRebootYell } from '../src/ui/source_cave_reboot_yell';

const translatedLocales = supportedLanguages.filter((l) => l !== 'en' && l !== 'en_CA');
// M16's five required non-Latin fills.
const M16_LOCALES = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;

describe('source_cave dungeon name resolves through the entity dictionary (Phase 6)', () => {
  it('is the real English name, not the raw id, at the tEntity/dungeonDisplayName seam', () => {
    setLanguage('en');
    expect(tEntity({ kind: 'dungeon', id: 'source_cave', field: 'name' })).toBe('The Source Cave');
    expect(dungeonDisplayName('source_cave')).toBe('The Source Cave');
  });

  it('resolves (never the raw id) in every translated locale, once loaded', async () => {
    // Locales lazy-load (src/ui/CLAUDE.md): a synchronous setLanguage BEFORE
    // ensureLocaleLoaded resolves would silently read the English-resident
    // fallback table and pass a weak "not the raw id" check without proving any
    // translation happened at all, so this awaits the real per-locale chunk first.
    for (const lang of translatedLocales) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      const out = dungeonDisplayName('source_cave');
      expect(out, `${lang}: cave name resolves`).toBeTruthy();
      expect(out, `${lang}: cave name must not leak the raw id`).not.toBe('source_cave');
      expect(
        hasTranslation('entities.dungeons.source_cave.name', lang),
        `${lang}: registered`,
      ).toBe(true);
    }
    setLanguage('en');
  });

  it('carries the M16 five non-Latin fills for the new wordy catalog value (real translation, not English)', async () => {
    for (const lang of M16_LOCALES) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      const out = dungeonDisplayName('source_cave');
      expect(out, `${lang}: cave name must not stay English`).not.toBe('The Source Cave');
    }
    setLanguage('en');
  });
});

describe('Source Cave Phase 3/4 catalog keys are still resolvable (confirmed, not re-added)', () => {
  it('sim.sourceCave.* keys exist and are non-empty in English', () => {
    setLanguage('en');
    expect(t('sim.sourceCave.locked', { name: 'The Source Cave' })).toContain('The Source Cave');
    expect(t('sim.sourceCave.enter')).toBe('You step into the Source Cave.');
    expect(t('sim.sourceCave.leave')).toBe('You leave the Source Cave.');
    expect(
      t('sim.sourceCave.killProgress', { name: 'octocat', killed: '3', total: '8' }),
    ).toContain('octocat');
    expect(t('sim.sourceCave.cleared')).toBe('The Source Cave has been cleared.');
  });

  it('sim.dungeon.levelRequired (the generic level-gate matcher) still resolves', () => {
    setLanguage('en');
    expect(t('sim.dungeon.levelRequired', { level: '20', name: 'The Source Cave' })).toContain(
      '20',
    );
  });

  it('localizes the runtime dungeon name in the real level-gate payload', async () => {
    for (const lang of M16_LOCALES) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      const localizedName = dungeonDisplayName('source_cave');
      const out = localizeSimText('You must reach level 20 to enter The Source Cave.');
      expect(out, `${lang}: localized level gate`).toContain(localizedName);
      expect(out, `${lang}: no English dungeon-name leak`).not.toContain('The Source Cave');
    }
    setLanguage('en');
  });

  it('the source_cave_mantle item name is registered', () => {
    setLanguage('en');
    expect(tEntity({ kind: 'item', id: 'source_cave_mantle', field: 'name' })).toBe(
      'Mantle of the Source',
    );
  });

  it('the three guaranteed rare item names are registered', () => {
    expect(tEntity({ kind: 'item', id: 'conflictbreaker_breastplate', field: 'name' })).toBe(
      'Conflictbreaker Breastplate',
    );
    expect(tEntity({ kind: 'item', id: 'cherry_pickers_gauntlets', field: 'name' })).toBe(
      "Cherry-Picker's Gauntlets",
    );
    expect(tEntity({ kind: 'item', id: 'maintainers_crown', field: 'name' })).toBe(
      "Maintainer's Crown",
    );
  });

  it('keeps the renamed keyboard weapon aligned with its five non-Latin fills', async () => {
    const expected = {
      zh_CN: '击键',
      zh_TW: '擊鍵',
      ja_JP: 'キーストローク',
      ko_KR: '키스트로크',
      ru_RU: 'Нажатие клавиши',
    } as const;
    for (const lang of M16_LOCALES) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      expect(tEntity({ kind: 'item', id: 'mech_keyboard', field: 'name' })).toBe(expected[lang]);
    }
    setLanguage('en');
  });
});

describe('Source Cave chest "Access denied" toast localization', () => {
  // The deny is an error TOAST on interaction only, never a nameplate label
  // (user decision): the chest keeps its normal interact label while sealed.
  it('the sim toast key resolves in English', () => {
    setLanguage('en');
    expect(t('sim.sourceCave.accessDenied')).toBe('Access denied.');
  });

  it('carries the required five non-Latin translations (M16)', async () => {
    for (const lang of M16_LOCALES) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      expect(t('sim.sourceCave.accessDenied'), `${lang}: toast translated`).not.toBe(
        'Access denied.',
      );
    }
    setLanguage('en');
  });
});

describe('Source Cave friendly banter localization', () => {
  const BANTER_KEYS = [
    'worldContent.sourceCaveBanterIssue',
    'worldContent.sourceCaveBanterPullRequest',
    'worldContent.sourceCaveBanterConflicts',
    'worldContent.sourceCaveBanterContribute',
    'worldContent.sourceCaveBanterFocused',
    'worldContent.sourceCaveBanterNextRelease',
    'worldContent.sourceCaveBanterRefresh',
  ] as const;

  it('routes every banter payload through its key, mob-authored only', () => {
    setLanguage('en');
    expect(SOURCE_CAVE_MOB_BANTER_LINES).toHaveLength(BANTER_KEYS.length);
    SOURCE_CAVE_MOB_BANTER_LINES.forEach((line, i) => {
      expect(t(BANTER_KEYS[i])).toBe(line);
      expect(localizeSourceCaveRebootYell(line, true)).toBe(t(BANTER_KEYS[i]));
      // The same words typed by a player stay untouched.
      expect(localizeSourceCaveRebootYell(line, false)).toBe(line);
    });
  });

  it('carries the required five non-Latin translations for every banter line (M16)', async () => {
    for (const lang of M16_LOCALES) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      SOURCE_CAVE_MOB_BANTER_LINES.forEach((line, i) => {
        expect(t(BANTER_KEYS[i]), `${lang}: ${BANTER_KEYS[i]}`).not.toBe(line);
      });
    }
    setLanguage('en');
  });
});

describe('Source Cave reboot yell localization', () => {
  it('routes the boss payload through its key without rewriting player-authored chat', () => {
    setLanguage('en');
    expect(t('worldContent.sourceCaveRebootYell')).toBe('What have you done?!');
    expect(localizeSourceCaveRebootYell('What have you done?!', true)).toBe(
      t('worldContent.sourceCaveRebootYell'),
    );
    expect(localizeSourceCaveRebootYell('What have you done?!', false)).toBe(
      'What have you done?!',
    );
    expect(localizeSourceCaveRebootYell('A different yell', true)).toBe('A different yell');
  });

  it('routes both staggered reaction payloads through their keys, mob-authored only', () => {
    setLanguage('en');
    expect(t('worldContent.sourceCaveRebootYellWhatsGoingOn')).toBe("Hey, what's going on?");
    expect(t('worldContent.sourceCaveRebootYellServerDown')).toBe('Guys, the server is down!');
    expect(localizeSourceCaveRebootYell("Hey, what's going on?", true)).toBe(
      t('worldContent.sourceCaveRebootYellWhatsGoingOn'),
    );
    expect(localizeSourceCaveRebootYell('Guys, the server is down!', true)).toBe(
      t('worldContent.sourceCaveRebootYellServerDown'),
    );
    // The same words typed by a player stay untouched.
    expect(localizeSourceCaveRebootYell("Hey, what's going on?", false)).toBe(
      "Hey, what's going on?",
    );
    expect(localizeSourceCaveRebootYell('Guys, the server is down!', false)).toBe(
      'Guys, the server is down!',
    );
  });

  it('carries the required five non-Latin translations for all three yells', async () => {
    for (const lang of M16_LOCALES) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      expect(t('worldContent.sourceCaveRebootYell'), `${lang}: translated`).not.toBe(
        'What have you done?!',
      );
      expect(t('worldContent.sourceCaveRebootYellWhatsGoingOn'), `${lang}: translated`).not.toBe(
        "Hey, what's going on?",
      );
      expect(t('worldContent.sourceCaveRebootYellServerDown'), `${lang}: translated`).not.toBe(
        'Guys, the server is down!',
      );
    }
    setLanguage('en');
  });
});
