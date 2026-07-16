// Fulmination's escalating Arc Bolt Overload. The talent gate and active ward gate
// happen before the one proc draw; each replay rechecks live hostility in case the
// preceding hit ended a duel or match. Damage replay and nearest-enemy selection draw nothing.

import type { SimContext } from '../sim_context';
import type { AbilityDef, Entity } from '../types';

export const FULMINATION_OVERLOAD_CHANCE_PER_CHARGE = 0.05;
export const FULMINATION_OVERLOAD_DAMAGE_MULT = 0.5;
export const FULMINATION_OVERLOAD_CHAIN_RADIUS = 8;

function hasFulmination(ctx: SimContext, player: Entity): boolean {
  const meta = ctx.players.get(player.id);
  return (
    meta?.cls === 'shaman' &&
    ctx.playerMods(meta).procs.some((proc) => proc.id === 'sha_fulmination')
  );
}

function nearestChainTarget(ctx: SimContext, player: Entity, primary: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const candidate of ctx.hostilesInRadius(
    player,
    primary.pos,
    FULMINATION_OVERLOAD_CHAIN_RADIUS,
  )) {
    if (candidate.id === primary.id || !ctx.hasLineOfSight(primary, candidate)) continue;
    const dx = candidate.pos.x - primary.pos.x;
    const dz = candidate.pos.z - primary.pos.z;
    const d2 = dx * dx + dz * dz;
    if (best === null || d2 < bestD2 || (d2 === bestD2 && candidate.id < best.id)) {
      best = candidate;
      bestD2 = d2;
    }
  }
  return best;
}

function dealOverload(
  ctx: SimContext,
  player: Entity,
  visualSource: Entity,
  target: Entity,
  damage: number,
  abilityName: string,
  school: AbilityDef['school'],
): boolean {
  if (!ctx.isHostileTo(player, target)) return false;
  ctx.emit({
    type: 'spellfx',
    sourceId: visualSource.id,
    targetId: target.id,
    school,
    fx: 'projectile',
  });
  ctx.dealDamage(
    player,
    target,
    damage,
    false,
    school,
    abilityName,
    'hit',
    false,
    undefined,
    true,
    false,
    false,
    null,
  );
  return true;
}

export function maybeFulminationOverload(
  ctx: SimContext,
  player: Entity,
  primary: Entity,
  abilityId: string,
  abilityName: string,
  school: AbilityDef['school'],
  damage: number,
): void {
  if (
    abilityId !== 'lightning_bolt' ||
    damage <= 0 ||
    !ctx.isHostileTo(player, primary) ||
    !hasFulmination(ctx, player)
  )
    return;
  const ward = player.auras.find(
    (aura) => aura.id === 'lightning_shield' && aura.sourceId === player.id,
  );
  const charges = ward?.charges ?? 0;
  if (charges <= 0) return;
  const chance = Math.min(1, charges * FULMINATION_OVERLOAD_CHANCE_PER_CHARGE);
  if (!ctx.rng.chance(chance)) return;

  const overloadDamage = Math.max(1, Math.round(damage * FULMINATION_OVERLOAD_DAMAGE_MULT));
  const chained = nearestChainTarget(ctx, player, primary);
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: player.id,
    school,
    fx: 'procSurge',
  });
  if (!dealOverload(ctx, player, player, primary, overloadDamage, abilityName, school)) return;
  if (!chained) return;
  dealOverload(ctx, player, primary, chained, overloadDamage, abilityName, school);
}
