import { describe, expect, it } from 'vitest';
import {
  isDebuffAura,
  isDebuffDisplayAura,
  isDispellableAura,
  isPartyFrameRelevantAura,
} from '../src/sim/aura_classify';
import type { Aura, AuraKind } from '../src/sim/types';

// Every harmful kind the HUD and /targetbuffs treat as a debuff. Keeping this
// list here (not importing the module's own set) is deliberate: the test pins
// the contract so a silent edit to the source set fails loudly.
const HARMFUL: AuraKind[] = [
  'dot',
  'forced_move',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'attackspeed',
  'bleed_vuln',
  'vuln_source',
  'debuff_ap',
  'sunder',
  'mortal_wound',
  'silence',
  'disarm',
  'blind',
  'expose',
  'spellvuln',
  'lockout',
  'vulnerability',
  'hex',
  'tongues',
  'cost_tax',
  'heal_absorb',
  'critvuln',
];

const HELPFUL: AuraKind[] = [
  'buff_ap',
  'buff_armor',
  'buff_int',
  'buff_agi',
  'buff_dodge',
  'buff_speed',
  'buff_haste',
  'hot',
  'absorb',
  'imbue',
  'buff_sta',
  'buff_allstats',
  'thorns',
  'form_bear',
  'form_cat',
  'form_moonkin',
  'form_shadow',
  'form_travel',
  'form_fireball',
  'stealth',
  'defensive_stance',
  'righteous_fury',
  'buff_spi',
  'buff_scale',
  'buff_jump',
  'affliction_fate_threads',
];

describe('isDebuffAura', () => {
  it('tags every harmful kind as a debuff', () => {
    for (const kind of HARMFUL) {
      expect(isDebuffAura(kind, 1)).toBe(true);
    }
  });

  it('tags helpful/neutral kinds as not-a-debuff at non-negative value', () => {
    for (const kind of HELPFUL) {
      expect(isDebuffAura(kind, 1)).toBe(false);
    }
  });

  it('treats a negative-value stat buff (buff_*) as a debuff', () => {
    // e.g. a mob draining attack power reuses buff_ap with a negative amount.
    expect(isDebuffAura('buff_ap', -50)).toBe(true);
    expect(isDebuffAura('buff_int', -10)).toBe(true);
    expect(isDebuffAura('buff_allstats', -5)).toBe(true);
  });

  it('does not treat a zero-value stat buff as a debuff', () => {
    expect(isDebuffAura('buff_ap', 0)).toBe(false);
  });

  it('keeps a harmful kind a debuff regardless of value sign', () => {
    expect(isDebuffAura('dot', 0)).toBe(true);
    expect(isDebuffAura('slow', 0.5)).toBe(true);
  });

  it('keeps shared internal_cd markers non-harmful', () => {
    expect(isDebuffAura('internal_cd', 1)).toBe(false);
    expect(isDebuffAura('internal_cd', 0)).toBe(false);
  });

  it('id display override: shaman_stormsurge_ready uses the debuff surface', () => {
    // Player feedback on PR #3668: Stormsurge's "cannot proc again until
    // Ancestral Strike is back on cooldown" marker (shaman_warspirit.ts
    // STORMSURGE_READY_ID) should use debuff-bar styling, but it is not a
    // player-removable harmful aura.
    expect(isDebuffDisplayAura('internal_cd', 1, 'shaman_stormsurge_ready')).toBe(true);
    expect(isDebuffDisplayAura('internal_cd', 1, 'heating_up')).toBe(false);
    expect(isDebuffDisplayAura('internal_cd', 0, 'shaman_warspirit_cadence')).toBe(false);
  });

  it("classifies Maker's Brand as an actionable raid-frame debuff", () => {
    const brand = { id: 'varkhul_makers_brand', kind: 'vuln_source' as const, value: 0.7 };
    expect(isDebuffAura(brand.kind, brand.value)).toBe(true);
    expect(isPartyFrameRelevantAura(brand)).toBe(true);
  });
});

describe('isDispellableAura', () => {
  it('never offers unbreakable encounter control to a player dispel', () => {
    const aura = {
      kind: 'silence',
      value: 0,
      school: 'shadow',
      unbreakableControl: true,
    } as Pick<Aura, 'kind' | 'value' | 'school'> & { unbreakableControl: true };

    expect(isDispellableAura(aura, false)).toBe(false);
  });

  it('does not let dispel or Spellsteal detach the Divine Ascension HUD aura from its state', () => {
    const ascension = {
      id: 'divine_ascension',
      kind: 'internal_cd' as const,
      value: 0,
      school: 'holy' as const,
    };
    expect(isDispellableAura(ascension, true)).toBe(false);
    expect(isDispellableAura(ascension, false)).toBe(false);
  });

  it('does not route the Stormsurge Ready display override into dispel eligibility', () => {
    const stormsurgeReady = {
      id: 'shaman_stormsurge_ready',
      kind: 'internal_cd' as const,
      value: 1,
      school: 'nature' as const,
    };
    // The debuff-bar styling override is visual only. Friendly dispel/cleanse
    // must not read this personal proc indicator as a harmful effect.
    expect(isDispellableAura(stormsurgeReady, true)).toBe(false);
    expect(isDispellableAura(stormsurgeReady, false)).toBe(false);
  });
});
