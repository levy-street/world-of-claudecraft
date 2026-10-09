// The trash kit's Wildheart Basin mechanics (MobTemplate.trashKit pulse,
// deathCloud): the Sunbone Totem's healing pulse and the Spore Toad's poison
// cloud. A sibling of driver.ts, which routes these keys here.
//
//   pulse       no cast bar: every `every` seconds each living ally in the
//               fight within `radius` (never the source) mends for a share of
//               its own maximum health. Kill the source fast.
//               A pulse source whose summoner has died crumbles: a totem never
//               outlives its binder, so it can never strand a fight on its own.
//   deathCloud  where the mob dies a cloud stands on the floor for `seconds`;
//               every `tick` seconds each player inside takes a roll. The cloud
//               is an encounter object the client mirrors (scale = radius), so
//               the floor shows exactly where not to stand.
//
// The Basin's own key block (trashKit.wildheart: the Quarry Mark, the War
// Roar, the Toad Hex, the alternating totems, the Rattling Dread, the Snaring
// Tongue) runs through the driver's extension seam (wildheart_extension.ts).
//
// Zero rng in every pick (allies in roster order, players in the claim's
// order); the only draws are the cloud's damage rolls, in roster order.

import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { livingInReach } from './targets';

/** Seconds until the next pulse, kept on the kit state's timers. */
const PULSE_TIMER = 'pulse';

/** Living mobs of the claim in the fight within `radius` of `from`, never
 *  `from` itself, in roster order. */
function pulseAllies(ctx: SimContext, inst: InstanceSlot, from: Entity, radius: number): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    if (id === from.id) continue;
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob' || !e.inCombat) continue;
    if (dist2d(e.pos, from.pos) > radius) continue;
    out.push(e);
  }
  return out;
}

/** Is the mob that summoned `add` (its owner in the claim) still alive? */
export function livingSummoner(ctx: SimContext, inst: InstanceSlot, add: Entity): boolean {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && e.hp > 0 && e.summonedIds.includes(add.id)) return true;
  }
  return false;
}

/**
 * The healing pulse of an engaged mob (a Sunbone Totem): count down, and on
 * each beat mend every hurt ally in reach. Returns how many it mended.
 */
export function stepPulse(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): number {
  const def = kit.pulse;
  if (!def) return 0;
  if (mob.summonedAdd && !livingSummoner(ctx, inst, mob)) {
    ctx.handleDeath(mob, null);
    return 0;
  }
  const left = (st.timers[PULSE_TIMER] ?? def.every) - DT;
  if (left > 1e-9) {
    st.timers[PULSE_TIMER] = left;
    return 0;
  }
  st.timers[PULSE_TIMER] = def.every;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  let n = 0;
  for (const ally of pulseAllies(ctx, inst, mob, def.radius)) {
    if (ally.hp >= ally.maxHp) continue;
    const amount = Math.max(1, Math.round(ally.maxHp * def.healPct));
    ctx.applyHeal(mob, ally, amount, def.name, def.castId, false);
    n++;
  }
  return n;
}

function dropObject(ctx: SimContext, inst: InstanceSlot, id: number | null): void {
  if (id === null) return;
  const at = inst.objectIds.indexOf(id);
  if (at >= 0) inst.objectIds.splice(at, 1);
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** The cloud's object on the floor where the mob fell (scale = its radius). */
function spawnCloud(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  name: string,
  templateId: string,
  radius: number,
): number {
  const obj = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(mob.pos.x, mob.pos.z));
  obj.templateId = templateId;
  obj.dungeonId = inst.dungeonId;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = 0;
  obj.prevFacing = 0;
  obj.scale = radius;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj.id;
}

/**
 * A dead kit mob with a death cloud: raise it on the tick the mob is first
 * seen dead, tick its poison on whoever stands inside, and clear it when it
 * fades. Returns the number of players the cloud struck this tick.
 */
export function stepDeathCloud(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  players: readonly Entity[],
): number {
  const def = kit.deathCloud;
  if (!def) return 0;
  let st = mob.deathBurst;
  if (!st) {
    st = {
      remaining: def.seconds,
      objectId: spawnCloud(ctx, inst, mob, def.name, def.objectTemplate, def.radius),
      done: false,
    };
    mob.deathBurst = st;
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school: def.school,
      fx: 'nova',
      ability: def.castId,
    });
  }
  if (st.done) return 0;
  const before = def.seconds - st.remaining;
  st.remaining -= DT;
  const after = def.seconds - st.remaining;
  let struck = 0;
  if (Math.floor((after + 1e-9) / def.tick) > Math.floor((before + 1e-9) / def.tick)) {
    for (const p of livingInReach(players, mob.pos, def.radius)) {
      const amount = Math.max(
        1,
        Math.round(ctx.rng.range(def.min, def.max) * (mob.mechanicDamageMult ?? 1)),
      );
      ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
      struck++;
    }
  }
  if (st.remaining <= 1e-9) {
    st.done = true;
    dropObject(ctx, inst, st.objectId);
    st.objectId = null;
  }
  return struck;
}

/**
 * Drop any cloud of `templateId` no mob of the claim still owns (its mob
 * respawned or left the world before the cloud faded): its poison can no
 * longer tick, so its warning must not linger on the floor. Zero rng; only
 * walks the claim's own rosters. Returns how many it dropped.
 */
export function sweepOrphanClouds(ctx: SimContext, inst: InstanceSlot, templateId: string): number {
  let clouds: number[] | null = null;
  for (const id of inst.objectIds) {
    if (ctx.entities.get(id)?.templateId !== templateId) continue;
    clouds ??= [];
    clouds.push(id);
  }
  if (!clouds) return 0;
  const owned = new Set<number>();
  for (const id of inst.mobIds) {
    const cloud = ctx.entities.get(id)?.deathBurst?.objectId;
    if (cloud !== null && cloud !== undefined) owned.add(cloud);
  }
  let dropped = 0;
  for (const id of clouds) {
    if (owned.has(id)) continue;
    dropObject(ctx, inst, id);
    dropped++;
  }
  return dropped;
}
