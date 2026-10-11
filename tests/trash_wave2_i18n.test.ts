// The dungeon trash pass's second wave reaches the player LOCALIZED: every
// name the five mechanics splice into the aura bar, the combat log, the meters,
// the death recap and an engine orb's nameplate resolves through the client
// matcher (sim_i18n.ts localizeSimAuraName, kit_object_name.ts), and each of
// the three new bars reads as its name on the cast bars, translated in the
// non-Latin locales (the M16 rule). Read off the content, so a renamed record
// reds here until its rows follow.

import { beforeAll, describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { castDisplayName, targetCastDisplayName } from '../src/ui/cast_display_name';
import {
  ensureLocaleLoaded,
  type SupportedLanguage,
  setLanguage,
  type TranslationKey,
  t,
} from '../src/ui/i18n';
import { kitObjectDisplayName } from '../src/ui/kit_object_name';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const NON_LATIN: SupportedLanguage[] = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'];

const adept = MOBS.crypt_gravecaller_adept.trashKit?.nova;
const order = MOBS.drowned_sergeant.trashKit?.bastion?.order;
const throat = MOBS.bastion_revenant.trashKit?.walker;
const lure = MOBS.moonlit_siren.trashKit?.temple?.lure;
const pearl = MOBS.pearlguard_sentinel.trashKit?.walker;

describe('the trash pass second wave localizes', () => {
  beforeAll(async () => {
    await Promise.all(NON_LATIN.map((lang) => ensureLocaleLoaded(lang)));
  });

  it('finds every record (the derivation is not vacuous)', () => {
    for (const r of [adept, order, throat, lure, pearl]) expect(r).toBeDefined();
  });

  it('every name the sim splices resolves through the client matcher', () => {
    setLanguage('en');
    const names = [
      adept?.name,
      order?.boltName,
      throat?.name,
      throat?.empower.name,
      lure?.name,
      lure?.stunName,
      pearl?.name,
      pearl?.empower.name,
      pearl?.intercept.groupShield?.name,
    ];
    for (const n of names) {
      expect(n).toBeTypeOf('string');
      expect(localizeSimAuraName(n as string), n).toBe(n);
    }
  });

  it('the orbs name themselves through the kit object matcher', () => {
    setLanguage('en');
    for (const w of [throat, pearl]) {
      if (!w) throw new Error('walker');
      expect(kitObjectDisplayName(w.objectTemplate, w.name)).toBe(w.name);
    }
  });

  it('the three bars read as their names, translated in the non-Latin locales', () => {
    for (const def of [adept, order, lure]) {
      if (!def) throw new Error('cast');
      const id = def.castId;
      setLanguage('en');
      expect(t(`abilityUi.cast.${id}` as TranslationKey), id).toBe(def.name);
      expect(targetCastDisplayName(id), id).toBe(def.name);
      expect(castDisplayName(id), id).toBe(def.name);
      for (const lang of NON_LATIN) {
        setLanguage(lang);
        const label = targetCastDisplayName(id);
        expect(label, `${lang} ${id}`).not.toBe(def.name);
        expect(label, `${lang} ${id}`).not.toBe(id);
      }
    }
    setLanguage('en');
  });
});
