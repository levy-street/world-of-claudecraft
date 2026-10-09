// The trash engine's split (TrashKitDef.split): once per pull, the first
// tick a mob is under `belowHpPct` of its health it breaks in two. The body
// that was there stays (its pull, its threat, its pack and its loot are
// untouched) and shrinks to `scale` of its size; a copy of itself (a summoned
// add of the same template, so it drops nothing) climbs out a stride away on
// the same victim. Each half holds `share` of the health the original had
// left, as a full bar of its own, so the group sees two smaller bodies to
// kill rather than one tougher one; with `share` above a half the pair is a
// little more work than the half they replace. A split body's death burst
// shrinks by `burstScale` (death_burst.ts reads Entity.kitSplit), which is
// what asks the group to spread the two deaths apart. Neither half splits
// again.
//
// The original keeps its pre-split pool and size on Entity.kitSplit and gets
// them back when the pull ends alive (an evade, or out of combat after a
// reset): a split is a fight's state, never the mob's. The copy is a true
// twin of a placed pack mob (its level and tuning, spawn.ts `twin`) that is
// still a summoned add, so it drops nothing and despawns with an evade. Zero rng (the copy stands on the side
// facing away from the victim, hashed by nothing).

import { MOBS } from '../../data';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity, TrashKitDef, TrashKitState } from '../../types';
import { kitOf } from './kit_of';
import { spawnKitAdd } from './spawn';

/** Yards between the two halves as they part. */
const SPLIT_STRIDE = 2.2;

/** Split now when the mob is under its threshold and never split. Returns the
 *  copy on the tick it splits, else null. */
export function stepSplit(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): Entity | null {
  const def = kit.split;
  if (!def || st.split || mob.kitSplit || mob.dead || mob.hp <= 0) return null;
  if (mob.hp > mob.maxHp * def.belowHpPct) return null;
  st.split = true;
  const half = Math.max(1, Math.ceil(mob.hp * def.share));
  mob.kitSplit = { role: 'parent', maxHp: mob.maxHp, scale: mob.scale };
  const base = MOBS[mob.templateId]?.scale ?? mob.scale;
  mob.maxHp = half;
  mob.hp = half;
  mob.scale = base * def.scale;
  // The copy steps out to the side, square to the victim (never behind the
  // tank into the group, never in front of it).
  const side = mob.facing + Math.PI / 2;
  const victim = mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
  const copy = spawnKitAdd(
    ctx,
    inst,
    mob,
    mob.templateId,
    mob.pos.x + Math.sin(side) * SPLIT_STRIDE,
    mob.pos.z + Math.cos(side) * SPLIT_STRIDE,
    victim,
    { level: mob.level },
  );
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: copy?.id ?? mob.id,
    school: 'frost',
    fx: 'nova',
    ability: def.castId,
  });
  if (!copy) return null;
  copy.kitSplit = { role: 'child' };
  // It hits as the original does (the same level and pack tuning, and the
  // same mechanic multiplier its burst reads).
  copy.mechanicDamageMult = mob.mechanicDamageMult;
  copy.maxHp = half;
  copy.hp = half;
  copy.scale = base * def.scale;
  copy.facing = mob.facing;
  copy.prevFacing = mob.facing;
  return copy;
}

/** The pull ended with the original alive (an evade, or out of combat after a
 *  reset): it gets its pool and size back. A mob that only lost its target
 *  for a tick mid-fight (a flee, a retarget) keeps its split. */
export function restoreSplit(mob: Entity): void {
  const s = mob.kitSplit;
  if (s?.role !== 'parent' || mob.dead) return;
  if (mob.aiState !== 'evade' && mob.inCombat) return;
  mob.maxHp = s.maxHp;
  mob.hp = Math.max(mob.hp, s.maxHp);
  mob.scale = s.scale;
  mob.kitSplit = undefined;
}

/** How much a split body's death burst shrinks (1 for an unsplit body). */
export function splitBurstScale(mob: Entity): number {
  if (!mob.kitSplit) return 1;
  return kitOf(mob)?.split?.burstScale ?? 1;
}
