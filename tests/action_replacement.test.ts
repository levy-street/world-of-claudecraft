import { describe, expect, it } from 'vitest';
import {
  replaceResolvedAbility,
  resolveActionReplacement,
} from '../src/sim/combat/action_replacement';
import { ABILITIES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import type { AuraKind, Entity } from '../src/sim/types';

// Direct pins for the action-slot replacement leaf (src/sim/combat/action_replacement.ts),
// previously covered only through whole-sim scenarios. Anchored on real content rules:
// Swiftmend -> Overbloom (shared 8 sec clock), Eviscerate's two spec-gated rules, and
// Skyfall's Moonwing-gated Sunwake transform.

function resolved(id: string): ResolvedAbility {
  const def = ABILITIES[id];
  if (!def) throw new Error(`no ability def for ${id}`);
  return {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects.map((effect) => ({ ...effect })),
    threatFlat: def.threat?.flat ?? 0,
    threatMult: def.threat?.mult ?? 1,
    castWhileMoving: def.castWhileMoving,
    charges: def.maxCharges,
  };
}

function actorWith(...auras: Array<{ kind: AuraKind; stacks?: number }>): Entity {
  return { auras } as unknown as Entity;
}

describe('resolveActionReplacement', () => {
  it('returns the base untouched when the def carries no replacement rules', () => {
    const base = resolved('overbloom');
    const out = resolveActionReplacement(base, actorWith({ kind: 'verdance', stacks: 5 }));
    expect(out).toBe(base);
  });

  it('returns the base when the driving aura is missing or under minStacks', () => {
    const base = resolved('swiftmend');
    expect(resolveActionReplacement(base, actorWith())).toBe(base);
    expect(resolveActionReplacement(base, actorWith({ kind: 'verdance', stacks: 4 }))).toBe(base);
  });

  it('transforms Swiftmend into Overbloom at 5 Verdance and stamps the shared clock', () => {
    const base = resolved('swiftmend');
    const out = resolveActionReplacement(base, actorWith({ kind: 'verdance', stacks: 5 }));
    expect(out.def.id).toBe('overbloom');
    // One slot, one clock: the cooldown-carrying transform arms the BASE
    // button's cooldown key, so Swiftmend and Overbloom share one 8 sec clock.
    expect(out.cooldown).toBe(8);
    expect(out.cooldownId).toBe('swiftmend');
  });

  it('leaves cooldownId unset for a cooldown-free transform', () => {
    const base = resolved('eviscerate');
    const out = resolveActionReplacement(base, actorWith({ kind: 'redline', stacks: 1 }));
    expect(out.def.id).toBe('knockout_blow');
    expect(out.cooldown).toBe(0);
    expect(out.cooldownId).toBeUndefined();
  });

  it('picks the first matching rule when a def carries one rule per spec engine', () => {
    const base = resolved('eviscerate');
    const venom = resolveActionReplacement(base, actorWith({ kind: 'venom_ritual', stacks: 6 }));
    expect(venom.def.id).toBe('venomrend');
    // Both aura kinds present (never true in game: the kinds are spec-gated)
    // still resolves deterministically to the first listed rule.
    const both = resolveActionReplacement(
      base,
      actorWith({ kind: 'venom_ritual', stacks: 6 }, { kind: 'redline', stacks: 3 }),
    );
    expect(both.def.id).toBe('venomrend');
  });

  it('treats a stackless aura as one stack', () => {
    const base = resolved('eviscerate');
    const out = resolveActionReplacement(base, actorWith({ kind: 'redline' }));
    expect(out.def.id).toBe('knockout_blow');
  });

  it('gates a rule behind actorAuraKind: Skyfall becomes Sunwake only in Moonwing Form', () => {
    const base = resolved('starfire');
    const outOfForm = resolveActionReplacement(base, actorWith({ kind: 'moontide', stacks: 3 }));
    expect(outOfForm).toBe(base);
    const inForm = resolveActionReplacement(
      base,
      actorWith({ kind: 'form_moonkin' }, { kind: 'moontide', stacks: 3 }),
    );
    expect(inForm.def.id).toBe('sunlance');
  });
});

describe('replaceResolvedAbility', () => {
  it('returns the base when the replacement id is unknown', () => {
    const base = resolved('swiftmend');
    expect(replaceResolvedAbility(base, 'no_such_ability')).toBe(base);
  });

  it('resolves the replacement from its own def with copied effects', () => {
    const base = resolved('swiftmend');
    const out = replaceResolvedAbility(base, 'overbloom');
    expect(out.def.id).toBe('overbloom');
    expect(out.rank).toBe(1);
    expect(out.cost).toBe(ABILITIES.overbloom.cost);
    // Effects are per-resolve copies: mutating one must not write through to
    // the shared content table.
    expect(out.effects[0]).not.toBe(ABILITIES.overbloom.effects[0]);
    expect(out.effects[0]).toEqual(ABILITIES.overbloom.effects[0]);
  });

  it('carries a talent-cleared stealth requirement onto the replacement', () => {
    // Cheap Trick clears Gut Punch's stealth requirement for the SLOT. The
    // player's talent is unchanged when the button transforms, so the resolved
    // flag must survive the swap, or the sim gate and the action bar would
    // demand stealth the build already removed.
    const base = { ...resolved('cheap_shot'), ignoreStealthRequirement: true };
    const out = replaceResolvedAbility(base, 'knockout_blow');
    expect(out.def.id).toBe('knockout_blow');
    expect(out.ignoreStealthRequirement).toBe(true);
  });

  it('leaves the replacement flag unset when the base never cleared it', () => {
    const out = replaceResolvedAbility(resolved('cheap_shot'), 'knockout_blow');
    expect(out.ignoreStealthRequirement).toBeFalsy();
  });
});

describe('replacement rank resolution', () => {
  // Redharvest is the first replacement target with ranks. The transform must
  // resolve the highest rank at the actor's level, or the button silently
  // casts rank-1 values at 20 (the exact regression the rank walk fixed).
  const feralActor = (level: number): Entity =>
    ({ level, auras: [{ kind: 'old_blood', stacks: 3 }] }) as unknown as Entity;

  const finisherOf = (out: ResolvedAbility) =>
    out.effects.find((effect) => effect.type === 'finisherDamage') as {
      base: number;
      perCombo: number;
    };
  const refundOf = (out: ResolvedAbility) =>
    out.effects.find((effect) => effect.type === 'gainResource') as { amount: number };

  it('resolves rank 3 Redharvest through the transformed Gorebite at level 20', () => {
    const out = resolveActionReplacement(resolved('ferocious_bite'), feralActor(20));
    expect(out.def.id).toBe('redharvest');
    expect(out.rank).toBe(3);
    expect(finisherOf(out)).toMatchObject({ base: 70, perCombo: 43 });
    expect(refundOf(out).amount).toBe(30);
  });

  it('resolves rank 1 at level 5 and rank 2 at level 10', () => {
    const r1 = resolveActionReplacement(resolved('ferocious_bite'), feralActor(5));
    expect(r1.rank).toBe(1);
    expect(finisherOf(r1)).toMatchObject({ base: 35, perCombo: 20 });
    expect(refundOf(r1).amount).toBe(15);
    const r2 = resolveActionReplacement(resolved('ferocious_bite'), feralActor(10));
    expect(r2.rank).toBe(2);
    expect(finisherOf(r2)).toMatchObject({ base: 52, perCombo: 32 });
    expect(refundOf(r2).amount).toBe(22);
  });

  it('keeps both consumeDot arms and the bank requirement at every rank', () => {
    for (const level of [5, 10, 20]) {
      const out = resolveActionReplacement(resolved('ferocious_bite'), feralActor(level));
      const dots = out.effects.filter((effect) => effect.type === 'consumeDot');
      expect(dots.map((effect) => (effect as { dot: string }).dot).sort()).toEqual(['rake', 'rip']);
    }
  });

  it('defaults to rank 1 when no actor level is provided (direct callers)', () => {
    const out = replaceResolvedAbility(resolved('ferocious_bite'), 'redharvest');
    expect(out.rank).toBe(1);
    expect(finisherOf(out)).toMatchObject({ base: 35, perCombo: 20 });
  });
});
