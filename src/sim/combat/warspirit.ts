import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const SKYREND_AURA_ID = 'sha_skyrend';
export const SKYREND_MAX_STACKS = 5;
export const SKYREND_CAST_REDUCTION_PER_STACK = 0.2;
export const SKYREND_DAMAGE_BONUS_PER_STACK = 0.1;

export function warspiritArcBoltStacks(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  abilityId: string,
): number {
  if (abilityId !== 'lightning_bolt') return 0;
  if (meta.cls !== 'shaman' || ctx.playerMods(meta).spec !== 'enhancement') return 0;
  const aura = player.auras.find(
    (candidate) =>
      candidate.id === SKYREND_AURA_ID &&
      candidate.sourceId === player.id &&
      candidate.kind === 'stormcharge',
  );
  return Math.min(SKYREND_MAX_STACKS, aura?.stacks ?? 0);
}

export function warspiritArcBoltCastTime(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  abilityId: string,
  baseCastTime: number,
  stacks = warspiritArcBoltStacks(ctx, player, meta, abilityId),
): number {
  if (abilityId !== 'lightning_bolt' || baseCastTime <= 0) return baseCastTime;
  return Math.max(0, baseCastTime * (1 - stacks * SKYREND_CAST_REDUCTION_PER_STACK));
}

function consumeWarspiritArcBolt(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  abilityId: string,
): number {
  if (abilityId !== 'lightning_bolt') return 1;
  const stacks =
    player.warspiritArcBoltStacks ?? warspiritArcBoltStacks(ctx, player, meta, abilityId);
  delete player.warspiritArcBoltStacks;
  if (stacks <= 0) return 1;
  const index = player.auras.findIndex(
    (candidate) =>
      candidate.id === SKYREND_AURA_ID &&
      candidate.sourceId === player.id &&
      candidate.kind === 'stormcharge',
  );
  if (index >= 0) {
    const [aura] = player.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: player.id, name: aura.name, gained: false });
  }
  return 1 + stacks * SKYREND_DAMAGE_BONUS_PER_STACK;
}

export function clearWarspiritArcBoltSnapshot(player: Entity): void {
  delete player.warspiritArcBoltStacks;
}

export function prepareWarspiritArcBolt(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  resolved: ResolvedAbility,
): ResolvedAbility {
  const multiplier = consumeWarspiritArcBolt(ctx, player, meta, resolved.def.id);
  if (multiplier === 1) return resolved;
  return { ...resolved, damageMult: (resolved.damageMult ?? 1) * multiplier };
}
