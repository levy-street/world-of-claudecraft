import type { SimContext } from '../sim_context';
import type { AbilityDef, Aura, Entity } from '../types';
import { consumeAuraKind } from './empower_next';

function requiredAura(caster: Entity, ability: AbilityDef): Aura | undefined {
  return caster.auras.find(
    (aura) =>
      aura.kind === ability.requiresAuraKind &&
      (!ability.requiresOwnAura || aura.sourceId === caster.id) &&
      (aura.stacks ?? 1) >= (ability.requiresAuraStacks ?? 1),
  );
}

/** Shared admission check for full-aura gates and partial resource spenders. */
export function hasRequiredAura(caster: Entity, ability: AbilityDef): boolean {
  return !ability.requiresAuraKind || requiredAura(caster, ability) !== undefined;
}

/** Bill at cast commitment, before hit/resist, leaving failed admission untouched. */
export function consumeRequiredAura(ctx: SimContext, caster: Entity, ability: AbilityDef): boolean {
  if (!ability.requiresAuraKind) return true;
  const cost = ability.consumesRequiredAuraStacks;
  if (cost === undefined) {
    consumeAuraKind(ctx, caster, ability.requiresAuraKind);
    return true;
  }
  const aura = requiredAura(caster, ability);
  if (!aura || (aura.stacks ?? 1) < cost) return false;
  aura.stacks = (aura.stacks ?? 1) - cost;
  if (aura.stacks === 0) caster.auras.splice(caster.auras.indexOf(aura), 1);
  ctx.emit({
    type: 'aura',
    targetId: caster.id,
    name: aura.name,
    gained: aura.stacks > 0,
    auraKind: aura.kind,
  });
  return true;
}
