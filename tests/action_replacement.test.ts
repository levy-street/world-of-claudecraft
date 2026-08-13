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
});
