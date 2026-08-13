import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { Entity } from '../types';

export const COLD_FOCUS_AURA_ID = 'cold_focus';

export function resolveColdsightAbility(
  resolved: ResolvedAbility,
  hunter: Entity,
  meta: PlayerMeta,
): ResolvedAbility {
  if (meta.cls !== 'hunter') return resolved;
  return resolveColdsightAbilityForSpec(resolved, hunter, meta.talents.spec);
}

export function resolveColdsightAbilityForSpec(
  resolved: ResolvedAbility,
  hunter: Entity,
  spec: string | null,
): ResolvedAbility {
  if (spec !== 'marksmanship') return resolved;
  if (!hunter.auras.some((aura) => aura.kind === 'hunter_cold_focus')) return resolved;
  if (resolved.def.id === 'measured_shot') {
    return {
      ...resolved,
      effects: resolved.effects.map((effect) =>
        effect.type === 'gainResource' ? { ...effect, amount: 30 } : effect,
      ),
    };
  }
  if (resolved.def.id === 'aimed_shot') {
    return {
      ...resolved,
      cost: Math.max(1, Math.round(resolved.cost * 0.75)),
      castTime: resolved.castTime * 0.7,
    };
  }
  return resolved;
}
