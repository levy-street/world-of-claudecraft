// The trash kit's Gravewyrm Sanctum mechanics (MobTemplate.trashKit goad,
// toss, stoke): the Broodsworn Goadsmith's Goad, the Ogre Sledge-Hauler's Ice
// Block Toss and the Soul Brazier's quickening soulfire. A sibling of
// driver.ts, which routes these keys here. (The Rime Whelp's slowing pop and
// the Glacier Splinter's shatter ride the shared death burst, death_burst.ts.)
//
//   goad    an interruptible goad at one ally in the fight: a damage-done aura
//           for a few seconds (another ally before itself, never one already
//           goaded). Kick it, or pull the goaded mob off the healer.
//   toss    the farthest player in reach is marked when the bar starts: a ring
//           is painted where they stood (an encounter object the client
//           mirrors, scale = radius), and the block lands on everyone inside it
//           when the bar ends. Physical: dodge it, never kick it. With
//           `leavesWall` the block stays where it fell as a temporary combat
//           wall (combat_walls.ts): cover from the casters, for a while.
//   stoke   no cast bar: every few seconds each living ally in the fight near
//           the source swings faster for a few seconds. A stoke source whose
//           summoner has died gutters out, so a brazier never holds a fight on
//           its own. Kill it fast.
//
// Zero rng in every pick (allies in roster order, players in entity-id order,
// the farthest ties to the lower id); the only draws are the toss's damage
// rolls, in entity-id order.

import { SANCTUM_TOSS_RING } from '../../encounters/gravewyrm_sanctum/ids';
import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { spawnCombatWall } from './combat_walls';
import { SANCTUM_GOADED, SANCTUM_STOKED } from './sanctum_cast_ids';
import { livingInReach } from './targets';

/** Seconds until the next stoke, kept on the kit state's timers. */
const STOKE_TIMER = 'stoke';

/** Living mobs of the claim in the fight within `range` of `from` (the
 *  caster counts), in roster order. */
function fightingAllies(
  ctx: SimContext,
  inst: InstanceSlot,
  from: Entity,
  range: number,
): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob') continue;
    if (e.id !== from.id && !e.inCombat) continue;
    if (dist2d(e.pos, from.pos) > range) continue;
    out.push(e);
  }
  return out;
}

function goaded(e: Entity): boolean {
  return e.auras.some((a) => a.id === SANCTUM_GOADED);
}

/** The Goad's ally: the first ungoaded ally in the fight in reach (roster
 *  order), the caster only when nobody else stands bare. */
export function pickGoadTarget(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
): Entity | null {
  const def = kit.goad;
  if (!def) return null;
  const bare = fightingAllies(ctx, inst, mob, def.range).filter((e) => !goaded(e));
  return bare.find((e) => e.id !== mob.id) ?? bare[0] ?? null;
}

/** The Goad's bar ran out: its ally (if it still stands) takes the fury. */
export function landGoad(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
): boolean {
  const def = kit.goad;
  const ally = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !ally || ally.dead || ally.hp <= 0) return false;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: ally.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  ctx.applyAura(ally, {
    id: SANCTUM_GOADED,
    name: def.name,
    kind: 'buff_dmg_done',
    remaining: def.seconds,
    duration: def.seconds,
    value: def.damagePct,
    sourceId: mob.id,
    school: def.school,
  });
  return true;
}

/** The toss's victim: the farthest living player within reach (ties to the
 *  lower id), or null when nobody stands in reach. */
export function pickTossTarget(
  players: readonly Entity[],
  mob: Entity,
  kit: TrashKitDef,
): Entity | null {
  const def = kit.toss;
  if (!def) return null;
  let best: Entity | null = null;
  let bestD = -1;
  for (const p of livingInReach(players, mob.pos, def.range)) {
    const d = dist2d(p.pos, mob.pos);
    if (d > bestD + 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function dropObject(ctx: SimContext, inst: InstanceSlot, id: number | null): void {
  if (id === null) return;
  const at = inst.objectIds.indexOf(id);
  if (at >= 0) inst.objectIds.splice(at, 1);
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** The toss's bar started: lock the spot under its victim and paint the ring. */
export function lockToss(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  target: Entity | null,
): void {
  const def = kit.toss;
  if (!def || !target) return;
  const at = ctx.groundPos(target.pos.x, target.pos.z);
  const obj = createGroundObject(ctx.nextId++, '', def.name, at);
  obj.templateId = SANCTUM_TOSS_RING;
  obj.dungeonId = inst.dungeonId;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = 0;
  obj.prevFacing = 0;
  obj.scale = def.radius;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  st.toss = { x: at.x, z: at.z, objectId: obj.id };
}

/** A toss that will never land (its bar broke, its pull ended): lift the ring. */
export function dropToss(ctx: SimContext, inst: InstanceSlot, st: TrashKitState): void {
  if (!st.toss) return;
  dropObject(ctx, inst, st.toss.objectId);
  st.toss = undefined;
}

/** The toss's bar ran out: the block lands on everyone inside the ring.
 *  Returns how many it struck. */
export function landToss(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): number {
  const def = kit.toss;
  const spot = st.toss;
  dropToss(ctx, inst, st);
  if (!def || !spot) return 0;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  let n = 0;
  for (const p of livingInReach(players, { x: spot.x, y: 0, z: spot.z }, def.radius)) {
    const amount = Math.max(
      1,
      Math.round(ctx.rng.range(def.min, def.max) * (mob.mechanicDamageMult ?? 1)),
    );
    ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
    n++;
  }
  // The block stays where it fell: a temporary combat wall (combat_walls.ts),
  // its broad face turned to the thrower.
  if (def.leavesWall) {
    const facing = Math.atan2(spot.x - mob.pos.x, spot.z - mob.pos.z);
    spawnCombatWall(
      ctx,
      inst,
      def.leavesWall.objectTemplate,
      def.leavesWall.name,
      spot.x,
      spot.z,
      facing,
      def.leavesWall.seconds,
    );
  }
  return n;
}

/** Drop any toss ring no living tosser still holds (its owner died or left
 *  mid-bar). Zero rng; only walks the claim's own rosters. */
export function sweepOrphanTossRings(ctx: SimContext, inst: InstanceSlot): number {
  let rings: number[] | null = null;
  for (const id of inst.objectIds) {
    if (ctx.entities.get(id)?.templateId !== SANCTUM_TOSS_RING) continue;
    rings ??= [];
    rings.push(id);
  }
  if (!rings) return 0;
  const held = new Set<number>();
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    const ring = e && !e.dead ? e.trashKit?.toss?.objectId : null;
    if (ring !== null && ring !== undefined) held.add(ring);
  }
  let dropped = 0;
  for (const id of rings) {
    if (held.has(id)) continue;
    dropObject(ctx, inst, id);
    dropped++;
  }
  return dropped;
}

/** Is the mob that summoned `add` (its owner in the claim) still alive? */
function livingSummoner(ctx: SimContext, inst: InstanceSlot, add: Entity): boolean {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && e.hp > 0 && e.summonedIds.includes(add.id)) return true;
  }
  return false;
}

/**
 * The quickening soulfire of an engaged mob (a Soul Brazier): count down, and
 * on each beat every ally in the fight near it swings faster for a while.
 * Returns how many it stoked, or -1 when it guttered out (its summoner is
 * dead and so is it now: the caller stops).
 */
export function stepStoke(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): number {
  const def = kit.stoke;
  if (!def) return 0;
  if (mob.summonedAdd && !livingSummoner(ctx, inst, mob)) {
    ctx.handleDeath(mob, null);
    return -1;
  }
  const left = (st.timers[STOKE_TIMER] ?? def.every) - DT;
  if (left > 1e-9) {
    st.timers[STOKE_TIMER] = left;
    return 0;
  }
  st.timers[STOKE_TIMER] = def.every;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  let n = 0;
  for (const ally of fightingAllies(ctx, inst, mob, def.radius)) {
    if (ally.id === mob.id) continue;
    const existing = ally.auras.find((a) => a.id === SANCTUM_STOKED);
    if (existing) {
      existing.remaining = def.seconds;
    } else {
      ctx.applyAura(ally, {
        id: SANCTUM_STOKED,
        name: def.name,
        kind: 'buff_haste',
        remaining: def.seconds,
        duration: def.seconds,
        value: 1 + def.hastePct,
        sourceId: mob.id,
        school: def.school,
      });
    }
    n++;
  }
  return n;
}
