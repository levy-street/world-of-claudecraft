// The unit a dual-purpose (targetType 'any') ability lands on at the press.
//
// A dual-purpose ability helps a friend or strikes a foe (Solar Invocation,
// Scouring Mercy, Shadeslip). It used to read the current target and nothing
// else, so the paladin's instant heal was the one heal that ignored a
// Clique-style party-frame mouseover (the override was dropped) and refused an
// empty selection with "You have no target." where every friendly heal
// self-casts. The order now, for a dual-purpose HEAL:
//   1. the party-frame mouseover override, while it is a live friendly unit;
//   2. the current target, exactly as before: a stale or dead selection is the
//      caller's to refuse, so a deliberate choice is never silently swapped;
//   3. with nothing selected, the attacker auto-acquire (issue #2787), which the
//      caller supplies because it also writes the new selection. Skipped when the
//      press came from a party-frame hover: that press was a heal, and a hovered
//      member who died must not turn it into a strike (and a new target) on
//      whatever is hitting you;
//   4. still nothing: cast on yourself, like a friendly heal.
// A dual-purpose ability that cannot heal (Shadeslip, the dispels) keeps the old
// rule exactly: no override, current target, then the attacker auto-acquire.
//
// Type-only imports: the client's mouseover core (src/ui/mouseover_cast_core.ts)
// and the pad auto-target (src/game/auto_target.ts) read isDualPurposeHeal too, so
// the side that sends the override and the side that honors it cover the same
// abilities. tests/dual_purpose_target.test.ts pins the import list.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export interface DualPurposeAbility {
  targetType?: string;
  effects?: readonly { readonly type: string }[];
}

export function isDualPurposeHeal(ability: DualPurposeAbility): boolean {
  return (
    ability.targetType === 'any' && (ability.effects ?? []).some((effect) => effect.type === 'heal')
  );
}

export function resolveDualPurposeTarget(
  ctx: SimContext,
  caster: Entity,
  overrideId: number | null,
  ability: DualPurposeAbility,
  acquireAttacker: () => Entity | null,
): Entity | null {
  const heals = isDualPurposeHeal(ability);
  const hoveredId = heals ? overrideId : null;
  if (hoveredId !== null) {
    const hovered = ctx.entities.get(hoveredId);
    if (hovered && !hovered.dead && ctx.isFriendlyTo(caster, hovered)) return hovered;
  }
  if (caster.targetId !== null) return ctx.entities.get(caster.targetId) ?? null;
  if (hoveredId === null) {
    const attacker = acquireAttacker();
    if (attacker) return attacker;
  }
  return heals ? caster : null;
}
