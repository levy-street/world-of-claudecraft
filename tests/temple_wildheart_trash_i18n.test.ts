// The Drowned Temple and Wildheart Basin trash mechanics pass reaches the player
// LOCALIZED (mob/trash_kit/temple_choir.ts, temple_tide.ts, wildheart_hunt.ts).
//
// The sim splices each authored `name` (trashKit.temple.* and trashKit.wildheart.*)
// into the aura bar, the aura log, and the damage source label on the combat log,
// the meters and the death recap; all of them end at localizeSimAuraName, which
// returns null (raw English) for a name with no sim_i18n row. A cast's bar carries
// its castId, which the target cast bar resolves through abilityUi.cast.<castId>
// (targetCastDisplayName). This file DERIVES both sets from the merged MOBS table,
// so a newly authored Temple or Wildheart kit key reds here until it has its rows.

import { beforeAll, describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { SUNBONE_DREAD_TOTEM_ID } from '../src/sim/encounters/wildheart_basin/ids';
import { castDisplayName, targetCastDisplayName } from '../src/ui/cast_display_name';
import {
  ensureLocaleLoaded,
  type SupportedLanguage,
  setLanguage,
  type TranslationKey,
  t,
} from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

type NamedDef = { name: string; castId?: string };

/** Every named record under each mob's trashKit.temple / trashKit.wildheart. */
function kitDefs(): Array<{ mob: string; key: string; def: NamedDef }> {
  const out: Array<{ mob: string; key: string; def: NamedDef }> = [];
  for (const [mob, tmpl] of Object.entries(MOBS)) {
    for (const block of [tmpl.trashKit?.temple, tmpl.trashKit?.wildheart]) {
      if (!block) continue;
      for (const [key, def] of Object.entries(block as Record<string, NamedDef | undefined>)) {
        if (def && typeof def.name === 'string') out.push({ mob, key, def });
      }
    }
  }
  return out;
}

const NON_LATIN: SupportedLanguage[] = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'];

describe('the Temple and Wildheart trash mechanics localize', () => {
  beforeAll(async () => {
    await Promise.all(NON_LATIN.map((lang) => ensureLocaleLoaded(lang)));
  });

  const defs = kitDefs();

  it('finds the whole pass in the content (the derivation is not vacuous)', () => {
    const names = new Set(defs.map((d) => d.def.name));
    for (const n of [
      'Shrine Vigil',
      'Moonset Oath',
      'Lullaby Echo',
      'Prism Glare',
      'Spiral Whirlpool',
      'Arcing Spark',
      'Swollen Tide',
      'Quarry Mark',
      'War Roar',
      'Toad Hex',
      'Rattling Dread',
      'Snaring Tongue',
    ]) {
      expect(names.has(n), `${n} authored under a trashKit.temple/wildheart key`).toBe(true);
    }
  });

  it('every authored name resolves through the client matcher', () => {
    setLanguage('en');
    for (const { mob, key, def } of defs) {
      expect(localizeSimAuraName(def.name), `${mob}.${key} "${def.name}"`).toBe(def.name);
    }
  });

  it("the Snarlvine Lasher's Snarlbark thorns label resolves", () => {
    setLanguage('en');
    const thorns = MOBS.vine_lasher?.thorns;
    expect(thorns?.name).toBe('Snarlbark');
    expect(localizeSimAuraName(thorns?.name ?? '')).toBe('Snarlbark');
  });

  it('every cast id reads as its name on the cast bars, translated in the non-Latin locales', () => {
    const casts = defs.filter((d) => d.def.castId);
    // Prism Glare and Arcing Spark (Temple); Quarry Mark, War Roar, Toad Hex,
    // Rattling Dread, Snaring Tongue and Plant Totem (Wildheart).
    expect(casts.length).toBeGreaterThanOrEqual(8);
    for (const { def } of casts) {
      const id = def.castId as string;
      setLanguage('en');
      expect(t(`abilityUi.cast.${id}` as TranslationKey), `${id} catalog English`).toBe(def.name);
      expect(targetCastDisplayName(id), `${id} target cast bar`).toBe(def.name);
      expect(castDisplayName(id), `${id} cast bar`).toBe(def.name);
      for (const lang of NON_LATIN) {
        setLanguage(lang);
        const label = targetCastDisplayName(id);
        expect(label, `${lang} ${id}`).not.toBe(def.name);
        expect(label, `${lang} ${id}`).not.toBe(id);
      }
    }
    setLanguage('en');
  });

  it('the Sunbone Dread Totem has its entity name, translated in the non-Latin locales', () => {
    const key = `entities.mobs.${SUNBONE_DREAD_TOTEM_ID}.name` as TranslationKey;
    setLanguage('en');
    expect(t(key)).toBe(MOBS[SUNBONE_DREAD_TOTEM_ID]?.name);
    expect(t(key)).toBe('Sunbone Dread Totem');
    for (const lang of NON_LATIN) {
      setLanguage(lang);
      expect(t(key), lang).not.toBe('Sunbone Dread Totem');
    }
    setLanguage('en');
  });
});
