// The Drowned Sergeant's Loose on My Mark (MobTemplate.trashKit.bastion.order),
// the trash pass's second wave on the engine's line-of-sight rule (G6): the
// sergeant points at one player past the tank and shouts (a 2 s kickable bar,
// the mark drawn over its target from the cast's own target id). When the
// shout lands, every living Fogbound Arbalest of the sergeant's own pack
// (Entity.dungeonPackId, as crypt_kit.ts reads a necromancer's warriors)
// looses a bolt at the mark at once; a wall or a crenel between an arbalest
// and the mark stops that one bolt. Kick the sergeant, or the marked player
// steps behind the battlements before the bar ends, or braces for it.
//
// Run through the Bastion extension (bastion_extension.ts). Zero rng in every
// pick (the mark is a hashed pick past the tank, the shooters go in roster
// order); the only draws are the bolts' damage rolls, in roster order.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { BASTION_MARKED_BOLT, BASTION_MARKED_BOLT_BLOCKED } from './bastion_cast_ids';
import { pickPastTank } from './wildheart_hunt';

/** The living, unstunned shooters of the caster's pack, in roster order. */
export function orderShooters(
  ctx: SimContext,
  inst: InstanceSlot,
  caster: Entity,
  kit: TrashKitDef,
) {
  const def = kit.bastion?.order;
  const out: Entity[] = [];
  if (!def || !caster.dungeonPackId) return out;
  for (const id of inst.mobIds) {
    if (id === caster.id) continue;
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob') continue;
    if (e.templateId !== def.shooters || e.dungeonPackId !== caster.dungeonPackId) continue;
    if (!e.inCombat || ctx.isStunned(e)) continue;
    out.push(e);
  }
  return out;
}

/** The shout's mark: a hashed pick past the tank, and only while at least one
 *  shooter of its pack stands to answer it. */
export function orderTarget(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.bastion?.order;
  if (!def || orderShooters(ctx, inst, mob, kit).length === 0) return null;
  return pickPastTank(players, mob, def.range, st.casts);
}

/** The shout landed: every shooter in reach looses at the mark; a wall stops
 *  a bolt. Returns the bolts that struck. */
export function landOrder(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
): number {
  const def = kit.bastion?.order;
  const mark = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !mark || mark.dead || mark.hp <= 0) return 0;
  let struck = 0;
  for (const shooter of orderShooters(ctx, inst, mob, kit)) {
    if (dist2d(shooter.pos, mark.pos) > def.shooterRange) continue;
    shooter.facing = angleTo(shooter.pos, mark.pos);
    const clear = ctx.hasLineOfSight(shooter, mark);
    ctx.emit({
      type: 'spellfx',
      sourceId: shooter.id,
      targetId: mark.id,
      school: 'physical',
      fx: 'heavyBolt',
      ability: clear ? BASTION_MARKED_BOLT : BASTION_MARKED_BOLT_BLOCKED,
    });
    if (!clear) continue;
    const amount = Math.max(
      1,
      Math.round(ctx.rng.range(def.min, def.max) * (shooter.mechanicDamageMult ?? 1)),
    );
    ctx.dealDamage(shooter, mark, amount, false, 'physical', def.boltName, 'hit', true);
    struck++;
    if (mark.dead) break;
  }
  return struck;
}
