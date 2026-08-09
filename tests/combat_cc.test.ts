// Direct unit tests for src/sim/combat/cc.ts (C3). The crowd-control / status
// predicates are pure reads over e.auras (no rng, no emit, no SimContext), so they
// are tested by building minimal entities (just an auras array) and calling the
// exported functions. Proves the extracted module is callable on its own and that the
// moved branches are intact, independent of the parity golden.

import { describe, expect, it } from 'vitest';
import {
  blindMissBonus,
  damageBreakThreshold,
  hasUnbreakableMovementLock,
  incapacitateSourceAbilityId,
  isDisarmed,
  isFearAura,
  isLockedOut,
  isRooted,
  isSilenced,
  isStunned,
  isUnbreakableControlAura,
  SHARED_FEAR_AURA_ID,
  tonguesMult,
} from '../src/sim/combat/cc';
import { ABILITIES } from '../src/sim/data';
import type { AbilityEffect, Aura, Entity } from '../src/sim/types';

const directBreakableRoot: AbilityEffect = {
  type: 'aoeRoot',
  duration: 8,
  radius: 10,
  min: 6,
  max: 7,
  breakOnDamage: { maxHpPct: 0.15, min: 20, max: 60 },
};

const invalidBreakableRing: AbilityEffect = {
  type: 'aoeRoot',
  duration: 4,
  radius: 6,
  min: 0,
  max: 0,
  ring: { duration: 10, innerRadius: 4.5 },
  // @ts-expect-error persistent ring roots must not silently accept a direct-root damage budget
  breakOnDamage: { maxHpPct: 0.15, min: 20, max: 60 },
};

const invalidBreakableTrap: AbilityEffect = {
  type: 'aoeRoot',
  duration: 8,
  radius: 2,
  min: 0,
  max: 0,
  trap: { armTime: 1, lifetime: 60 },
  // @ts-expect-error armed traps must not silently accept a direct-root damage budget
  breakOnDamage: { maxHpPct: 0.15, min: 20, max: 60 },
};

const invalidBreakableStun: AbilityEffect = {
  type: 'aoeRoot',
  duration: 4,
  radius: 8,
  min: 6,
  max: 7,
  stun: true,
  // @ts-expect-error stuns must not silently accept a direct-root damage budget
  breakOnDamage: { maxHpPct: 0.15, min: 20, max: 60 },
};

void directBreakableRoot;
void invalidBreakableRing;
void invalidBreakableTrap;
void invalidBreakableStun;

function aura(kind: Aura['kind'], value = 1, extra: Partial<Aura> = {}): Aura {
  return {
    id: `${kind}_${value}`,
    name: kind,
    kind,
    remaining: 60,
    duration: 60,
    value,
    sourceId: 0,
    school: 'physical',
    ...extra,
  } as Aura;
}

function withAuras(...auras: Aura[]): Entity {
  return { auras } as unknown as Entity;
}

describe('cc: isStunned', () => {
  it('is true for stun, incapacitate, and polymorph', () => {
    expect(isStunned(withAuras(aura('stun')))).toBe(true);
    expect(isStunned(withAuras(aura('incapacitate')))).toBe(true);
    expect(isStunned(withAuras(aura('polymorph')))).toBe(true);
  });
  it('is false with no auras or an unrelated aura', () => {
    expect(isStunned(withAuras())).toBe(false);
    expect(isStunned(withAuras(aura('slow')))).toBe(false);
  });
});

describe('cc: isRooted', () => {
  it('is true for a root aura', () => {
    expect(isRooted(withAuras(aura('root')))).toBe(true);
  });
  it('is true whenever the entity is stunned (delegates to isStunned)', () => {
    expect(isRooted(withAuras(aura('stun')))).toBe(true);
    expect(isRooted(withAuras(aura('polymorph')))).toBe(true);
  });
  it('is false with no root/stun-family aura', () => {
    expect(isRooted(withAuras(aura('silence')))).toBe(false);
  });
});

describe('cc: unbreakable encounter control', () => {
  it('identifies protected auras and only movement-locking kinds stop relocation', () => {
    for (const kind of ['stun', 'stasis', 'root', 'incapacitate', 'polymorph'] as const) {
      const protectedAura = aura(kind, 0, { unbreakableControl: true });
      expect(isUnbreakableControlAura(protectedAura)).toBe(true);
      expect(hasUnbreakableMovementLock(withAuras(protectedAura))).toBe(true);
      expect(hasUnbreakableMovementLock(withAuras(protectedAura), protectedAura)).toBe(false);
    }

    expect(
      hasUnbreakableMovementLock(withAuras(aura('silence', 0, { unbreakableControl: true }))),
    ).toBe(false);
    expect(
      hasUnbreakableMovementLock(withAuras(aura('slow', 0, { unbreakableControl: true }))),
    ).toBe(false);
    expect(hasUnbreakableMovementLock(withAuras(aura('root')))).toBe(false);
  });
});

describe('cc: damageBreakThreshold', () => {
  const budget = { maxHpPct: 0.15, min: 20, max: 60 };

  it('rounds the health fraction and clamps both ends', () => {
    expect(damageBreakThreshold(100, budget)).toBe(20);
    expect(damageBreakThreshold(152, budget)).toBe(23);
    expect(damageBreakThreshold(1_000, budget)).toBe(60);
  });
});

describe('cc: isSilenced / isDisarmed', () => {
  it('isSilenced tracks the silence aura only', () => {
    expect(isSilenced(withAuras(aura('silence')))).toBe(true);
    expect(isSilenced(withAuras(aura('stun')))).toBe(false);
  });
  it('isDisarmed tracks the disarm aura only', () => {
    expect(isDisarmed(withAuras(aura('disarm')))).toBe(true);
    expect(isDisarmed(withAuras(aura('silence')))).toBe(false);
  });
});

describe('cc: isLockedOut', () => {
  it('is true only for a lockout aura of the matching school', () => {
    const e = withAuras(aura('lockout', 1, { school: 'fire' }));
    expect(isLockedOut(e, 'fire')).toBe(true);
    expect(isLockedOut(e, 'frost')).toBe(false);
  });
  it('is false with no lockout aura', () => {
    expect(isLockedOut(withAuras(aura('silence')), 'fire')).toBe(false);
  });
});

describe('cc: blindMissBonus', () => {
  it('returns 0 when not blinded and the strongest blind value otherwise', () => {
    expect(blindMissBonus(withAuras())).toBe(0);
    expect(
      blindMissBonus(withAuras(aura('blind', 0.2), aura('blind', 0.5), aura('blind', 0.3))),
    ).toBe(0.5);
  });
});

describe('cc: tonguesMult', () => {
  it('returns 1 when unafflicted and the strongest multiplier otherwise', () => {
    expect(tonguesMult(withAuras())).toBe(1);
    expect(tonguesMult(withAuras(aura('tongues', 1.3), aura('tongues', 1.6)))).toBe(1.6);
  });
});

describe('cc: isFearAura', () => {
  // There is no `fear` AuraKind: a fear is an `incapacitate` that also sends
  // the victim fleeing, carried by the shared aura id or by the source
  // ability's fearDr flag. This is the one rule that reads it, so every
  // consumer (the sim's own reads and the renderer's held CC band) agrees on
  // which incapacitates are fears.
  const usesFearDr = (id: string) => ABILITIES[id]?.fearDr === true;

  it('claims the shared fear id whatever applied it', () => {
    // Applied literally by the AoE fear effect, the mob flee driver, and
    // Banshee's Wail. Matched by id alone, proven here by a resolver that
    // answers false for everything: a mob-applied fear must never depend on
    // the warlock ability continuing to exist.
    expect(isFearAura({ id: SHARED_FEAR_AURA_ID, kind: 'incapacitate' }, () => false)).toBe(true);
  });

  it('claims a per-ability incapacitate whose ability uses fear diminishing returns', () => {
    expect(isFearAura({ id: 'death_coil_incap', kind: 'incapacitate' }, usesFearDr)).toBe(true);
  });

  it('refuses the incapacitates that hold a victim in place rather than running it', () => {
    for (const id of ['gouge_incap', 'sap_incap', 'wyvern_sting_incap', 'temporal_hourglass']) {
      expect(isFearAura({ id, kind: 'incapacitate' }, usesFearDr), id).toBe(false);
    }
  });

  it('refuses any aura of another kind, including one named like a fear', () => {
    expect(isFearAura({ id: SHARED_FEAR_AURA_ID, kind: 'stun' }, usesFearDr)).toBe(false);
    expect(isFearAura({ id: SHARED_FEAR_AURA_ID, kind: 'root' }, usesFearDr)).toBe(false);
    expect(isFearAura({ id: 'hamstring_slow', kind: 'slow' }, usesFearDr)).toBe(false);
  });

  it('covers every fearDr ability in the content tables (drift guard)', () => {
    // Derived from ABILITIES rather than hand-listed: a NEW fear ability that
    // sets fearDr must be claimed the moment it is authored, or its victims
    // silently read as an ordinary incapacitate.
    const fearAbilities = Object.values(ABILITIES).filter((a) => a.fearDr === true);
    expect(fearAbilities.length).toBeGreaterThan(0);
    for (const ability of fearAbilities) {
      expect(
        isFearAura({ id: `${ability.id}_incap`, kind: 'incapacitate' }, usesFearDr),
        `${ability.id} sets fearDr but its worn aura is not claimed as a fear`,
      ).toBe(true);
    }
  });
});

describe('cc: incapacitateSourceAbilityId', () => {
  it('parses the incapacitate id convention, and only that convention', () => {
    expect(incapacitateSourceAbilityId('death_coil_incap')).toBe('death_coil');
    expect(incapacitateSourceAbilityId('fear_incap')).toBe('fear');
    // Not the convention: no suffix at all, and a bare suffix with no ability.
    expect(incapacitateSourceAbilityId('temporal_hourglass')).toBeNull();
    expect(incapacitateSourceAbilityId('_incap')).toBeNull();
  });
});
