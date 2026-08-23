import { describe, expect, it } from 'vitest';
import { isDebuffAura, isDispellableAura, isPlayerRemovableAura } from '../src/sim/aura_classify';
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
});

// Sim-owned lockout kinds. The aura's PRESENCE is the cooldown, so any
// player-driven removal (right-click cancel, cleanse, a friendly dispel, an
// enemy's offensive dispel or Spellsteal) is a free cooldown reset. Pinned here
// so no kind can drift back into the removable set.
const LOCKOUT: AuraKind[] = ['internal_cd', 'sated', 'cauterize_fatigue'];

const ALL_SCHOOLS: Aura['school'][] = [
  'physical',
  'fire',
  'frost',
  'arcane',
  'shadow',
  'holy',
  'nature',
];

describe('lockout kinds (internal cooldowns)', () => {
  it('no player counter may remove a lockout at all', () => {
    for (const kind of LOCKOUT) {
      expect(isPlayerRemovableAura({ kind })).toBe(false);
      expect(isPlayerRemovableAura({ id: 'hunter_guise_mastery_icd', kind })).toBe(false);
    }
  });

  it('refuses dispel and Spellsteal for a lockout at every school and both polarities', () => {
    for (const kind of LOCKOUT) {
      for (const school of ALL_SCHOOLS) {
        for (const offensive of [true, false]) {
          expect(isDispellableAura({ kind, value: 1, school }, offensive)).toBe(false);
          expect(isDispellableAura({ kind, value: 0, school }, offensive)).toBe(false);
        }
      }
    }
  });

  it('keeps an internal_cd off the debuff bar (renders as a watchable buff icon)', () => {
    expect(isDebuffAura('internal_cd', 1)).toBe(false);
    expect(isDebuffAura('internal_cd', 0)).toBe(false);
  });

  it('keeps sated and cauterize_fatigue on the debuff bar (they render red)', () => {
    expect(isDebuffAura('sated', 0)).toBe(true);
    expect(isDebuffAura('cauterize_fatigue', 0)).toBe(true);
  });

  it('keeps Divine Ascension voluntarily cancelable (a resource state, not a lockout)', () => {
    // An internal_cd aura a player may remove: right-click cancel ends the
    // ascension and Sim.cancelAura zeroes its charges. Dispel and Spellsteal
    // still refuse it by id (pinned in the isDispellableAura suite above).
    expect(isPlayerRemovableAura({ id: 'divine_ascension', kind: 'internal_cd' })).toBe(true);
  });

  it('keeps Stoneward purgeable and stealable (a ward, not a lockout)', () => {
    // Stoneward is a real ally-carried healing ward that wears the internal_cd
    // kind; nothing re-arms on its presence, so purge and Spellsteal remain
    // legitimate counterplay and its carrier may right-click it off.
    const stoneward = { id: 'shaman_stoneward', kind: 'internal_cd' as const };
    expect(isPlayerRemovableAura(stoneward)).toBe(true);
    expect(isDispellableAura({ ...stoneward, value: 0, school: 'nature' }, true)).toBe(true);
    expect(isDispellableAura({ ...stoneward, value: 0, school: 'nature' }, false)).toBe(false);
  });
});
