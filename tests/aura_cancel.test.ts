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

  // Regression: an internal-cooldown/engine-state aura (applyStateAura's
  // kind: 'internal_cd', e.g. hunter Enduring Courser's ICD gate) is not a
  // helpful buff a player carries, it is the timer that gates a burst's
  // refresh rate. It rode isDebuffAura's default (false, since it neither
  // matches DEBUFF_AURA_KINDS nor a negative buff_*), so isCancelableAura let
  // a right-click strip the gate off and re-trigger the burst it protects on
  // demand, well before its real duration, defeating the internal cooldown
  // entirely (100% uptime on a 60% speed burst meant to hold 3s per 20s).
  it('never exposes an internal-cooldown/engine-state aura as player-cancelable', () => {
    expect(isDebuffAura(aura('hunter_enduring_courser_icd', 'internal_cd'))).toBe(false);
    expect(isCancelableAura(aura('hunter_enduring_courser_icd', 'internal_cd'))).toBe(false);
    expect(isCancelableAura(aura('hunter_guise_mastery_icd', 'internal_cd'))).toBe(false);
  });

  // The one deliberate exception: Divine Ascension rides internal_cd but is a
  // genuine player-facing resource window (Sim.cancelAura has bespoke teardown
  // for it), so the fix above must not silently swallow it too.
  it('still allows the one player-facing internal_cd exception, Divine Ascension', () => {
    expect(isCancelableAura(aura('divine_ascension', 'internal_cd'))).toBe(true);
  });

  it('keeps Stormsurge Ready non-cancelable without making it a harmful debuff', () => {
    // Player feedback on PR #3668. Stormsurge is specifically styled on the UI
    // debuff surface, but the cancel path keeps the generic engine-state answer:
    // not a harmful debuff, still not player-cancelable unless allowlisted above.
    expect(isDebuffAura(aura('shaman_stormsurge_ready', 'internal_cd'))).toBe(false);
    expect(isCancelableAura(aura('shaman_stormsurge_ready', 'internal_cd'))).toBe(false);
    expect(isDebuffAura(aura('heating_up', 'internal_cd'))).toBe(false);
    expect(isCancelableAura(aura('heating_up', 'internal_cd'))).toBe(false);
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
