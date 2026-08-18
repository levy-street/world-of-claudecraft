// Generic action-slot replacement. The learned base id remains authoritative for
// hotbars and persistence while the resolved definition changes with aura state.

import { ABILITIES } from '../data';
import type { ResolvedAbility } from '../sim';
import type { Entity } from '../types';

export function resolveActionReplacement(base: ResolvedAbility, actor: Entity): ResolvedAbility {
  const rules = base.def.actionReplacement;
  if (!rules) return base;
  // A def may carry one rule per spec engine; the aura kinds are spec-gated,
  // so at most one can be active. The first matching rule wins.
  for (const rule of Array.isArray(rules) ? rules : [rules]) {
    if (rule.actorAuraKind && !actor.auras.some((aura) => aura.kind === rule.actorAuraKind)) {
      continue;
    }
    const active = actor.auras.some(
      (aura) => aura.kind === rule.auraKind && (aura.stacks ?? 1) >= (rule.minStacks ?? 1),
    );
    if (active) {
      const replaced = replaceResolvedAbility(base, rule.abilityId, actor.level);
      // One slot, one clock: an aura-state transform that carries its own
      // cooldown checks and arms the BASE button's cooldown (Swiftmend and
      // Overbloom share one 8 sec clock), while a cooldown-free payoff
      // (Unleash Beast) casts through the base recharge and arms nothing.
      // Only THIS rule path stamps the shared key: the hunter resolver also
      // swaps defs via replaceResolvedAbility, and Pack Rally deliberately
      // owns its own clock (the resolver reverts the button while
      // cooldowns.has('pack_rally') runs).
      if (replaced !== base && replaced.cooldown > 0) replaced.cooldownId = base.def.id;
      return replaced;
    }
  }
  return base;
}

export function replaceResolvedAbility(
  base: ResolvedAbility,
  replacementId: string,
  actorLevel?: number,
): ResolvedAbility {
  const replacement = ABILITIES[replacementId];
  if (!replacement) return base;
  // A replacement target with ranks resolves the highest rank at the actor's
  // level, mirroring abilitiesKnownAt's rank walk. Until Redharvest grew ranks
  // no replacement target carried any, so the old hardcoded rank 1 was correct
  // by construction; with ranks it would cast rank-1 values at every level.
  // Callers without a level keep rank 1.
  let rank = 1;
  let cost = replacement.cost;
  let castTime = replacement.castTime;
  let effects = replacement.effects;
  let threatFlat = replacement.threat?.flat ?? 0;
  if (actorLevel !== undefined) {
    for (const r of replacement.ranks ?? []) {
      if (r.level <= actorLevel) {
        rank = r.rank;
        cost = r.cost;
        effects = r.effects;
        if (r.castTime !== undefined) castTime = r.castTime;
        if (r.threatFlat !== undefined) threatFlat = r.threatFlat;
      }
    }
  }
  return {
    def: replacement,
    rank,
    cost,
    castTime,
    cooldown: replacement.cooldown,
    effects: effects.map((effect) => ({ ...effect })),
    threatFlat,
    threatMult: replacement.threat?.mult ?? 1,
    castWhileMoving: replacement.castWhileMoving,
    charges: replacement.maxCharges,
    // A talent that cleared the base's stealth requirement (Cheap Trick on Gut
    // Punch) applies to this SLOT, not to a single ability id: the player's
    // choice is unchanged when the button transforms, so carry the cleared
    // requirement onto the replacement. The sim cast gate and the bar/tooltip
    // both read this flag, so dropping it would let a transformed action demand
    // stealth the build already removed. Inert until a stealth-gated ability
    // replaces into another, but correct by construction.
    ignoreStealthRequirement: base.ignoreStealthRequirement,
  };
}
