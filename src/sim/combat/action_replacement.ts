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
      const replaced = replaceResolvedAbility(base, rule.abilityId);
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
): ResolvedAbility {
  const replacement = ABILITIES[replacementId];
  if (!replacement) return base;
  return {
    def: replacement,
    rank: 1,
    cost: replacement.cost,
    castTime: replacement.castTime,
    cooldown: replacement.cooldown,
    effects: replacement.effects.map((effect) => ({ ...effect })),
    threatFlat: replacement.threat?.flat ?? 0,
    threatMult: replacement.threat?.mult ?? 1,
    castWhileMoving: replacement.castWhileMoving,
    charges: replacement.maxCharges,
  };
}
