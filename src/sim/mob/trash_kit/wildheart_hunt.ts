// The Wildheart Basin's hunt keys (MobTemplate.trashKit.wildheart): the
// Sunbone and their beasts hunt together. A sibling of wildheart_kit.ts, run
// through the Basin extension (wildheart_extension.ts).
//
//   mark    Quarry Mark (Vineclaw Stalker): a marking spear at someone past
//           the tank, only while a raptor of the fight runs near; every such
//           raptor turns on the marked player for a few seconds (a taunt still
//           wins). Kill the stalker first, or gather the raptors on the tank.
//   roar    War Roar (Bloodmane Ravager): once per pull, when low, a roar
//           you can kick or stun; if it lands every ravager near it is
//           enraged for the rest of the pull. A kicked roar is spent.
//   hex     Toad Hex (Sunbone Hexcaller): a kickable hex that makes a toad of
//           someone past the tank; any hit breaks it.
//   totems  Plant Totem (Sunbone Totem-Binder): the binder plants its totems
//           in turn, a healing Sunbone Totem then a Sunbone Dread Totem.
//   dread   Rattling Dread (Sunbone Dread Totem): an unkickable bar, then
//           everyone near the totem flees from it. A dread totem crumbles
//           with its binder, like the healing one.
//   tongue  Snaring Tongue (Spore Toad): a lane locked at the bar's start
//           toward someone far off; whoever stands in it is struck and
//           reeled in to the toad (into its spores, when it is low).
//
// Zero rng in every pick (hashed victims, mobs in roster order, players in
// entity-id order where livingInReach sorts them, else the claim's join
// order); the only draws are a landing effect's damage rolls.

import { SHARED_FEAR_AURA_ID } from '../../combat/cc';
import { pullToward } from '../../pull_toward';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import {
  angleTo,
  DT,
  dist2d,
  type Entity,
  type TrashKitDef,
  type TrashKitState,
} from '../../types';
import { inLane } from './lane';
import { spawnKitAdd } from './spawn';
import { kitHash, livingInReach } from './targets';
import {
  WILDHEART_PLANT_TOTEM,
  WILDHEART_QUARRY,
  WILDHEART_QUARRY_MARK,
  WILDHEART_RATTLING_DREAD,
  WILDHEART_ROAR_FRENZY,
  WILDHEART_ROAR_HASTE,
  WILDHEART_SNARING_TONGUE,
  WILDHEART_TOADED,
  WILDHEART_WAR_ROAR,
} from './wildheart_cast_ids';

/** Seconds a tongue holds past a full lane's reel (then it lets go). */
const REEL_GRACE = 0.25;

function roll(ctx: SimContext, mob: Entity, min: number, max: number): number {
  return Math.max(1, Math.round(ctx.rng.range(min, max) * (mob.mechanicDamageMult ?? 1)));
}

/** Living mobs of the claim in the fight, in roster order. */
function fighting(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob' || !e.inCombat) continue;
    out.push(e);
  }
  return out;
}

/** A hashed pick among the living players in reach, leaving out the one the
 *  caster fights unless nobody else is there (the tank is never the quarry). */
export function pickPastTank(
  players: readonly Entity[],
  caster: Entity,
  range: number,
  salt: number,
  minRange = 0,
): Entity | null {
  const inReach = livingInReach(players, caster.pos, range).filter(
    (p) => dist2d(p.pos, caster.pos) >= minRange,
  );
  if (inReach.length === 0) return null;
  const others = inReach.filter((p) => p.id !== caster.aggroTargetId);
  const pool = others.length > 0 ? others : inReach;
  return pool[kitHash(caster.id, salt) % pool.length];
}

// ---- Quarry Mark -------------------------------------------------------------

/** The hunters a stalker's mark sends: living `hunter` mobs in the fight
 *  within `huntRange` of it, in roster order. */
export function huntersOf(ctx: SimContext, inst: InstanceSlot, stalker: Entity, kit: TrashKitDef) {
  const def = kit.wildheart?.mark;
  if (!def) return [];
  return fighting(ctx, inst).filter(
    (e) => e.templateId === def.hunter && dist2d(e.pos, stalker.pos) <= def.huntRange,
  );
}

export function markTarget(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.wildheart?.mark;
  if (!def || huntersOf(ctx, inst, mob, kit).length === 0) return null;
  return pickPastTank(players, mob, def.range, st.casts);
}

/** The spear lands: mark the quarry and set the raptors on it. Returns how
 *  many hunters it sent. */
export function landMark(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
): number {
  const def = kit.wildheart?.mark;
  const quarry = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !quarry || quarry.dead) return 0;
  if (dist2d(quarry.pos, mob.pos) > def.range + 5) return 0;
  // One quarry mark at a time: a second stalker's spear refreshes it.
  if (quarry.auras.some((a) => a.id === WILDHEART_QUARRY))
    quarry.auras = quarry.auras.filter((a) => a.id !== WILDHEART_QUARRY);
  const seconds = inst.difficulty === 'heroic' ? def.heroicSeconds : def.seconds;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: quarry.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: WILDHEART_QUARRY_MARK,
  });
  ctx.applyAura(quarry, {
    id: WILDHEART_QUARRY,
    name: def.name,
    // A bare marker (internal_cd): no slow, no chill, nothing strips it.
    kind: 'internal_cd',
    remaining: seconds,
    duration: seconds,
    value: 1,
    sourceId: mob.id,
    school: def.school,
    undispellable: true,
  });
  let sent = 0;
  for (const h of huntersOf(ctx, inst, mob, kit)) {
    // A taunt still running wins: a raptor held by the tank stays on the tank.
    if (h.forcedTargetTimer > 0 && h.forcedTargetId !== null && h.forcedTargetId !== quarry.id)
      continue;
    h.forcedTargetId = quarry.id;
    h.forcedTargetTimer = seconds;
    h.aggroTargetId = quarry.id;
    addThreat(h, quarry.id, 1);
    sent++;
  }
  return sent;
}

// ---- War Roar ----------------------------------------------------------------

export function roarReady(mob: Entity, kit: TrashKitDef, st: TrashKitState): boolean {
  const def = kit.wildheart?.roar;
  if (!def || st.wildheart?.roared || mob.maxHp <= 0) return false;
  return mob.hp / mob.maxHp < def.belowHpPct;
}

/** The roar lands: every packmate near it (the roarer too) is enraged for the
 *  rest of the pull. Returns how many it roused. */
export function landRoar(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
): number {
  const def = kit.wildheart?.roar;
  if (!def) return 0;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: WILDHEART_WAR_ROAR,
  });
  let roused = 0;
  for (const e of fighting(ctx, inst)) {
    if (e.templateId !== def.packmate || dist2d(e.pos, mob.pos) > def.radius) continue;
    if (e.auras.some((a) => a.id === WILDHEART_ROAR_FRENZY)) continue;
    ctx.applyAura(e, {
      id: WILDHEART_ROAR_FRENZY,
      name: def.name,
      kind: 'buff_dmg_done',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: def.damagePct,
      sourceId: mob.id,
      school: 'physical',
      undispellable: true,
    });
    ctx.applyAura(e, {
      id: WILDHEART_ROAR_HASTE,
      name: def.name,
      kind: 'buff_haste',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: def.hasteMult,
      sourceId: mob.id,
      school: 'physical',
      undispellable: true,
    });
    roused++;
  }
  return roused;
}

// ---- Toad Hex -------------------------------------------------------------------

export function landHex(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
): boolean {
  const def = kit.wildheart?.hex;
  const victim = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !victim || victim.dead) return false;
  if (dist2d(victim.pos, mob.pos) > def.range + 5) return false;
  const seconds = inst.difficulty === 'heroic' ? def.heroicSeconds : def.seconds;
  const remaining = ctx.diminishedCrowdControlDuration(mob, victim, 'polymorph', seconds);
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: victim.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: def.castId,
  });
  if (remaining === null) return false;
  ctx.applyAura(victim, {
    id: WILDHEART_TOADED,
    name: def.name,
    kind: 'polymorph',
    remaining,
    duration: remaining,
    value: 0,
    sourceId: mob.id,
    school: def.school,
    // A hex: any hit breaks it (tap the toad free).
    breaksOnDamage: true,
  });
  return true;
}

// ---- Plant Totem, alternating ---------------------------------------------------

function livingTotems(ctx: SimContext, owner: Entity, summons: readonly string[]): number {
  let n = 0;
  for (const id of owner.summonedIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && summons.includes(e.templateId)) n++;
  }
  return n;
}

export function totemsReady(ctx: SimContext, mob: Entity, kit: TrashKitDef): boolean {
  const def = kit.wildheart?.totems;
  return !!def && livingTotems(ctx, mob, def.summons) < def.maxAlive;
}

/** The next totem of the binder's cycle, planted beside it. */
export function landTotem(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): Entity | null {
  const def = kit.wildheart?.totems;
  if (!def || def.summons.length === 0) return null;
  st.wildheart ??= {};
  const planted = st.wildheart.planted ?? 0;
  st.wildheart.planted = planted + 1;
  const summon = def.summons[planted % def.summons.length];
  const victim = mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
  const add = spawnKitAdd(
    ctx,
    inst,
    mob,
    summon,
    mob.pos.x + Math.sin(mob.facing) * 2,
    mob.pos.z + Math.cos(mob.facing) * 2,
    victim,
  );
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: add?.id ?? mob.id,
    school: def.school,
    fx: 'nova',
    ability: WILDHEART_PLANT_TOTEM,
  });
  return add;
}

// ---- Rattling Dread ---------------------------------------------------------------

export function dreadReady(mob: Entity, kit: TrashKitDef, players: readonly Entity[]): boolean {
  const def = kit.wildheart?.dread;
  return !!def && livingInReach(players, mob.pos, def.radius).length > 0;
}

/** The dread lands: everyone within reach flees straight away from the
 *  totem (a hit breaks the fear). Returns how many fled. */
export function landDread(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  players: readonly Entity[],
): number {
  const def = kit.wildheart?.dread;
  if (!def) return 0;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: WILDHEART_RATTLING_DREAD,
  });
  const seconds = inst.difficulty === 'heroic' ? def.heroicSeconds : def.seconds;
  let fled = 0;
  for (const p of livingInReach(players, mob.pos, def.radius)) {
    const remaining = ctx.diminishedCrowdControlDuration(mob, p, 'fear', seconds);
    if (remaining === null) continue;
    ctx.applyAura(p, {
      id: SHARED_FEAR_AURA_ID,
      name: def.name,
      kind: 'incapacitate',
      remaining,
      duration: remaining,
      // The flee heading: straight away from the totem (no roll).
      value: dist2d(p.pos, mob.pos) > 1e-6 ? angleTo(mob.pos, p.pos) : mob.facing,
      sourceId: mob.id,
      school: def.school,
      breaksOnDamage: true,
    });
    fled++;
  }
  return fled;
}

// ---- Snaring Tongue ----------------------------------------------------------------

export function tongueTarget(
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.wildheart?.tongue;
  if (!def) return null;
  return pickPastTank(players, mob, def.length, st.casts, def.minRange);
}

/** The tongue lands down its locked lane: strike whoever stands in it and
 *  start reeling them in. Returns who it caught. */
export function landTongue(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
  st: TrashKitState,
  players: readonly Entity[],
): Entity[] {
  const def = kit.wildheart?.tongue;
  if (!def) return [];
  const yaw = st.aim ?? mob.facing;
  st.aim = undefined;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: targetId ?? mob.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: WILDHEART_SNARING_TONGUE,
  });
  const caught: Entity[] = [];
  for (const p of players) {
    if (p.dead) continue;
    if (!inLane(mob.pos.x, mob.pos.z, yaw, def.length, def.halfWidth, p.pos.x, p.pos.z)) continue;
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
    if (p.dead) continue;
    caught.push(p);
  }
  if (caught.length > 0) {
    st.wildheart ??= {};
    // The tongue holds as long as a full lane takes to reel in, plus a
    // beat: two toads tugging one player never hold them forever.
    const hold = def.length / def.reel + REEL_GRACE;
    st.wildheart.reels = caught.map((p) => ({ id: p.id, left: hold }));
  }
  return caught;
}

/** Reel the tongue's catch in toward the toad, a stretch each tick, until
 *  each is at its mouth. */
export function stepReel(ctx: SimContext, mob: Entity, kit: TrashKitDef, st: TrashKitState): void {
  const def = kit.wildheart?.tongue;
  const reels = st.wildheart?.reels;
  if (!def || !reels || !st.wildheart) return;
  const still: { id: number; left: number }[] = [];
  for (const r of reels) {
    const p = ctx.entities.get(r.id);
    r.left -= DT;
    if (!p || p.dead || r.left <= 1e-9) continue;
    if (dist2d(p.pos, mob.pos) <= def.stop + 0.05) continue;
    const moved = pullToward(ctx, p, mob.pos.x, mob.pos.z, def.reel * DT, def.stop);
    // Held fast (an anchor, a wall): the tongue lets go.
    if (moved > 1e-6) still.push(r);
  }
  st.wildheart.reels = still.length > 0 ? still : undefined;
}
