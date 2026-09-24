// Rift and Buried Hoard player text the sim emits in English (boss yells, the
// generated theme / floor / plan names) re-localizes on the client through
// src/ui/rift_text_i18n.ts. Pins: every content yell and every generator name
// shape has a key whose English is the content literal (English unchanged), and
// the Spanish render actually differs through the real HUD entry points.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAVE_THEMES } from '../src/sim/content/rift/cave_themes';
import { RIFT_THEMES } from '../src/sim/content/rift/themes';
import { generateRiftPlan, RIFT_SUFFIXES } from '../src/sim/rift/rift_gen';
import { riftFloorLabel } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import {
  localizeRiftBossYell,
  localizeRiftPlaceName,
  riftPlaceNouns,
  riftYellEntries,
} from '../src/ui/rift_text_i18n';
import { localizeAuthoredYellText, localizeSimText } from '../src/ui/sim_i18n';

// Literal Spanish renders (src/ui/i18n.locales/es.ts sim.rift.* rows).
const ES_MUSHROOM_ENGAGE = 'Las esporas te atraparán.';
const ES_FROST_ENRAGE = '¡CONGELAOS!';
const ES_SPORE_FLOOR_LABEL = 'Hondonada de Esporas: Tesoro enterrado (B)';
const ES_SPORE_PLAN = 'El Tesoro Enterrado de Esporas';
const ES_SPORE_ENTER = 'Desciendes a Hondonada de Esporas: Tesoro enterrado.';

beforeAll(async () => {
  await ensureLocaleLoaded('es');
});
afterAll(() => setLanguage('en'));

describe('rift boss yells', () => {
  it('covers every rift and hoard boss yell, English unchanged', () => {
    setLanguage('en');
    const entries = riftYellEntries();
    // The four cave bosses, the eight hoard/rift bosses and the citadel pair.
    const bosses = new Set(entries.map((e) => e.templateId));
    for (const id of [
      'hoard_boss_mushroom',
      'hoard_boss_mole',
      'hoard_boss_bat',
      'hoard_boss_mimic',
      'rift_boss_frost',
      'rift_boss_ember',
      'rift_boss_venom',
      'rift_boss_necro',
      'rift_boss_brute',
      'rift_boss_arcane',
      'rift_boss_storm',
      'rift_boss_tide',
      'rift_boss_ritualist',
      'rift_boss_pitlord',
    ])
      expect(bosses.has(id), id).toBe(true);
    for (const e of entries) {
      expect(localizeRiftBossYell(e.text), `${e.templateId}.${e.slot}`).toBe(e.text);
      expect(localizeAuthoredYellText(e.text, 'mob')).toBe(e.text);
    }
  });

  it('renders a cave boss and a hoard boss yell in Spanish through the chat path', () => {
    setLanguage('es');
    expect(localizeAuthoredYellText('The spores will have you.', 'mob')).toBe(ES_MUSHROOM_ENGAGE);
    expect(localizeAuthoredYellText('FREEZE!', 'mob')).toBe(ES_FROST_ENRAGE);
    // A player shouting the same words keeps them verbatim.
    expect(localizeAuthoredYellText('FREEZE!', 'player')).toBe('FREEZE!');
    for (const e of riftYellEntries()) {
      expect(localizeRiftBossYell(e.text), `${e.templateId}.${e.slot}`).not.toBe(e.text);
    }
    setLanguage('en');
  });
});

describe('rift and hoard place names', () => {
  it('rebuilds every generator name shape, English unchanged', () => {
    setLanguage('en');
    for (const theme of [...RIFT_THEMES, ...CAVE_THEMES]) {
      const names = [
        `${theme.name} Buried Hoard`,
        `${theme.name} Sanctum: Depth 3`,
        `${theme.name} Reaches: Depth 1`,
        `Shattered Crown: ${theme.name} Depth 2`,
      ];
      for (const name of names) expect(localizeRiftPlaceName(name)).toBe(name);
    }
    for (const noun of riftPlaceNouns()) {
      expect(localizeRiftPlaceName(`The Buried ${noun} Hoard`)).toBe(`The Buried ${noun} Hoard`);
      for (const suffix of RIFT_SUFFIXES)
        expect(localizeRiftPlaceName(`The ${noun} ${suffix}`)).toBe(`The ${noun} ${suffix}`);
    }
    expect(localizeRiftPlaceName('The Infernal Citadel')).toBe('The Infernal Citadel');
    expect(localizeRiftPlaceName('The Brimstone Citadel')).toBe('The Brimstone Citadel');
    expect(localizeRiftPlaceName('Buried Hoard entrance')).toBe('Buried Hoard entrance');
    // Real generated plan names all parse (procedural, hoard and citadel seeds).
    for (let seed = 1; seed <= 400; seed++) {
      const name = generateRiftPlan(seed * 7919, 20).name;
      expect(localizeRiftPlaceName(name), name).toBe(name);
    }
    expect(localizeRiftPlaceName('Some free-text title')).toBeNull();
  });

  it('renders a cave theme floor and hoard plan name in Spanish', () => {
    setLanguage('es');
    expect(riftFloorLabel('Spore Hollow Buried Hoard', 'B')).toBe(ES_SPORE_FLOOR_LABEL);
    expect(localizeRiftPlaceName('The Buried Spore Hoard')).toBe(ES_SPORE_PLAN);
    expect(localizeSimText('You climb down into Spore Hollow Buried Hoard.')).toBe(ES_SPORE_ENTER);
    for (const theme of [...RIFT_THEMES, ...CAVE_THEMES]) {
      const name = `${theme.name} Buried Hoard`;
      expect(localizeRiftPlaceName(name), name).not.toContain(theme.name);
    }
    setLanguage('en');
    expect(riftFloorLabel('Spore Hollow Buried Hoard', 'B')).toContain('Spore Hollow Buried Hoard');
  });
});
