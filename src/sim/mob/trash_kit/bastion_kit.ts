// The trash kit's Sunken Bastion mechanics pass (MobTemplate.trashKit hook,
// wall, fallBack, gorge, fogBank, column, unshackle). A sibling of driver.ts,
// which routes these keys here. The Bastion is a garrison: its dead fight as
// soldiers (formation, orders, a hook that drags you into the line).
//
//   hook       the Drowned Watchman's telegraphed boathook down a lane at a far
//              player: whoever stands in it is hit, and the farthest one caught
//              is dragged to the watchman's feet (heroic: right into its sweep).
//              Physical: step aside.
//   wall       heroic: two watchmen side by side take less damage. Split them.
//   fallBack   the Fogbound Arbalest leaps back from a melee; a stun, a root or
//              a slow holds it.
//   gorge      a Barnacle Crawler beside a corpse feeds; every stack grows the
//              Brine Burst it bursts in (death_burst.ts perStack).
//   fogBank    the Mist Chanter's interruptible cast: a fog patch under its foe
//              in which its allies take less damage. Drag them out, or kick it.
//   column     the Tidebound Acolyte's interruptible channel: a column of sea
//              water roots one player and drowns them while it runs.
//   unshackle  a Shackled Prisoner low on health breaks its chains and stops
//              fighting: it kneels, untouchable, and leaves the fight.
//
// Zero rng in every pick (players by distance or by the kit's hash, allies in
// roster order); the only draws are damage rolls, in entity-id order.

import { createGroundObject } from '../../entity';
import { pullToward } from '../../pull_toward';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { clearThreat } from '../../threat';
import { DT, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import {
  BASTION_CARRION_GLUT,
  BASTION_FALL_BACK,
  BASTION_FETTERS_RELEASE,
  BASTION_FOG_BANK_CLOUD,
  BASTION_FOG_SHROUD,
  BASTION_HALBERD_WALL,
  BASTION_SNAPPED_FETTERS,
} from './bastion_cast_ids';
import { inLane } from './lane';
import { kitHash, livingInReach } from './targets';

function heroic(inst: InstanceSlot): boolean {
  return inst.difficulty === 'heroic';
}

function roll(ctx: SimContext, mob: Entity, min: number, max: number): number {
  return Math.max(1, Math.round(ctx.rng.range(min, max) * (mob.mechanicDamageMult ?? 1)));
}

function dropObject(ctx: SimContext, inst: InstanceSlot, id: number | null | undefined): void {
  if (id === null || id === undefined) return;
  const at = inst.objectIds.indexOf(id);
  if (at >= 0) inst.objectIds.splice(at, 1);
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

function groundY(ctx: SimContext, x: number, z: number): number {
  return ctx.groundPos(x, z).y;
}

/** Refresh a short self-expiring ward aura (a held zone or a formation): a
 *  first application announces it, a refresh only resets its clock. */
function holdWard(
  ctx: SimContext,
  target: Entity,
  id: string,
  name: string,
  value: number,
  source: Entity,
  seconds: number,
): void {
  const existing = target.auras.find((a) => a.id === id);
  if (existing) {
    existing.remaining = seconds;
    existing.value = value;
    return;
  }
  ctx.applyAura(target, {
    id,
    name,
    kind: 'shield_wall',
    remaining: seconds,
    duration: seconds,
    value,
    sourceId: source.id,
    school: 'frost',
  });
}

/** How long a held ward lingers after its zone or partner is gone. */
const WARD_LINGER = 0.5;

// ---- Boathook -----------------------------------------------------------------------

/** The hook's victim: the farthest living player between `minRange` and the
 *  lane's length (ties to the lower id), or null. */
export function pickHookTarget(
  players: readonly Entity[],
  mob: Entity,
  kit: TrashKitDef,
): Entity | null {
  const def = kit.hook;
  if (!def) return null;
  let best: Entity | null = null;
  let bestD = -1;
  for (const p of livingInReach(players, mob.pos, def.length)) {
    const d = dist2d(p.pos, mob.pos);
    if (d < def.minRange) continue;
    if (d > bestD + 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** The hook's bar ran out: everyone in the lane is struck, and the farthest
 *  one caught is dragged in. Returns the caught player, or null. */
export function landHook(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.hook;
  if (!def) return null;
  const yaw = st.aim ?? mob.facing;
  st.aim = undefined;
  let caught: Entity | null = null;
  let caughtD = -1;
  const struck: Entity[] = [];
  for (const p of livingInReach(players, mob.pos, def.length + def.halfWidth)) {
    if (!inLane(mob.pos.x, mob.pos.z, yaw, def.length, def.halfWidth, p.pos.x, p.pos.z)) continue;
    struck.push(p);
    const d = dist2d(p.pos, mob.pos);
    if (d > caughtD + 1e-9) {
      caught = p;
      caughtD = d;
    }
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: caught?.id ?? mob.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: def.castId,
  });
  for (const p of struck) {
    ctx.dealDamage(
      mob,
      p,
      roll(ctx, mob, def.min, def.max),
      false,
      def.school,
      def.name,
      'hit',
      true,
    );
  }
  if (caught && !caught.dead) {
    st.hook = { victimId: caught.id, remaining: def.pullSeconds };
    // Heroic: the sweep follows the drag (turn the watchman away from them).
    if (heroic(inst)) mob.breathTimer = Math.min(mob.breathTimer ?? Infinity, def.heroicSweepIn);
  }
  return caught;
}

/** Drag the caught player toward the watchman's feet over the pull. */
function stepHookDrag(ctx: SimContext, mob: Entity, kit: TrashKitDef, st: TrashKitState): void {
  const def = kit.hook;
  const h = st.hook;
  if (!def || !h) return;
  const victim = ctx.entities.get(h.victimId);
  if (!victim || victim.dead) {
    st.hook = undefined;
    return;
  }
  const x = mob.pos.x + Math.sin(mob.facing) * def.stop;
  const z = mob.pos.z + Math.cos(mob.facing) * def.stop;
  const left = Math.hypot(x - victim.pos.x, z - victim.pos.z);
  const step = (left / Math.max(DT, h.remaining)) * DT;
  pullToward(ctx, victim, x, z, Math.max(step, 0.2), 0.3);
  h.remaining -= DT;
  if (h.remaining <= 1e-9 || left < 0.5) st.hook = undefined;
}

// ---- Halberd Wall ---------------------------------------------------------------------

/** Heroic: a watchman with a partner of its own template beside it in the
 *  fight holds the wall. Returns true while it holds. */
export function stepWall(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
): boolean {
  const def = kit.wall;
  if (!def || !heroic(inst)) return false;
  for (const id of inst.mobIds) {
    if (id === mob.id) continue;
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.templateId !== mob.templateId || !e.inCombat) continue;
    if (dist2d(e.pos, mob.pos) > def.radius) continue;
    holdWard(ctx, mob, BASTION_HALBERD_WALL, def.name, def.reduction, mob, WARD_LINGER);
    return true;
  }
  return false;
}

// ---- Fall Back --------------------------------------------------------------------------

/** How high the leap back arcs. */
const FALL_ARC = 1.6;
/** The leap back never changes floors: a landing more than this above or below
 *  is refused (an arbalest never leaps off its battlement). */
const FALL_MAX_STEP = 1.5;

function heldInPlace(ctx: SimContext, mob: Entity): boolean {
  if (ctx.isStunned(mob) || ctx.isRooted(mob)) return true;
  return mob.auras.some((a) => a.kind === 'slow' && a.value < 1 && a.sourceId !== mob.id);
}

/** The spot a leap back lands on: straight away from `from`, the full
 *  distance or a shorter one, never through a wall or off its floor. */
export function fallBackSpot(
  ctx: SimContext,
  mob: Entity,
  from: Entity,
  distance: number,
): { x: number; z: number } | null {
  let dx = mob.pos.x - from.pos.x;
  let dz = mob.pos.z - from.pos.z;
  let len = Math.hypot(dx, dz);
  if (len < 1e-4) {
    dx = -Math.sin(mob.facing);
    dz = -Math.cos(mob.facing);
    len = 1;
  }
  const ux = dx / len;
  const uz = dz / len;
  const floor = groundY(ctx, mob.pos.x, mob.pos.z);
  for (const k of [1, 0.75, 0.5]) {
    const tx = mob.pos.x + ux * distance * k;
    const tz = mob.pos.z + uz * distance * k;
    const r = ctx.resolveMove(mob.pos.x, mob.pos.z, tx, tz, 0.6, mob);
    if (Math.hypot(r.x - tx, r.z - tz) > 0.5) continue;
    if (Math.abs(groundY(ctx, tx, tz) - floor) > FALL_MAX_STEP) continue;
    return { x: tx, z: tz };
  }
  return null;
}

/** The arbalest's leap back: start one when a player closes, fly it. Returns
 *  true while the leap owns the mob's position. */
export function stepFallBack(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): boolean {
  const def = kit.fallBack;
  if (!def) return false;
  if (st.fall) {
    const f = st.fall;
    // A stun or a root mid-leap cuts it short: it drops where it is.
    if (ctx.isStunned(mob) || ctx.isRooted(mob)) {
      mob.pos.y = groundY(ctx, mob.pos.x, mob.pos.z);
      st.fall = undefined;
      ctx.rebucket(mob);
      return false;
    }
    f.t += DT;
    const k = Math.min(1, f.t / def.seconds);
    mob.pos.x = f.fromX + (f.toX - f.fromX) * k;
    mob.pos.z = f.fromZ + (f.toZ - f.fromZ) * k;
    const floor = groundY(ctx, mob.pos.x, mob.pos.z);
    mob.pos.y = f.fromY + (floor - f.fromY) * k + Math.sin(Math.PI * k) * FALL_ARC;
    if (k >= 1) {
      mob.pos.y = floor;
      st.fall = undefined;
    }
    ctx.rebucket(mob);
    return true;
  }
  st.timers.fallBack = (st.timers.fallBack ?? def.first) - DT;
  if (st.timers.fallBack > 0 || mob.castingAbility !== null || st.descent || st.leap) return false;
  if (heldInPlace(ctx, mob)) return false;
  const close = livingInReach(players, mob.pos, def.trigger);
  if (close.length === 0) return false;
  let near = close[0];
  for (const p of close) if (dist2d(p.pos, mob.pos) < dist2d(near.pos, mob.pos) - 1e-9) near = p;
  const spot = fallBackSpot(ctx, mob, near, def.distance);
  if (!spot) return false;
  st.timers.fallBack = def.every;
  st.fall = {
    fromX: mob.pos.x,
    fromZ: mob.pos.z,
    fromY: mob.pos.y,
    toX: spot.x,
    toZ: spot.z,
    t: 0,
  };
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: near.id,
    school: 'physical',
    fx: 'windup',
    ability: BASTION_FALL_BACK,
  });
  return true;
}

// ---- Carrion Glut ------------------------------------------------------------------------------

/** A crawler beside a corpse feeds on it: a stack on the clock, up to its cap.
 *  Returns the stacks it holds. */
export function stepGorge(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): number {
  const def = kit.gorge;
  if (!def) return 0;
  mob.trashLife ??= {};
  const life = mob.trashLife;
  // The stacks ride their marker aura: an evade's reset (or anything else
  // that strips it) forgets the feast, so a re-pulled crawler bursts small.
  if ((life.gorge ?? 0) > 0 && !mob.auras.some((a) => a.id === BASTION_CARRION_GLUT))
    life.gorge = 0;
  const stacks = life.gorge ?? 0;
  if (stacks >= def.maxStacks) return stacks;
  let feeding = false;
  for (const id of inst.mobIds) {
    if (id === mob.id) continue;
    const e = ctx.entities.get(id);
    if (e?.kind === 'mob' && e.dead && dist2d(e.pos, mob.pos) <= def.reach) {
      feeding = true;
      break;
    }
  }
  if (!feeding) return stacks;
  st.timers.gorge = (st.timers.gorge ?? def.every) - DT;
  if (st.timers.gorge > 1e-9) return stacks;
  st.timers.gorge = def.every;
  life.gorge = stacks + 1;
  ctx.applyAura(mob, {
    id: BASTION_CARRION_GLUT,
    name: def.name,
    // A marker: the burst it grows is the mechanic, not a ward.
    kind: 'buff_dr',
    remaining: 3600,
    duration: 3600,
    value: 0,
    stacks: life.gorge,
    sourceId: mob.id,
    school: 'nature',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'nature',
    fx: 'selfCast',
    ability: BASTION_CARRION_GLUT,
  });
  return life.gorge;
}

// ---- Fog Bank ------------------------------------------------------------------------------

/** The fog's spot: under the chanter's own foe, when one stands in reach and
 *  no bank of its own already lies. */
export function pickFogTarget(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): Entity | null {
  const def = kit.fogBank;
  if (!def || st.fog) return null;
  const foe = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : undefined;
  if (!foe || foe.dead || dist2d(foe.pos, mob.pos) > def.range) return null;
  return foe;
}

/** The fog's bar started: its spot locks under the foe. */
export function lockFog(st: TrashKitState, target: Entity | null): void {
  if (!target) return;
  st.fog = { x: target.pos.x, z: target.pos.z, remaining: 0, objectId: null, laid: false };
}

/** The fog's bar ran out: the patch settles where it was aimed. */
export function landFog(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): boolean {
  const def = kit.fogBank;
  const fog = st.fog;
  if (!def || !fog) return false;
  const obj = createGroundObject(ctx.nextId++, '', def.name, ctx.groundPos(fog.x, fog.z));
  obj.templateId = BASTION_FOG_BANK_CLOUD;
  obj.dungeonId = inst.dungeonId;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = 0;
  obj.prevFacing = 0;
  obj.scale = def.radius;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  fog.objectId = obj.id;
  fog.laid = true;
  fog.remaining = def.seconds;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: obj.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  return true;
}

/** A fog bank that never settled (its bar broke): forget its spot. */
export function dropUnlaidFog(st: TrashKitState): void {
  if (st.fog && !st.fog.laid) st.fog = undefined;
}

/** The standing fog: shroud every ally in the fight inside it, then lift.
 *  Returns how many it shrouded this tick. */
function stepFog(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): number {
  const def = kit.fogBank;
  const fog = st.fog;
  if (!def || !fog?.laid) return 0;
  const reduction = heroic(inst) ? def.heroicReduction : def.reduction;
  let n = 0;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob' || !e.inCombat) continue;
    if (Math.hypot(e.pos.x - fog.x, e.pos.z - fog.z) > def.radius) continue;
    holdWard(ctx, e, BASTION_FOG_SHROUD, def.name, reduction, mob, WARD_LINGER);
    n++;
  }
  fog.remaining -= DT;
  if (fog.remaining <= 1e-9) {
    dropObject(ctx, inst, fog.objectId);
    st.fog = undefined;
  }
  return n;
}

// ---- Brine Column -------------------------------------------------------------------------

/** The column's victim: a hashed pick among the living players in reach,
 *  leaving out the acolyte's own foe unless nobody else is there. */
export function pickColumnTarget(
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.column;
  if (!def) return null;
  const inReach = livingInReach(players, mob.pos, def.range);
  if (inReach.length === 0) return null;
  const others = inReach.filter((p) => p.id !== mob.aggroTargetId);
  const pool = others.length > 0 ? others : inReach;
  return pool[kitHash(mob.id, st.casts) % pool.length];
}

/** The column's channel started: root its victim for the whole bar. */
export function lockColumn(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  target: Entity | null,
): void {
  const def = kit.column;
  if (!def || !target) return;
  mob.channeling = true;
  st.column = { victimId: target.id, tick: def.tick };
  const mult = mob.mechanicDamageMult ?? 1;
  ctx.applyAura(target, {
    id: def.castId,
    name: def.name,
    kind: 'root',
    remaining: def.castTime,
    duration: def.castTime,
    value: 0,
    // The drowning roll the channel ticks (its tooltip reads them).
    value2: Math.max(1, Math.round(def.min * mult)),
    value3: Math.max(1, Math.round(def.max * mult)),
    sourceId: mob.id,
    school: def.school,
  });
}

function drownTick(ctx: SimContext, mob: Entity, kit: TrashKitDef, victim: Entity): void {
  const def = kit.column;
  if (!def || victim.dead) return;
  ctx.dealDamage(
    mob,
    victim,
    roll(ctx, mob, def.min, def.max),
    false,
    def.school,
    def.name,
    'hit',
    true,
  );
}

/** One running tick of the column's channel (after its bar counted down):
 *  the victim drowns on the clock. The last tick lands with the bar. */
export function stepColumnChannel(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): void {
  const def = kit.column;
  const col = st.column;
  if (!def || !col || mob.castRemaining <= 1e-9) return;
  col.tick -= DT;
  if (col.tick > 1e-9) return;
  col.tick += def.tick;
  const victim = ctx.entities.get(col.victimId);
  if (victim) drownTick(ctx, mob, kit, victim);
}

/** The column ends (its bar ran out, or it broke): the last tick when it
 *  ran out, and the victim's root lifts either way. */
export function endColumn(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  landed: boolean,
): void {
  const def = kit.column;
  const col = st.column;
  st.column = undefined;
  if (!def || !col) return;
  const victim = ctx.entities.get(col.victimId);
  if (!victim) return;
  if (landed) {
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: victim.id,
      school: def.school,
      fx: 'nova',
      ability: def.castId,
    });
    drownTick(ctx, mob, kit, victim);
  }
  const before = victim.auras.length;
  victim.auras = victim.auras.filter((a) => !(a.id === def.castId && a.sourceId === mob.id));
  if (victim.auras.length !== before)
    ctx.emit({
      type: 'aura',
      targetId: victim.id,
      name: def.name,
      gained: false,
      sourceId: mob.id,
      abilityId: def.castId,
    });
}

// ---- Snapped Fetters -----------------------------------------------------------------------------

/**
 * A prisoner's chains: under its health share it is freed (inert, untouchable,
 * no longer hostile, out of the fight) and kneels; when its time is up it
 * leaves the world. Returns true while the prisoner is freed (the caller
 * stops: a freed prisoner has no kit).
 */
export function stepUnshackle(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef | undefined,
): boolean {
  const def = kit?.unshackle;
  if (!def || mob.dead) return false;
  mob.trashLife ??= {};
  const life = mob.trashLife;
  if (life.freed !== undefined) {
    life.freed -= DT;
    if (life.freed > 1e-9) return true;
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school: 'nature',
      fx: 'nova',
      ability: BASTION_FETTERS_RELEASE,
    });
    for (const id of inst.mobIds) {
      const e = ctx.entities.get(id);
      if (e?.summonedIds.includes(mob.id))
        e.summonedIds = e.summonedIds.filter((s) => s !== mob.id);
    }
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === mob.id) e.targetId = null;
    }
    ctx.dropEntity(mob.id);
    return true;
  }
  // The template's damage floor holds it at this share (MobTemplate.damageFloorPct),
  // so a burst can never skip the release: read the same rounded line.
  if (mob.maxHp <= 0 || mob.hp > Math.ceil(mob.maxHp * def.belowHpPct) || !mob.inCombat)
    return false;
  life.freed = def.seconds;
  if (mob.castingAbility !== null) {
    mob.castingAbility = null;
    mob.castRemaining = 0;
    mob.castTotal = 0;
    mob.castTargetId = null;
    mob.channeling = false;
  }
  mob.trashKit = undefined;
  mob.castHold = undefined;
  // The encounter hold's inert stance (mob/locomotion.ts): the mob AI leaves
  // it be, never hostile, until it leaves.
  mob.encounterHeld = true;
  mob.damageImmune = true;
  mob.hostile = false;
  mob.inCombat = false;
  mob.aggroTargetId = null;
  mob.forcedTargetId = null;
  mob.forcedTargetTimer = 0;
  mob.aiState = 'idle';
  clearThreat(mob);
  ctx.applyAura(mob, {
    id: BASTION_SNAPPED_FETTERS,
    name: def.name,
    kind: 'buff_dr',
    remaining: def.seconds,
    duration: def.seconds,
    value: 0,
    sourceId: mob.id,
    school: 'nature',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'nature',
    fx: 'nova',
    ability: BASTION_SNAPPED_FETTERS,
  });
  return true;
}

// ---- The pass --------------------------------------------------------------------------------

/** One engaged tick of the Bastion pieces that run beside the casts. Returns
 *  true while a leap back owns the mob's position (the caller stops). */
export function stepBastionKit(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): boolean {
  stepWall(ctx, inst, mob, kit);
  stepGorge(ctx, inst, mob, kit, st);
  stepFog(ctx, inst, mob, kit, st);
  stepHookDrag(ctx, mob, kit, st);
  return stepFallBack(ctx, mob, kit, st, players);
}

/** The pull ended: lift the fog, free the drowning victim, end the drag. */
export function endBastionPull(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef | undefined,
): void {
  const st = mob.trashKit;
  if (!st) return;
  if (st.fog) {
    dropObject(ctx, inst, st.fog.objectId);
    st.fog = undefined;
  }
  if (kit) endColumn(ctx, mob, kit, st, false);
  st.hook = undefined;
  st.fall = undefined;
}
