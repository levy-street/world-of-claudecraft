// The Jaguar Shrine Terrace as Zulgar's encounter modules read it (zulgar.ts
// and its siblings: the glyphs, the Hunting Spear, the Idol's Breath): who
// stands on it, and the two small reads they all share. Zero rng.

import { ZULGAR_SPOT } from '../../content/wildheart_basin_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Aura, Entity } from '../../types';
import { arenaPlayers, claimPlayers } from './claim';
import { ZULGAR_TERRACE_RADIUS } from './ids';

/** The shrine terrace's living players, in entity-id order. */
export function shrinePlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  return arenaPlayers(
    ctx,
    inst,
    claimPlayers(ctx, inst),
    ZULGAR_SPOT.x,
    ZULGAR_SPOT.z,
    ZULGAR_TERRACE_RADIUS,
  );
}

/** The entity's aura of id `id`, or undefined. */
export function auraOf(e: Entity, id: string): Aura | undefined {
  for (const a of e.auras) if (a.id === id) return a;
  return undefined;
}

/** Stop an encounter object's presentation clock (its cast bar). */
export function clearObjectClock(obj: Entity): void {
  if (obj.castingAbility === null) return;
  obj.castingAbility = null;
  obj.castRemaining = 0;
  obj.castTotal = 0;
  obj.castTargetId = null;
}

/** Run an encounter object's presentation clock: `left` of `total` seconds
 *  of `castId` (a replicated cast bar; objects never run mob casting). */
export function setObjectClock(
  obj: Entity,
  castId: string,
  total: number,
  left: number,
  targetId: number | null = null,
): void {
  obj.castingAbility = castId;
  obj.castTotal = total;
  obj.castRemaining = Math.max(0, left);
  obj.castTargetId = targetId;
  obj.channeling = false;
}
