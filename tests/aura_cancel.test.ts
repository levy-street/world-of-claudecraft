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
      'stealth',
      'defensive_stance',
      'righteous_fury',
    ] as AuraKind[]) {
      expect(isCancelableAura(aura('x', kind))).toBe(true);
    }
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
