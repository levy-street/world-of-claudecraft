// The trash kit's Hollow Crypt mechanics pass (MobTemplate.trashKit
// reassemble, bonePile, rupture, granite, eye, scorch; the leap's heroic
// releap; MobTemplate.deathThroes.shrapnel). A sibling of driver.ts, which
// routes these keys here. The crypt's one idea of a group: the necromancers
// rule the bones, so the first lesson of a modern pull is kill the one that
// makes the others strong.
//
//   reassemble  an Ossuary Warrior that falls while its pack's necromancer
//               lives leaves a pile of bones (a mob) where it fell; break the
//               pile, or kill the necromancer, or the warrior stands again
//               with part of its health. A risen body pays nothing twice.
//   rupture     the necromancer's interruptible cast: the fallen packmate's
//               corpse nearest its foe is marked with a ring and bursts when
//               the bar ends (heroic: it leaves a pool burning). Kick it, or
//               do not fight on the dead.
//   shrapnel    a Bone Minion's burst also cuts the skeletons round it
//               (its hook lives in crypt_hooks.ts, called by the lifecycle).
//   granite     the Chapel Gargoyle's stone thickens every few seconds (less
//               damage taken); a stun shatters it and leaves it cracked.
//   eye         the Crow Caller's interruptible mark: every crow in the fight
//               hunts the marked player for a few seconds.
//   scorch      heroic: the Ossuary Drake's breath leaves its ghost fire
//               burning on the floor.
//   releap      heroic: a Cutthroat nobody answers (a taunt, a stun, a root or
//               a slow) leaps again at the next caster.
//
// Zero rng in every pick (corpses by distance then entity id, players by the
// kit's hash); the only draws are damage rolls, in entity-id order.

import { MOBS } from '../../data';
import { createGroundObject } from '../../entity';
import { cancelCorpseHarvestForCorpse } from '../../professions/corpse_harvest_session';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import {
  angleTo,
  DT,
  dist2d,
  type Entity,
  type MobTemplate,
  type TrashKitDef,
  type TrashKitState,
} from '../../types';
import {
  CRYPT_BARROW_EMBERS,
  CRYPT_BONES_CRUMBLE,
  CRYPT_CARRION_EYE,
  CRYPT_CRACKED_STONE,
  CRYPT_GRANITE_SKIN,
  CRYPT_REASSEMBLE,
  CRYPT_RUPTURE_POOL,
  CRYPT_RUPTURE_RING,
} from './cast_ids';
import { spawnKitAdd } from './spawn';
import { inCone, kitHash, livingInReach } from './targets';

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

/** A floor object the client mirrors and the crypt visuals draw (scale = its
 *  radius or reach). */
function spawnFloorObject(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
  name: string,
  x: number,
  z: number,
  scale: number,
  facing = 0,
): number {
  const obj = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(x, z));
  obj.templateId = templateId;
  obj.dungeonId = inst.dungeonId;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = facing;
  obj.prevFacing = facing;
  obj.scale = scale;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj.id;
}

/** Take an entity out of the world the way a grown or burst add leaves:
 *  off its summoner's list, off every player's target. */
function removeFromWorld(ctx: SimContext, inst: InstanceSlot, mob: Entity): void {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e?.summonedIds.includes(mob.id)) e.summonedIds = e.summonedIds.filter((s) => s !== mob.id);
  }
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === mob.id) e.targetId = null;
  }
  mob.trashKit = undefined;
  ctx.dropEntity(mob.id);
}

// ---- Reassemble and the bone pile ----------------------------------------------

/** The living master of `body`'s pack still in the fight (a necromancer), or
 *  null. Masters are matched by template and the authored pack id. */
export function livingMaster(
  ctx: SimContext,
  inst: InstanceSlot,
  body: Entity,
  masters: readonly string[],
): Entity | null {
  if (!body.dungeonPackId) return null;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob' || !e.inCombat) continue;
    if (e.dungeonPackId !== body.dungeonPackId || !masters.includes(e.templateId)) continue;
    return e;
  }
  return null;
}

/** The living bone pile lying on `corpseId`, or null. */
function pileOn(ctx: SimContext, inst: InstanceSlot, corpseId: number): Entity | null {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && e.trashLife?.pile?.corpseId === corpseId) return e;
  }
  return null;
}

/**
 * A kit body that has just fallen: judge its fall once. While a master of its
 * pack lives and it has not risen its fill, lay a bone pile where it fell.
 * Returns the pile, or null. A risen body that falls again gets its first
 * life's loot back (it was held while it stood).
 */
export function judgeReassemble(
  ctx: SimContext,
  inst: InstanceSlot,
  body: Entity,
  kit: TrashKitDef,
): Entity | null {
  const def = kit.reassemble;
  if (!def) return null;
  body.trashLife ??= {};
  const life = body.trashLife;
  if (life.judged) return null;
  life.judged = true;
  // A risen body falls: its first life's loot is lootable again.
  if (life.lootHeld) {
    body.lootable = true;
    life.lootHeld = false;
  }
  if (life.ruptured) return null;
  const cap = heroic(inst) ? def.heroicRises : def.rises;
  if ((life.rises ?? 0) >= cap) return null;
  const master = livingMaster(ctx, inst, body, def.masters);
  if (!master) return null;
  const pile = spawnKitAdd(ctx, inst, master, def.pile, body.pos.x, body.pos.z, null);
  if (!pile) return null;
  pile.dungeonPackId = body.dungeonPackId;
  pile.facing = body.facing;
  pile.prevFacing = body.facing;
  pile.trashLife = { pile: { corpseId: body.id, remaining: def.seconds } };
  ctx.emit({
    type: 'spellfx',
    sourceId: pile.id,
    targetId: body.id,
    school: 'shadow',
    fx: 'windup',
    ability: CRYPT_REASSEMBLE,
  });
  return pile;
}

/** Stand a fallen body back up at `share` of its health, back in its master's
 *  fight with the master's hate (the Mere Hydra's regrowth recipe: the body
 *  pays no reward twice; its first loot is held while it stands). */
export function standBodyUp(
  ctx: SimContext,
  body: Entity,
  share: number,
  master: Entity | null,
): void {
  cancelCorpseHarvestForCorpse(ctx, body);
  body.corpseHarvestState = undefined;
  body.trashLife ??= {};
  const life = body.trashLife;
  life.rises = (life.rises ?? 0) + 1;
  life.judged = false;
  life.lootHeld = body.lootable;
  body.lootable = false;
  body.dead = false;
  body.regrown = true;
  body.hp = Math.max(1, Math.round(body.maxHp * share));
  body.auras = [];
  body.castingAbility = null;
  body.castRemaining = 0;
  body.castTotal = 0;
  body.castTargetId = null;
  body.channeling = false;
  body.aiState = 'idle';
  body.aggroTargetId = null;
  body.inCombat = false;
  body.trashKit = undefined;
  body.prevPos = { ...body.pos };
  ctx.rebucket(body);
  const foe =
    master && master.aggroTargetId !== null
      ? (ctx.entities.get(master.aggroTargetId) ?? null)
      : null;
  if (master && foe && !foe.dead) {
    ctx.aggroMob(body, foe, false);
    for (const [id, amount] of master.threat) addThreat(body, id, amount);
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: body.id,
    targetId: body.id,
    school: 'shadow',
    fx: 'nova',
    ability: CRYPT_REASSEMBLE,
  });
}

/** The pile crumbles for good (broken, its master fell, its body is gone). */
function crumble(ctx: SimContext, inst: InstanceSlot, pile: Entity): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: pile.id,
    targetId: pile.id,
    school: 'physical',
    fx: 'nova',
    ability: CRYPT_BONES_CRUMBLE,
  });
  removeFromWorld(ctx, inst, pile);
}

/**
 * A bone pile's tick (alive or dead): it never swings or moves; a broken pile
 * crumbles at once; a pile whose master fell or whose body is gone crumbles;
 * a pile whose countdown ends stands its body up and is gone. Returns true
 * when the mob is a pile (the caller stops: a pile has no other kit).
 */
export function stepBonePile(
  ctx: SimContext,
  inst: InstanceSlot,
  pile: Entity,
  kit: TrashKitDef | undefined,
): boolean {
  if (!kit?.bonePile) return false;
  const state = pile.trashLife?.pile;
  if (pile.dead || !state) {
    crumble(ctx, inst, pile);
    return true;
  }
  pile.swingTimer = Math.max(pile.swingTimer, 1);
  const body = ctx.entities.get(state.corpseId);
  const def = body ? MOBS[body.templateId]?.trashKit?.reassemble : undefined;
  const master = body && def ? livingMaster(ctx, inst, body, def.masters) : null;
  if (!body || !body.dead || !def || !master || body.trashLife?.ruptured) {
    crumble(ctx, inst, pile);
    return true;
  }
  state.remaining -= DT;
  if (state.remaining > 1e-9) return true;
  standBodyUp(ctx, body, heroic(inst) ? def.heroicHpPct : def.hpPct, master);
  removeFromWorld(ctx, inst, pile);
  return true;
}

// ---- Grave Rupture -----------------------------------------------------------------

/** The corpse a Grave Rupture marks: a fallen packmate of the caster within
 *  `range`, not yet burst and with no pile on it, the one nearest the caster's
 *  foe (ties to the lower id). */
export function pickRuptureCorpse(
  ctx: SimContext,
  inst: InstanceSlot,
  caster: Entity,
  range: number,
): Entity | null {
  if (!caster.dungeonPackId) return null;
  const foe = caster.aggroTargetId !== null ? ctx.entities.get(caster.aggroTargetId) : undefined;
  const from = foe && !foe.dead ? foe.pos : caster.pos;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || !e.dead || e.kind !== 'mob' || e.id === caster.id) continue;
    if (e.dungeonPackId !== caster.dungeonPackId || e.trashLife?.ruptured) continue;
    if (dist2d(e.pos, caster.pos) > range) continue;
    if (pileOn(ctx, inst, e.id)) continue;
    const d = dist2d(e.pos, from);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** The rupture's bar started: lock its corpse and paint the ring. */
export function lockRupture(
  ctx: SimContext,
  inst: InstanceSlot,
  kit: TrashKitDef,
  st: TrashKitState,
  corpse: Entity | null,
): void {
  const def = kit.rupture;
  if (!def || !corpse) return;
  const objectId = spawnFloorObject(
    ctx,
    inst,
    CRYPT_RUPTURE_RING,
    def.name,
    corpse.pos.x,
    corpse.pos.z,
    def.radius,
  );
  st.rupture = { corpseId: corpse.id, x: corpse.pos.x, z: corpse.pos.z, objectId };
}

/** A rupture that will never land (its bar broke, its pull ended): lift the ring. */
export function dropRupture(ctx: SimContext, inst: InstanceSlot, st: TrashKitState): void {
  if (!st.rupture) return;
  dropObject(ctx, inst, st.rupture.objectId);
  st.rupture = undefined;
}

/** The bar ran out: the corpse bursts on everyone inside the ring, and on
 *  heroic leaves its pool burning. Returns how many it struck. */
export function landRupture(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): number {
  const def = kit.rupture;
  const spot = st.rupture;
  dropRupture(ctx, inst, st);
  if (!def || !spot) return 0;
  const corpse = ctx.entities.get(spot.corpseId);
  if (corpse) {
    corpse.trashLife ??= {};
    corpse.trashLife.ruptured = true;
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: corpse?.id ?? mob.id,
    targetId: corpse?.id ?? mob.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  let n = 0;
  for (const p of livingInReach(players, { x: spot.x, y: 0, z: spot.z }, def.radius)) {
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
    n++;
  }
  if (heroic(inst)) {
    dropObject(ctx, inst, st.pool?.objectId);
    st.pool = {
      x: spot.x,
      z: spot.z,
      remaining: def.pool.seconds,
      objectId: spawnFloorObject(
        ctx,
        inst,
        CRYPT_RUPTURE_POOL,
        def.name,
        spot.x,
        spot.z,
        def.radius,
      ),
    };
  }
  return n;
}

/** Is a periodic clock of `tick` seconds due this step? `left` is the time
 *  left before the step (counting down from `total`). */
function tickDue(total: number, left: number, tick: number): boolean {
  const before = total - left;
  const after = before + DT;
  return Math.floor((after + 1e-9) / tick) > Math.floor((before + 1e-9) / tick);
}

/** The heroic rupture pool's burn. Returns how many it struck this tick. */
function stepRupturePool(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): number {
  const def = kit.rupture;
  const pool = st.pool;
  if (!def || !pool) return 0;
  let n = 0;
  if (tickDue(def.pool.seconds, pool.remaining, def.pool.tick)) {
    for (const p of livingInReach(players, { x: pool.x, y: 0, z: pool.z }, def.radius)) {
      const amount = roll(ctx, mob, def.pool.min, def.pool.max);
      ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
      n++;
    }
  }
  pool.remaining -= DT;
  if (pool.remaining <= 1e-9) {
    dropObject(ctx, inst, pool.objectId);
    st.pool = undefined;
  }
  return n;
}

// ---- Granite Skin --------------------------------------------------------------------

/** The gargoyle's stone: thicken on the clock, shatter on a stun. */
export function stepGranite(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): void {
  const def = kit.granite;
  if (!def || st.descent) return;
  st.granite ??= { stacks: 0, t: def.every, cracked: 0 };
  const g = st.granite;
  const per = heroic(inst) ? def.heroicPerStack : def.perStack;
  if (ctx.isStunned(mob)) {
    if (g.stacks > 0) {
      g.stacks = 0;
      g.t = def.every;
      g.cracked = def.cracked.seconds;
      mob.auras = mob.auras.filter((a) => a.id !== CRYPT_GRANITE_SKIN);
      ctx.emit({
        type: 'aura',
        targetId: mob.id,
        name: def.name,
        gained: false,
        sourceId: mob.id,
        abilityId: CRYPT_GRANITE_SKIN,
      });
      ctx.applyAura(mob, {
        id: CRYPT_CRACKED_STONE,
        name: def.cracked.name,
        kind: 'vulnerability',
        remaining: def.cracked.seconds,
        duration: def.cracked.seconds,
        value: def.cracked.taken,
        sourceId: mob.id,
        school: 'physical',
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: 'physical',
        fx: 'nova',
        ability: CRYPT_CRACKED_STONE,
      });
    }
    return;
  }
  if (g.cracked > 0) {
    g.cracked = Math.max(0, g.cracked - DT);
    return;
  }
  if (g.stacks >= def.maxStacks) return;
  g.t -= DT;
  if (g.t > 1e-9) return;
  g.t = def.every;
  g.stacks++;
  ctx.applyAura(mob, {
    id: CRYPT_GRANITE_SKIN,
    name: def.name,
    kind: 'shield_wall',
    remaining: 3600,
    duration: 3600,
    value: Math.round(per * g.stacks * 100) / 100,
    stacks: g.stacks,
    sourceId: mob.id,
    school: 'physical',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'physical',
    fx: 'selfCast',
    ability: CRYPT_GRANITE_SKIN,
  });
}

// ---- Carrion Eye -----------------------------------------------------------------------

/** Living flock mobs of the claim in the fight. */
function livingFlock(ctx: SimContext, inst: InstanceSlot, flock: string): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && e.hp > 0 && e.templateId === flock && e.inCombat) out.push(e);
  }
  return out;
}

/** The eye's victim: a hashed pick among the living players in reach,
 *  leaving out the caller's own foe unless nobody else is there; null while
 *  no crow of its flock is in the fight. */
export function pickEyeTarget(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.eye;
  if (!def || livingFlock(ctx, inst, def.flock).length === 0) return null;
  const inReach = livingInReach(players, mob.pos, def.range);
  if (inReach.length === 0) return null;
  const others = inReach.filter((p) => p.id !== mob.aggroTargetId);
  const pool = others.length > 0 ? others : inReach;
  return pool[kitHash(mob.id, st.casts) % pool.length];
}

/** The eye's bar ran out: mark the victim and turn every crow on them.
 *  Returns how many crows it turned. */
export function landEye(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
): number {
  const def = kit.eye;
  const victim = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !victim || victim.dead || dist2d(victim.pos, mob.pos) > def.range + 5) return 0;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: victim.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: def.castId,
  });
  ctx.applyAura(victim, {
    id: CRYPT_CARRION_EYE,
    name: def.name,
    // A mark, not a slow or a curse: a zero vulnerability changes nothing, and
    // no freedom effect sheds it (the mark lasts as long as the crows hunt).
    kind: 'vulnerability',
    remaining: def.seconds,
    duration: def.seconds,
    value: 0,
    sourceId: mob.id,
    school: def.school,
  });
  let n = 0;
  for (const crow of livingFlock(ctx, inst, def.flock)) {
    crow.forcedTargetId = victim.id;
    crow.forcedTargetTimer = def.seconds;
    crow.aggroTargetId = victim.id;
    addThreat(crow, victim.id, 1);
    n++;
  }
  return n;
}

// ---- The heroic releap -------------------------------------------------------------

/** A leap just landed: watch whether anyone answers it (heroic only acts). */
export function armReleap(kit: TrashKitDef, st: TrashKitState, victim: Entity): void {
  const def = kit.leap;
  if (!def?.releapOnHeroic) return;
  st.releap = { victimId: victim.id, remaining: def.fixate, answered: false };
}

/** Is the leaper held or slowed by a player's answer this tick? */
function answeredOn(ctx: SimContext, mob: Entity, victimId: number): boolean {
  if (ctx.isStunned(mob) || ctx.isRooted(mob)) return true;
  if (mob.forcedTargetId !== null && mob.forcedTargetId !== victimId) return true;
  return mob.auras.some((a) => a.kind === 'slow' && a.value < 1 && a.sourceId !== mob.id);
}

/** Heroic: count the fixate down; unanswered, the leap comes again at once. */
export function stepReleap(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  st: TrashKitState,
): void {
  const r = st.releap;
  if (!r) return;
  if (!heroic(inst)) {
    st.releap = undefined;
    return;
  }
  if (answeredOn(ctx, mob, r.victimId)) r.answered = true;
  r.remaining -= DT;
  if (r.remaining > 1e-9) return;
  st.releap = undefined;
  const victim = ctx.entities.get(r.victimId);
  if (!r.answered && victim && !victim.dead) st.timers.leap = 0;
}

// ---- Barrow Embers -----------------------------------------------------------------------

function breathOf(template: MobTemplate | undefined): { range: number; arcDeg: number } {
  return { range: template?.breathCone?.range ?? 0, arcDeg: template?.breathCone?.arcDeg ?? 0 };
}

/** Heroic Barrow Embers: set the landed cone burning, and burn whoever stands
 *  in a burning cone. Returns how many it struck this tick. */
export function stepScorch(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): number {
  const def = kit.scorch;
  if (!def) return 0;
  const cone = breathOf(MOBS[mob.templateId]);
  if (st.scorchAt) {
    const at = st.scorchAt;
    st.scorchAt = undefined;
    if (heroic(inst) && cone.range > 0) {
      st.scorches ??= [];
      st.scorches.push({
        x: at.x,
        z: at.z,
        facing: at.facing,
        remaining: def.seconds,
        objectId: spawnFloorObject(
          ctx,
          inst,
          CRYPT_BARROW_EMBERS,
          def.name,
          at.x,
          at.z,
          cone.range,
          at.facing,
        ),
      });
    }
  }
  if (!st.scorches) return 0;
  let n = 0;
  for (const s of st.scorches) {
    if (tickDue(def.seconds, s.remaining, def.tick)) {
      const origin = { x: s.x, y: 0, z: s.z };
      for (const p of livingInReach(players, origin, cone.range)) {
        if (!inCone(origin, s.facing, p.pos, cone.range, cone.arcDeg)) continue;
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
        n++;
      }
    }
    s.remaining -= DT;
    if (s.remaining <= 1e-9) dropObject(ctx, inst, s.objectId);
  }
  st.scorches = st.scorches.filter((s) => s.remaining > 1e-9);
  if (st.scorches.length === 0) st.scorches = undefined;
  return n;
}

// ---- The pass ----------------------------------------------------------------------------

/** One engaged tick of the crypt pieces that run beside the casts. */
export function stepCryptKit(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): void {
  stepGranite(ctx, inst, mob, kit, st);
  stepReleap(ctx, inst, mob, st);
  stepRupturePool(ctx, inst, mob, kit, st, players);
  stepScorch(ctx, inst, mob, kit, st, players);
}

/** The pull ended: lift every floor object the crypt pieces hold and shed the
 *  stone (a gargoyle that leaves the fight keeps no ward). */
export function endCryptPull(ctx: SimContext, inst: InstanceSlot, mob: Entity): void {
  const st = mob.trashKit;
  if (st) {
    dropRupture(ctx, inst, st);
    dropObject(ctx, inst, st.pool?.objectId);
    st.pool = undefined;
    for (const s of st.scorches ?? []) dropObject(ctx, inst, s.objectId);
    st.scorches = undefined;
  }
  if (mob.auras.some((a) => a.id === CRYPT_GRANITE_SKIN))
    mob.auras = mob.auras.filter((a) => a.id !== CRYPT_GRANITE_SKIN);
}

/** Face a locked spot while a bar runs (the rupture faces its corpse). */
export function faceRupture(mob: Entity, st: TrashKitState): void {
  if (st.rupture) mob.facing = angleTo(mob.pos, { x: st.rupture.x, y: 0, z: st.rupture.z });
}
