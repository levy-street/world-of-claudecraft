import { describe, expect, it } from 'vitest';
import { isDebuffAura } from '../src/sim/aura_classify';
import type { AuraKind } from '../src/sim/types';

// Every harmful kind the HUD and /targetbuffs treat as a debuff. Keeping this
// list here (not importing the module's own set) is deliberate: the test pins
// the contract so a silent edit to the source set fails loudly.
const HARMFUL: AuraKind[] = [
  'dot',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'attackspeed',
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
  'form_travel',
  'stealth',
  'defensive_stance',
  'righteous_fury',
  'buff_spi',
  'buff_scale',
  'buff_jump',
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
});
