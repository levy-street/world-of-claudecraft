// G5, the trash engine's walker (TrashKitDef.walker): an orb that leaves a mob
// (at its death, or when a bar lands) and drifts at `speed` toward the
// nearest living ally of the claim in the fight, re-aiming every tick, and
// EMPOWERS that ally when it comes within `reachRadius` (a damage-done aura).
// A player who stands in its way intercepts it: the first living player
// within `interceptRadius` of the orb takes it instead (a roll of damage,
// and the empower turned on them when `grantsEmpower`), the body-block answer
// that turns the enemy's buff into the group's. An orb with no ally left, or
// out of time, fades. The orb is an encounter object the client mirrors
// (Entity.kitObject kind 'walker'), so it is drawn where the sim has it.
//
// A def may narrow who it rolls to (`allies`), wait in place for a taker when
// nobody is left to roll to (`lingers`), shield its ally instead of (or as
// well as) arming it (`empower.shieldPct`), arm it harder on heroic only
// (`empower.heroicDamagePct`), and turn an interception into a gift for the
// taker's whole group (`intercept.groupShield`).
//
// The orb flies over the floor (a spirit, a pearl, a mote): it follows the
// ground height but no collider stops it, so only a body can. Zero rng in
// every pick (allies nearest-first with ties to the lower id, players in
// entity-id order); the only draw is the interception's damage roll.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type KitWalkerDef } from '../../types';
import { dropKitObject, spawnKitObject } from './kit_objects';

/** The spellfx ability ids of a walker's beats (the renderer's keys; the
 *  def's castId names the launch). */
export const WALKER_EMPOWER = 'trash_walker_empower';
export const WALKER_INTERCEPT = 'trash_walker_intercept';
export const WALKER_FADE = 'trash_walker_fade';
/** Seconds an orb flies before a body can take it. */
export const WALKER_ARM_SECONDS = 0.5;

/** The nearest living mob of the claim in the fight to (x, z), never `skip`
 *  (the mob that sent it), and only of `allies` when given. Ties go to the
 *  lower id. */
export function pickWalkerAlly(
  ctx: SimContext,
  inst: InstanceSlot,
  at: { x: number; z: number },
  skip: number,
  allies?: readonly string[],
): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  const p = { x: at.x, y: 0, z: at.z };
  for (const id of inst.mobIds) {
    if (id === skip) continue;
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob' || !e.inCombat) continue;
    if (allies && !allies.includes(e.templateId)) continue;
    const d = dist2d(e.pos, p);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** The def an orb carries on this difficulty: a heroic-only arming swaps in. */
export function walkerDefFor(def: KitWalkerDef, heroic: boolean): KitWalkerDef {
  const pct = def.empower.heroicDamagePct;
  if (!heroic || pct === undefined) return def;
  return { ...def, empower: { ...def.empower, damagePct: pct } };
}

/** Where an orb leaves its mob: on the mob, or `eject` yards out on the side
 *  away from the one it fights (its facing reversed when it fights nobody). */
export function walkerLaunchPoint(
  ctx: SimContext,
  mob: Entity,
  def: KitWalkerDef,
): { x: number; z: number } {
  const out = def.eject ?? 0;
  if (out <= 0) return { x: mob.pos.x, z: mob.pos.z };
  const foe = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : undefined;
  let dx = -Math.sin(mob.facing);
  let dz = -Math.cos(mob.facing);
  if (foe && dist2d(foe.pos, mob.pos) > 1e-3) {
    const d = dist2d(foe.pos, mob.pos);
    dx = (mob.pos.x - foe.pos.x) / d;
    dz = (mob.pos.z - foe.pos.z) / d;
  }
  return { x: mob.pos.x + dx * out, z: mob.pos.z + dz * out };
}

/** Launch an orb from `mob` toward its nearest fighting ally. Returns the orb,
 *  or null when no ally is left to empower (and the def does not linger). */
export function launchWalker(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  base: KitWalkerDef,
): Entity | null {
  const def = walkerDefFor(base, inst.difficulty === 'heroic');
  const ally = pickWalkerAlly(ctx, inst, mob.pos, mob.id, def.allies);
  if (!ally && !def.lingers) return null;
  const at = walkerLaunchPoint(ctx, mob, def);
  const orb = spawnKitObject(ctx, inst, def.objectTemplate, def.name, at.x, at.z, 1, 0, {
    kind: 'walker',
    def,
    sourceId: mob.id,
    allyId: ally?.id ?? null,
    remaining: def.maxSeconds,
    mechanicDamageMult: mob.mechanicDamageMult ?? 1,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: orb.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  return orb;
}

function empower(ctx: SimContext, def: KitWalkerDef, sourceId: number, onto: Entity): void {
  const shield = def.empower.shieldPct ?? 0;
  if (shield > 0 && !onto.dead) {
    ctx.applyAura(onto, {
      id: def.empower.auraId,
      name: def.empower.name,
      kind: 'absorb',
      remaining: def.empower.seconds,
      duration: def.empower.seconds,
      value: Math.max(1, Math.round(onto.maxHp * shield)),
      sourceId,
      school: def.school,
    });
  }
  const heal = def.empower.healPct ?? 0;
  if (heal > 0 && !onto.dead) {
    // The heal rides the shared heal path (the kit mend's), from the orb.
    const orb = ctx.entities.get(sourceId);
    if (orb) ctx.applyHeal(orb, onto, Math.round(onto.maxHp * heal), def.name, def.castId, false);
  }
  if (def.empower.damagePct <= 0) return;
  // A stacking arming (empower.maxStacks) adds one to what the ally carries.
  const cap = def.empower.maxStacks ?? 0;
  const had = cap > 0 ? onto.auras.find((a) => a.id === def.empower.auraId) : undefined;
  const stacks = cap > 0 ? Math.min(cap, (had?.stacks ?? 0) + 1) : undefined;
  if (had) onto.auras = onto.auras.filter((a) => a !== had);
  ctx.applyAura(onto, {
    id: def.empower.auraId,
    name: def.empower.name,
    kind: 'buff_dmg_done',
    remaining: def.empower.seconds,
    duration: def.empower.seconds,
    value: def.empower.damagePct * (stacks ?? 1),
    ...(stacks !== undefined ? { stacks } : {}),
    sourceId,
    school: def.school,
  });
}

/**
 * One tick of an orb: intercepted by a player in its way, else drift toward
 * its ally and empower it on arrival, else fade. Returns what happened.
 */
export function stepWalker(
  ctx: SimContext,
  inst: InstanceSlot,
  orb: Entity,
  players: readonly Entity[],
): 'drift' | 'intercepted' | 'empowered' | 'faded' {
  const st = orb.kitObject;
  if (st?.kind !== 'walker') return 'faded';
  const def = st.def;
  // A body in its way takes it first (players in entity-id order), once the
  // orb has cleared the body it left (the melee round a corpse never eats it
  // on its first tick by standing there).
  let blocker: Entity | null = null;
  if (def.maxSeconds - st.remaining >= WALKER_ARM_SECONDS) {
    for (const p of players) {
      if (p.dead || dist2d(p.pos, orb.pos) > def.interceptRadius) continue;
      if (!blocker || p.id < blocker.id) blocker = p;
    }
  }
  if (blocker) {
    ctx.emit({
      type: 'spellfx',
      sourceId: orb.id,
      targetId: blocker.id,
      school: def.school,
      fx: 'nova',
      ability: WALKER_INTERCEPT,
    });
    if (def.intercept.max > 0) {
      const amount = Math.max(
        1,
        Math.round(ctx.rng.range(def.intercept.min, def.intercept.max) * st.mechanicDamageMult),
      );
      const source = ctx.entities.get(st.sourceId) ?? orb;
      ctx.dealDamage(source, blocker, amount, false, def.school, def.name, 'hit', true);
    }
    if (def.intercept.grantsEmpower && !blocker.dead) empower(ctx, def, orb.id, blocker);
    const gift = def.intercept.groupShield;
    if (gift && !blocker.dead) {
      // The taker's group: every living player in reach of them, id order.
      for (const p of players) {
        if (p.dead || p.hp <= 0 || dist2d(p.pos, blocker.pos) > gift.radius) continue;
        ctx.applyAura(p, {
          id: gift.auraId,
          name: gift.name,
          kind: 'absorb',
          remaining: gift.seconds,
          duration: gift.seconds,
          value: Math.max(1, Math.round(p.maxHp * gift.pctMaxHp)),
          sourceId: orb.id,
          school: def.school,
        });
      }
    }
    dropKitObject(ctx, inst, orb.id);
    return 'intercepted';
  }
  st.remaining -= DT;
  let ally = st.allyId !== null ? ctx.entities.get(st.allyId) : undefined;
  if (!ally || ally.dead || ally.hp <= 0) {
    ally = pickWalkerAlly(ctx, inst, orb.pos, st.sourceId, def.allies) ?? undefined;
    st.allyId = ally?.id ?? null;
  }
  // A lingering orb with nobody to roll to waits where it lies for a taker.
  if (!ally && def.lingers && st.remaining > 1e-9) return 'drift';
  if (!ally || st.remaining <= 1e-9) {
    // Anchored at a world point: the orb is gone when the frame is routed.
    ctx.emit({
      type: 'spellfxAt',
      x: orb.pos.x,
      z: orb.pos.z,
      school: def.school,
      fx: 'burst',
      ability: WALKER_FADE,
    });
    dropKitObject(ctx, inst, orb.id);
    return 'faded';
  }
  const d = dist2d(orb.pos, ally.pos);
  if (d <= def.reachRadius) {
    ctx.emit({
      type: 'spellfx',
      sourceId: orb.id,
      targetId: ally.id,
      school: def.school,
      fx: 'nova',
      ability: WALKER_EMPOWER,
    });
    empower(ctx, def, orb.id, ally);
    dropKitObject(ctx, inst, orb.id);
    return 'empowered';
  }
  const step = Math.min(d, def.speed * DT);
  orb.prevPos.x = orb.pos.x;
  orb.prevPos.y = orb.pos.y;
  orb.prevPos.z = orb.pos.z;
  orb.pos.x += ((ally.pos.x - orb.pos.x) / d) * step;
  orb.pos.z += ((ally.pos.z - orb.pos.z) / d) * step;
  orb.pos.y = ctx.groundPos(orb.pos.x, orb.pos.z).y;
  orb.facing = Math.atan2(ally.pos.x - orb.pos.x, ally.pos.z - orb.pos.z);
  ctx.rebucket(orb);
  return 'drift';
}
