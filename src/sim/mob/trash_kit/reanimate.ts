// The trash engine's reanimate (TrashKitDef.reanimate): a caster raises a
// FALLEN packmate. The bar is an interruptible rite on one corpse of the
// listed templates in reach (the nearest, ties to the lower id), never one
// already raised; when it lands a `summon` climbs out where the body lies, at
// `hpPct` of its health, straight onto the caster's victim. Kick the rite, or
// kill the caster first. The corpse keeps its loot (it is the dead soldier's
// spirit the rite drags up, not its body), but it is never raised twice.
//
// First consumer: the Broodsworn Thawcaller's Thaw the Held over the Sanctum
// Boneguard. Zero rng in every pick; the add takes its template's lowest
// level like every kit add (spawn.ts).

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { dist2d, type Entity, type TrashKitDef } from '../../types';
import { spawnKitAdd } from './spawn';

/** The nearest unraised corpse of the listed templates in reach, or null. */
export function pickReanimateCorpse(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
): Entity | null {
  const def = kit.reanimate;
  if (!def) return null;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.kind !== 'mob' || !e.dead || e.kitReanimated) continue;
    if (!def.corpses.includes(e.templateId)) continue;
    const d = dist2d(e.pos, mob.pos);
    if (d > def.range) continue;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** The rite's bar ran out: the held dead rise from the corpse. Returns the
 *  raised add, or null when the corpse is gone or already raised. */
export function landReanimate(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  corpseId: number | null,
): Entity | null {
  const def = kit.reanimate;
  const corpse = corpseId !== null ? ctx.entities.get(corpseId) : undefined;
  if (!def || !corpse || !corpse.dead || corpse.kitReanimated) return null;
  corpse.kitReanimated = true;
  const victim = mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
  const add = spawnKitAdd(ctx, inst, mob, def.summon, corpse.pos.x, corpse.pos.z, victim);
  if (!add) return null;
  add.hp = Math.max(1, Math.round(add.maxHp * def.hpPct));
  add.facing = corpse.facing;
  add.prevFacing = corpse.facing;
  ctx.emit({
    type: 'spellfx',
    sourceId: corpse.id,
    targetId: add.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  return add;
}
