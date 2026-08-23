import { describe, expect, it } from 'vitest';
import {
  auraAffectsStats,
  isCancelableAura,
  isDebuffAura,
  removeCancelableAura,
} from '../src/sim/combat/aura_cancel';
import type { Aura, AuraKind } from '../src/sim/types';

function aura(id: string, kind: AuraKind, value = 1): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 10,
    duration: 10,
    value,
    sourceId: 1,
    school: 'physical',
  };
}

describe('isDebuffAura', () => {
  it('classifies the hard-CC / silence family as debuffs (never cancelable)', () => {
    for (const kind of [
      'stun',
      'root',
      'silence',
      'disarm',
      'blind',
      'hex',
      'polymorph',
      'incapacitate',
      'lockout',
      'slow',
      'dot',
      'bleed_vuln',
    ] as AuraKind[]) {
      expect(isDebuffAura(aura('x', kind))).toBe(true);
      expect(isCancelableAura(aura('x', kind))).toBe(false);
    }
  });

  it('treats a negative-value buff_* stat aura (a drain) as a debuff', () => {
    expect(isDebuffAura(aura('wither', 'buff_ap', -50))).toBe(true);
    // the same kind with a positive value is a real buff
    expect(isDebuffAura(aura('might', 'buff_ap', 50))).toBe(false);
  });

  it('treats forms, stances, stealth, and helpful enhancements as cancelable', () => {
    for (const kind of [
      'buff_armor',
      'buff_allstats',
      'hot',
      'absorb',
      'imbue',
      'thorns',
      'form_bear',
      'form_cat',
      'form_fireball',
      'form_moonkin',
      'form_shadow',
      'stealth',
      'defensive_stance',
      'righteous_fury',
    ] as AuraKind[]) {
      expect(isCancelableAura(aura('x', kind))).toBe(true);
    }
  });

  it('never exposes unbreakable encounter control as player-cancelable', () => {
    const scriptedStasis = {
      ...aura('scripted_stasis', 'stasis'),
      unbreakableControl: true,
    } as Aura;

    expect(isCancelableAura(scriptedStasis)).toBe(false);
  });

  it('never exposes an internal_cd lockout as player-cancelable', () => {
    // A proc gate re-arms on the lockout aura's presence, so cancelling it
    // would be a free cooldown reset. Not a debuff either: it stays on the
    // buff bar so the player can watch it tick down.
    expect(isCancelableAura(aura('hunter_guise_mastery_icd', 'internal_cd'))).toBe(false);
    expect(isDebuffAura(aura('hunter_guise_mastery_icd', 'internal_cd'))).toBe(false);
  });
});

describe('auraAffectsStats', () => {
  it('is true for stat buffs and forms, false for hot/absorb/imbue', () => {
    expect(auraAffectsStats(aura('x', 'buff_armor'))).toBe(true);
    expect(auraAffectsStats(aura('x', 'form_bear'))).toBe(true);
    expect(auraAffectsStats(aura('x', 'hot'))).toBe(false);
    expect(auraAffectsStats(aura('x', 'absorb'))).toBe(false);
    expect(auraAffectsStats(aura('x', 'imbue'))).toBe(false);
  });
});

describe('removeCancelableAura', () => {
  it('removes and returns the matching helpful buff', () => {
    const auras = [aura('might', 'buff_ap', 50), aura('renew', 'hot')];
    const removed = removeCancelableAura(auras, 'might');
    expect(removed?.id).toBe('might');
    expect(auras.map((a) => a.id)).toEqual(['renew']);
  });

  it('refuses to cancel a debuff sharing the requested id (no-op, returns null)', () => {
    const auras = [aura('hex', 'hex')];
    expect(removeCancelableAura(auras, 'hex')).toBeNull();
    expect(auras).toHaveLength(1);
  });

  it('refuses to cancel bleed vulnerability', () => {
    const auras = [aura('hemorrhage_bleed_vuln', 'bleed_vuln', 0.4)];
    expect(removeCancelableAura(auras, 'hemorrhage_bleed_vuln')).toBeNull();
    expect(auras).toHaveLength(1);
  });

  it('refuses to cancel an internal_cd lockout but still removes an ordinary buff', () => {
    const auras = [aura('hunter_guise_mastery_icd', 'internal_cd'), aura('might', 'buff_ap', 50)];
    expect(removeCancelableAura(auras, 'hunter_guise_mastery_icd')).toBeNull();
    expect(auras).toHaveLength(2);
    expect(removeCancelableAura(auras, 'might')?.id).toBe('might');
    expect(auras.map((a) => a.id)).toEqual(['hunter_guise_mastery_icd']);
  });

  it('still removes Divine Ascension, the one voluntarily cancelable internal_cd', () => {
    const auras = [aura('divine_ascension', 'internal_cd')];
    expect(removeCancelableAura(auras, 'divine_ascension')?.id).toBe('divine_ascension');
    expect(auras).toHaveLength(0);
  });

  it('returns null when nothing matches', () => {
    const auras = [aura('might', 'buff_ap', 50)];
    expect(removeCancelableAura(auras, 'absent')).toBeNull();
    expect(auras).toHaveLength(1);
  });

  it('removes only the first match, leaving a same-id duplicate in place', () => {
    const auras = [aura('might', 'buff_ap', 50), aura('might', 'buff_ap', 50)];
    removeCancelableAura(auras, 'might');
    expect(auras).toHaveLength(1);
  });
});
