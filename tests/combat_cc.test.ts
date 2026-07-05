// Direct unit tests for src/sim/combat/cc.ts (C3). The crowd-control / status
// predicates are pure reads over e.auras (no rng, no emit, no SimContext), so they
// are tested by building minimal entities (just an auras array) and calling the
// exported functions. Proves the extracted module is callable on its own and that the
// moved branches are intact, independent of the parity golden.

import { describe, expect, it } from 'vitest';
import {
  blindMissBonus,
  isDisarmed,
  isLockedOut,
  isRooted,
  isSilenced,
  isStunned,
  tonguesMult,
} from '../src/sim/combat/cc';
import type { Aura, Entity } from '../src/sim/types';

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
