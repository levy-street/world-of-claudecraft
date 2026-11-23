// Zulgar's Hunting Spear (the plain phases of his fight, zulgar.ts): between
// hunts he pins a player to the terrace, and the group pulls them free.
//
//   The throw   a 1.5 s bar at a non-tank (the tank only when nobody else
//               stands on the terrace); as it ends the spear drives into the
//               floor beside its victim, on the side it came from.
//   Pinned      the victim is rooted (nothing a player has takes it off) and
//               bleeds 15 every second. A Wildheart Pulse strikes a Pinned
//               player wherever they stand, for half as much again.
//   Pulling it  the spear is a usable body (the trash engine's G3 use): a
//               teammate targets it and presses interact, a 1.5 s use from
//               within 4 yd that a hit does not break. While nobody else
//               stands free on the terrace the victim wrenches it out
//               themself: their own interact press, 3 s.
//   The end     pulled, or 10 s after it landed, or its victim dead or gone;
//               and a hunt beginning pulls every spear out (no Prey is ever
//               rooted when the avatar comes).
//
// Cheese-proof by construction: the press is the ordinary interact command
// (sim.interact claims a Pinned player's press here; a teammate's goes
// through the engine's use), every check runs on the authoritative sim, and
// the engine re-validates reach and the body every tick and at the end. Zero
// rng: the victim is hashed (pickMarkTargets) and the bleed is a fixed amount.
// Every visible state rides existing fields: his bar and its `castTargetId`,
// the spear body, the Pinned aura (`sourceId` the spear, `value2` 1 while the
// victim may free themself), the users' bars and three `spellfx`.

import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { emitMobYell } from '../../mob/yells';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type ZulgarFightState, type ZulgarSpearState } from '../../types';
import { claimPlayers, dropAuraById, dropEncounterBody, pickMarkTargets, startBar } from './claim';
import {
  HUNTING_SPEAR_ID,
  HUNTING_SPEAR_PULL_CAST,
  ZULGAR_TUNING as T,
  ZULGAR_HUNTING_SPEAR,
  ZULGAR_LINES,
  ZULGAR_PINNED,
  ZULGAR_SPEAR_FREED,
  ZULGAR_SPEAR_HELP_ERROR,
} from './ids';
import { auraOf, shrinePlayers } from './zulgar_terrace';

/** The spear that pins this player (its body's id), or null. */
export function pinnedBy(p: Entity): number | null {
  return auraOf(p, ZULGAR_PINNED)?.sourceId ?? null;
}

/** Is this player Pinned by a Hunting Spear? */
export function isPinned(p: Entity): boolean {
  return pinnedBy(p) !== null;
}

/** Start a Hunting Spear's bar at a hashed player of the terrace. Returns
 *  true when it started. */
export function startHuntingSpear(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): boolean {
  if (z.castingAbility !== null || st.phase !== 'fight') return false;
  const players = shrinePlayers(ctx, inst);
  const busy = new Set(st.spears.map((s) => s.victimId));
  const [victim] = pickMarkTargets(z, players, 1, st.casts, busy);
  if (!victim) return false;
  st.casts++;
  st.spearTimer = T.spearEvery;
  st.spearTargetId = victim.id;
  st.plantedAt = { ...z.pos };
  z.facing = Math.atan2(victim.pos.x - z.pos.x, victim.pos.z - z.pos.z);
  startBar(z, ZULGAR_HUNTING_SPEAR, T.spearCast, victim.id);
  emitMobYell(ctx, z, ZULGAR_LINES.spear);
  return true;
}

/** The spear's usable body, standing where it struck (held: never hostile,
 *  nothing can strike it). */
function spawnSpearBody(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  x: number,
  zz: number,
  facing: number,
): Entity | null {
  const template = MOBS[HUNTING_SPEAR_ID];
  if (!template) return null;
  const body = createMob(ctx.nextId++, template, template.minLevel, ctx.groundPos(x, zz));
  body.facing = facing;
  body.prevFacing = facing;
  body.encounterHeld = true;
  body.damageImmune = true;
  body.hostile = false;
  body.summonedAdd = true;
  body.tappedById = z.tappedById;
  ctx.addEntity(body);
  inst.mobIds.push(body.id);
  return body;
}

/** The bar ended: the spear lands and pins the one it was aimed at. Returns
 *  the spear, or null (the victim fell, left, or shrugged the root off). */
export function landHuntingSpear(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): ZulgarSpearState | null {
  const victim = st.spearTargetId !== null ? ctx.entities.get(st.spearTargetId) : undefined;
  st.spearTargetId = null;
  if (!victim || victim.dead || !shrinePlayers(ctx, inst).includes(victim)) return null;
  if (isPinned(victim)) return null;
  // It drives in beside them, on the side it came from, leaning back at him.
  const dx = z.pos.x - victim.pos.x;
  const dz = z.pos.z - victim.pos.z;
  const len = Math.hypot(dx, dz);
  const ux = len > 1e-6 ? dx / len : Math.sin(victim.facing);
  const uz = len > 1e-6 ? dz / len : Math.cos(victim.facing);
  const body = spawnSpearBody(
    ctx,
    inst,
    z,
    victim.pos.x + ux * T.spearStandoff,
    victim.pos.z + uz * T.spearStandoff,
    Math.atan2(ux, uz),
  );
  if (!body) return null;
  ctx.applyAura(victim, {
    id: ZULGAR_PINNED,
    name: 'Pinned',
    kind: 'root',
    // The spear owns the clock (it lets go at pinSeconds); the aura only
    // outlives it by a breath.
    remaining: T.pinSeconds + 0.5,
    duration: T.pinSeconds + 0.5,
    value: 0,
    value2: 0,
    // The spear, not Zulgar: the client finds the spear from this aura.
    sourceId: body.id,
    school: 'physical',
    unbreakableControl: true,
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: z.id,
    targetId: victim.id,
    school: 'physical',
    fx: 'detonate',
    ability: ZULGAR_HUNTING_SPEAR,
  });
  if (pinnedBy(victim) !== body.id) {
    // A guard of theirs kept the root off (a paladin's Veilbound March): the
    // spear glances away.
    dropEncounterBody(ctx, inst, null, body.id);
    return null;
  }
  const spear: ZulgarSpearState = {
    bodyId: body.id,
    victimId: victim.id,
    age: 0,
    bleeds: 0,
    x: victim.pos.x,
    y: victim.pos.y,
    z: victim.pos.z,
  };
  st.spears.push(spear);
  return spear;
}

/** Pull a spear out: its victim walks free and the spear is gone. `by` is
 *  who pulled it (null: it let go on its own). */
export function freeSpear(
  ctx: SimContext,
  inst: InstanceSlot,
  st: ZulgarFightState,
  spear: ZulgarSpearState,
  by: Entity | null,
): void {
  st.spears = st.spears.filter((s) => s !== spear);
  const victim = ctx.entities.get(spear.victimId);
  if (victim) {
    dropAuraById(victim, ZULGAR_PINNED);
    ctx.emit({
      type: 'spellfx',
      sourceId: by?.id ?? victim.id,
      targetId: victim.id,
      school: 'physical',
      fx: 'nova',
      ability: ZULGAR_SPEAR_FREED,
    });
  }
  dropEncounterBody(ctx, inst, null, spear.bodyId);
}

/** Every spear comes out (a hunt begins, the idol wakes, the pull ends). */
export function clearSpears(ctx: SimContext, inst: InstanceSlot, st: ZulgarFightState): void {
  for (const spear of [...st.spears]) freeSpear(ctx, inst, st, spear, null);
  st.spearTargetId = null;
}

/** One tick of the standing spears: a finished pull, the bleed, the hold,
 *  who may free themself, and the end of the pin. */
export function stepSpears(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): void {
  if (st.spears.length === 0) return;
  const present = claimPlayers(ctx, inst);
  const terrace = shrinePlayers(ctx, inst);
  for (const spear of [...st.spears]) {
    const body = ctx.entities.get(spear.bodyId);
    const victim = ctx.entities.get(spear.victimId);
    if (!body || !victim || !present.includes(victim) || pinnedBy(victim) !== spear.bodyId) {
      freeSpear(ctx, inst, st, spear, null);
      continue;
    }
    // A finished use (the engine records who pulled it).
    if (body.kitUseCompletedBy !== undefined) {
      const by = ctx.entities.get(body.kitUseCompletedBy) ?? null;
      body.kitUseCompletedBy = undefined;
      freeSpear(ctx, inst, st, spear, by);
      continue;
    }
    spear.age += DT;
    if (spear.age >= T.pinSeconds - 1e-9) {
      freeSpear(ctx, inst, st, spear, null);
      continue;
    }
    // A shove never drags them off the spear.
    if (Math.hypot(victim.pos.x - spear.x, victim.pos.z - spear.z) > 0.6) {
      victim.pos.x = spear.x;
      victim.pos.y = spear.y;
      victim.pos.z = spear.z;
      ctx.grid.update(victim);
    }
    // Nobody else stands free on the terrace: the victim may wrench it out.
    const mark = auraOf(victim, ZULGAR_PINNED);
    const helper = terrace.some((p) => p.id !== victim.id && !isPinned(p));
    if (mark) mark.value2 = helper ? 0 : 1;
    const due = Math.floor(spear.age / T.pinBleedEvery + 1e-6);
    while (spear.bleeds < due && !victim.dead) {
      spear.bleeds++;
      const amount = Math.max(1, Math.round(T.pinBleed * (z.mechanicDamageMult ?? 1)));
      ctx.dealDamage(z, victim, amount, false, 'physical', 'Hunting Spear', 'hit', true);
    }
  }
}

/**
 * A Pinned player's interact press, claimed from sim.interact before any other
 * interaction. Returns true when the player is Pinned (the press is spent
 * here). With a teammate free to help it only says so; otherwise it starts the
 * victim's own, longer pull on their spear: the engine's use, opened here so it
 * runs `spearWrenchSeconds` (the engine then re-validates it every tick and
 * lands it like any other).
 */
export function trySpearWrench(ctx: SimContext, p: Entity): boolean {
  const mark = auraOf(p, ZULGAR_PINNED);
  if (!mark) return false;
  const body = ctx.entities.get(mark.sourceId);
  if (!body || body.dead || body.templateId !== HUNTING_SPEAR_ID) return true;
  if (p.castingAbility === HUNTING_SPEAR_PULL_CAST) return true;
  if (mark.value2 !== 1) {
    ctx.error(p.id, ZULGAR_SPEAR_HELP_ERROR);
    return true;
  }
  if (p.dead || p.castingAbility !== null || ctx.isStunned(p)) {
    ctx.error(p.id, 'You are busy.');
    return true;
  }
  if (dist2d(p.pos, body.pos) > T.spearPullRange) return true;
  p.castingAbility = HUNTING_SPEAR_PULL_CAST;
  p.castTotal = T.spearWrenchSeconds;
  p.castRemaining = T.spearWrenchSeconds;
  p.castTargetId = body.id;
  p.channeling = false;
  p.castAim = null;
  ctx.emit({
    type: 'spellfx',
    sourceId: p.id,
    targetId: body.id,
    school: 'physical',
    fx: 'windup',
    ability: HUNTING_SPEAR_PULL_CAST,
  });
  return true;
}

/** `/dev wildheart trigger pin`: a spear lands on a hashed player at once
 *  (no bar). Returns the victim, or null. */
export function devPinNow(
  ctx: SimContext,
  inst: InstanceSlot,
  z: Entity,
  st: ZulgarFightState,
): Entity | null {
  const busy = new Set(st.spears.map((s) => s.victimId));
  const [victim] = pickMarkTargets(z, shrinePlayers(ctx, inst), 1, st.casts, busy);
  if (!victim) return null;
  st.casts++;
  st.spearTargetId = victim.id;
  return landHuntingSpear(ctx, inst, z, st) ? victim : null;
}
