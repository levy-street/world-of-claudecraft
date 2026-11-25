import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  paladinVfxDetailNow,
  setPaladinCastTierResolver,
  setPaladinVfxDetailForTest,
  setPaladinVfxQuality,
} from '../src/render/ability_vfx/paladin_vfx_detail';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';

// The painter's half of the Paladin detail rule: every Paladin cue it
// dispatches runs inside a cast bracket, so a spawn reads its caster's spam
// budget tier, and a claimed cast charges that budget once like any class's.

function painter(budget = new AbilityVfxBudget()) {
  const seen: string[] = [];
  const fx = {
    hushbrandStrike: vi.fn(() => {
      seen.push(paladinVfxDetailNow());
    }),
  };
  const p = Object.assign(Object.create(AbilityVfx.prototype), {
    deps: { fx },
    releaseGesture: vi.fn(),
    budget,
    castChargeAt: new Map(),
    now: () => 0,
  }) as AbilityVfx;
  // The constructor registers this; the bare painter registers it by hand.
  setPaladinCastTierResolver((id) =>
    (p as unknown as { paladinCastTier(id: number): 0 | 1 | 2 }).paladinCastTier(id),
  );
  return { p, fx, seen, budget };
}

const brand = (sourceId: number) => ({
  sourceId,
  targetId: 99,
  school: 'physical' as const,
  ability: 'hushbrand',
  fx: 'selfCast' as const,
});

describe('Paladin detail through the painter', () => {
  afterEach(() => {
    setPaladinCastTierResolver(null);
    setPaladinVfxDetailForTest(null);
    setPaladinVfxQuality(1);
  });

  it("hands a spawn inside a Paladin cue its caster's budget tier, and only inside it", () => {
    setPaladinVfxQuality(1);
    const ambient = paladinVfxDetailNow();
    const f = painter();
    // A crowd of casts from caster 7 degrades its budget to the bottom tier.
    for (let i = 0; i < 64; i++) f.budget.admit(7, 0);
    expect(f.p.handleSpellfx(brand(7))).toBe(true);
    expect(f.seen).toEqual(['minimal']);
    // Outside the bracket the ambient detail is back.
    expect(paladinVfxDetailNow()).toBe(ambient);
  });

  it("never lets one caster's crowd degrade another caster's cue", () => {
    const f = painter();
    for (let i = 0; i < 64; i++) f.budget.admit(7, 0);
    f.p.handleSpellfx(brand(8));
    expect(f.seen[0]).not.toBe('minimal');
  });

  it('charges a claimed Paladin cast once per cast window, not per cue', () => {
    const f = painter();
    const admit = vi.spyOn(f.budget, 'admit');
    f.p.handleSpellfx(brand(3));
    f.p.handleSpellfx(brand(3));
    expect(admit).toHaveBeenCalledOnce();
    expect(admit).toHaveBeenCalledWith(3, 0);
  });

  it('closes the bracket when a dispatch throws', () => {
    const f = painter();
    const ambient = paladinVfxDetailNow();
    f.fx.hushbrandStrike.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => f.p.handleSpellfx(brand(4))).toThrow('boom');
    expect(paladinVfxDetailNow()).toBe(ambient);
  });

  it('reads the budget only when a Paladin spawn asks for the detail', () => {
    const f = painter();
    const peek = vi.spyOn(f.budget, 'peek');
    f.fx.hushbrandStrike.mockImplementationOnce(() => {});
    f.p.handleSpellfx(brand(5));
    expect(peek).not.toHaveBeenCalled();
  });
});
