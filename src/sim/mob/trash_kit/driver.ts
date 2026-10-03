// The dungeon trash kit driver (MobTemplate.trashKit): one pass per tick over
// every claimed dungeon's mobs, AFTER the mob AI (called from
// instances/dungeons.ts updateInstances, which the coordinator runs after the
// per-entity loop), so a leap, a dive or a landing can own the mob's position
// for the tick the AI already moved it.
//
// Every cast is a real cast bar (castingAbility / castRemaining / castTotal,
// mirrored online like any cast). The interruptible ones are registered in
// cast_ids.ts TRASH_KIT_CAST_SCHOOLS; an interrupt (cancelCast) clears the bar,
// which this pass reads as "cancelled", and the school lockout it leaves keeps
// the caster from starting that school again until it lapses. A stun or a
// silence breaks a cast the same way. The effect lands only when the bar runs
// out.
//
// Determinism: targets are hashed (targets.ts), never rolled; the only rng
// draws are the damage rolls of a landing cast, in mob-roster order.

import { isLockedOut, isSilenced } from '../../combat/cc';
import { DUNGEONS, MOBS } from '../../data';
import { applyKnockback } from '../../knockback';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import {
  type Aura,
  angleTo,
  DT,
  dist2d,
  type Entity,
  type TrashKitCast,
  type TrashKitDef,
  type TrashKitState,
} from '../../types';
import { packPeerRank, packStaggerOffset } from '../pack_cast_stagger';
import { holdAreaCast } from './cast_hold';
import { CRYPT_PERCH_DIVE, CRYPT_SKY_LANDING } from './cast_ids';
import { stepDeathBurst } from './death_burst';
import { callDownLastFlier } from './flier_call';
import {
  dropToss,
  landGoad,
  landToss,
  lockToss,
  pickGoadTarget,
  pickTossTarget,
  stepStoke,
} from './sanctum_kit';
import { spawnKitAdd } from './spawn';
import {
  holdLineAim,
  landSupportCast,
  lockLineAim,
  type SupportKey,
  stepWithdraw,
  supportCastReady,
} from './support';
import { inCone, livingInReach, pickHashedTarget, pickLeapTarget } from './targets';
import { landLullaby, lullabyReady, stepCarapace, stepDetonate } from './temple_kit';
import { stepDeathCloud, stepPulse } from './wildheart_kit';

/** Kit casts in priority order: a summon before a heal or shield, a control
 *  before a strike, a bolt last. */
const CAST_KEYS = [
  'raise',
  'call',
  'mend',
  'ward',
  'goad',
  'screech',
  'lullaby',
  'wingGust',
  'tailLash',
  'line',
  'toss',
  'bolt',
] as const;
type CastKey = (typeof CAST_KEYS)[number];

/** Physical kit casts: a silence never breaks them and no school lockout
 *  stops them (dodge these, never kick them). */
function isPhysicalKey(key: CastKey): boolean {
  return key === 'tailLash' || key === 'wingGust' || key === 'line' || key === 'toss';
}

function isSupportKey(key: CastKey): key is SupportKey {
  return key === 'mend' || key === 'ward' || key === 'line';
}

/** A caster's own swings (and a petSpell caster's bolts) hold while a bar runs. */
const SWING_HOLD_SECONDS = 0.6;
/** A mob this far over the floor is airborne (on a perch or on the wing). */
const AIRBORNE = 1;
/** The leap stops this short of its victim. */
const LEAP_STOP = 1.5;
/** How high a leap arcs at its apex. */
const LEAP_ARC = 3;

function castDef(kit: TrashKitDef, key: CastKey): TrashKitCast | undefined {
  return kit[key];
}

function clearCast(mob: Entity, castId: string): void {
  if (mob.castingAbility !== castId) return;
  mob.castingAbility = null;
  mob.castRemaining = 0;
  mob.castTotal = 0;
  mob.castTargetId = null;
  mob.channeling = false;
}

/** The players standing in a claim (the boss-add spawner's footprint). */
function claimPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    if (Math.abs(e.pos.x - o.x) < 120 && Math.abs(e.pos.z - o.z) < 250) out.push(e);
  }
  return out;
}

function groundY(ctx: SimContext, e: Entity): number {
  return ctx.groundPos(e.pos.x, e.pos.z).y;
}

/** Fresh per-pull state: every ability waits its `first` seconds, plus the
 *  pack stagger (mob/pack_cast_stagger.ts) when same-type peers in the claim
 *  were pulled with it, so a pack's casts alternate instead of landing as one. */
export function startTrashKit(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  inst?: InstanceSlot,
): TrashKitState {
  const roster = inst ? inst.mobIds.map((id) => ctx.entities.get(id)) : [];
  const { rank, size } = packPeerRank(roster, mob, (peer) => peer.trashKit !== undefined);
  const timers: Record<string, number> = {};
  for (const key of CAST_KEYS) {
    const def = castDef(kit, key);
    if (def) timers[key] = def.first + packStaggerOffset(rank, size, def.every);
  }
  if (kit.leap) timers.leap = kit.leap.first + packStaggerOffset(rank, size, kit.leap.every);
  const st: TrashKitState = { timers, cast: null, leap: null, descent: null, engaged: 0, casts: 0 };
  // Pulled off a perch or out of the sky: come down first. The mob AI has
  // already stood it on the floor this tick, so the height it was up at is the
  // one its last idle tick recorded.
  const floor = groundY(ctx, mob);
  const upAt = Math.max(mob.pos.y, mob.airY ?? -Infinity);
  mob.airY = undefined;
  if (upAt > floor + AIRBORNE) {
    const dive = mob.perchY !== undefined;
    mob.pos.y = upAt;
    st.descent = {
      fromY: upAt,
      t: 0,
      seconds: dive ? (kit.perch?.diveSeconds ?? 1) : (kit.land?.seconds ?? 1.5),
      dive,
    };
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.aggroTargetId ?? mob.id,
      school: 'physical',
      fx: 'windup',
      ability: dive ? CRYPT_PERCH_DIVE : CRYPT_SKY_LANDING,
    });
  }
  return st;
}

/** The pull ended (evade, reset, death): drop the bar and the state. */
export function endTrashKit(mob: Entity): void {
  const st = mob.trashKit;
  if (st?.cast) clearCast(mob, st.cast.castId);
  mob.trashKit = undefined;
  mob.castHold = undefined;
}

/** An idle perched mob back on its spawn spot sits on its perch again. */
function holdPerch(mob: Entity): void {
  if (mob.perchY === undefined || mob.aiState !== 'idle') return;
  if (dist2d(mob.pos, mob.spawnPos) > 0.5) return;
  mob.pos.y = mob.perchY;
  mob.prevPos.y = mob.perchY;
}

/** Bring a diving or landing mob down onto the floor. */
function stepDescent(ctx: SimContext, mob: Entity, st: TrashKitState): void {
  const d = st.descent;
  if (!d) return;
  d.t += DT;
  const k = Math.min(1, d.t / d.seconds);
  const floor = groundY(ctx, mob);
  // A dive accelerates off the perch with a small hop; a landing glides in.
  const ease = d.dive ? k * k : k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  const hop = d.dive ? Math.sin(Math.PI * Math.min(1, k * 2)) * 0.8 * (1 - k) : 0;
  mob.pos.y = d.fromY + (floor - d.fromY) * ease + hop;
  if (k >= 1) {
    mob.pos.y = floor;
    st.descent = null;
  }
}

/** A summon template plus every form its kit grows into (a Bone Minion and the
 *  Bone Brute it swells into), read off the content: a grown add is still the
 *  summoner's, so it still counts toward the summon cap. */
function summonFamily(templateId: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let id: string | undefined = templateId; id && !ids.has(id); ) {
    ids.add(id);
    id = MOBS[id]?.trashKit?.grow?.into;
  }
  return ids;
}

function livingSummons(ctx: SimContext, owner: Entity, templateId: string): number {
  const family = summonFamily(templateId);
  let n = 0;
  for (const id of owner.summonedIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && family.has(e.templateId)) n++;
  }
  return n;
}

function mechanicDamage(ctx: SimContext, mob: Entity, min: number, max: number): number {
  return Math.max(1, Math.round(ctx.rng.range(min, max) * (mob.mechanicDamageMult ?? 1)));
}

/** Can the kit start `key` now? Returns the cast's victim for a bolt. */
function castReady(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  key: CastKey,
  st: TrashKitState,
  players: readonly Entity[],
): { ok: boolean; target: Entity | null } {
  const no = { ok: false, target: null };
  if (isSupportKey(key)) return supportCastReady(ctx, inst, mob, kit, key, st, players);
  switch (key) {
    case 'bolt': {
      const def = kit.bolt;
      if (!def) return no;
      const target = pickHashedTarget(players, mob.pos, def.range, mob.id, st.casts);
      return target ? { ok: true, target } : no;
    }
    case 'raise':
      return kit.raise && livingSummons(ctx, mob, kit.raise.summon) < kit.raise.maxAlive
        ? { ok: true, target: null }
        : no;
    case 'call':
      // A whole flock must fit under the cap, so a second call waits.
      return kit.call &&
        livingSummons(ctx, mob, kit.call.summon) + kit.call.count <= kit.call.maxAlive
        ? { ok: true, target: null }
        : no;
    case 'lullaby':
      return lullabyReady(mob, kit, st, players);
    case 'goad': {
      const ally = pickGoadTarget(ctx, inst, mob, kit);
      return ally ? { ok: true, target: ally } : no;
    }
    case 'toss': {
      const victim = pickTossTarget(players, mob, kit);
      return victim ? { ok: true, target: victim } : no;
    }
    case 'screech':
      return kit.screech && livingInReach(players, mob.pos, kit.screech.radius).length > 0
        ? { ok: true, target: null }
        : no;
    case 'wingGust':
      return kit.wingGust && livingInReach(players, mob.pos, kit.wingGust.radius).length > 0
        ? { ok: true, target: null }
        : no;
    case 'tailLash': {
      const def = kit.tailLash;
      if (!def) return no;
      const behind = players.some(
        (p) => !p.dead && inCone(mob.pos, mob.facing + Math.PI, p.pos, def.range, def.arcDeg),
      );
      return behind ? { ok: true, target: null } : no;
    }
  }
}

function hit(ctx: SimContext, mob: Entity, p: Entity, def: TrashKitCast, amount: number): void {
  ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
}

/** The bar ran out: the cast lands. */
function landCast(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  key: CastKey,
  targetId: number | null,
  players: readonly Entity[],
  st: TrashKitState,
): void {
  if (isSupportKey(key)) {
    landSupportCast(ctx, mob, kit, key, targetId, st, players);
    return;
  }
  switch (key) {
    case 'lullaby':
      landLullaby(ctx, mob, kit, targetId);
      return;
    case 'goad':
      landGoad(ctx, mob, kit, targetId);
      return;
    case 'toss':
      landToss(ctx, inst, mob, kit, st, players);
      return;
    case 'bolt': {
      const def = kit.bolt;
      const target = targetId !== null ? ctx.entities.get(targetId) : undefined;
      if (!def || !target || target.dead) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: target.id,
        school: def.school,
        fx: 'heavyBolt',
        ability: def.castId,
      });
      hit(ctx, mob, target, def, mechanicDamage(ctx, mob, def.min, def.max));
      return;
    }
    case 'raise': {
      const def = kit.raise;
      if (!def) return;
      const x = mob.pos.x + Math.sin(mob.facing) * 2.5;
      const z = mob.pos.z + Math.cos(mob.facing) * 2.5;
      const victim =
        mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
      const add = spawnKitAdd(ctx, inst, mob, def.summon, x, z, victim);
      if (add)
        ctx.emit({
          type: 'spellfx',
          sourceId: mob.id,
          targetId: add.id,
          school: def.school,
          fx: 'nova',
          ability: def.castId,
        });
      return;
    }
    case 'call': {
      const def = kit.call;
      if (!def) return;
      const victim =
        mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
      for (let k = 0; k < def.count; k++) {
        const a = (k / def.count) * Math.PI * 2 + mob.facing;
        spawnKitAdd(
          ctx,
          inst,
          mob,
          def.summon,
          mob.pos.x + Math.sin(a) * 2,
          mob.pos.z + Math.cos(a) * 2,
          victim,
        );
      }
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      return;
    }
    case 'screech': {
      const def = kit.screech;
      if (!def) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      for (const p of livingInReach(players, mob.pos, def.radius)) {
        hit(ctx, mob, p, def, mechanicDamage(ctx, mob, def.min, def.max));
        if (p.dead) continue;
        ctx.applyAura(p, {
          id: def.castId,
          name: def.name,
          kind: 'stun',
          remaining: def.stun,
          duration: def.stun,
          value: 0,
          sourceId: mob.id,
          school: def.school,
        });
      }
      return;
    }
    case 'wingGust': {
      const def = kit.wingGust;
      if (!def) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      for (const p of livingInReach(players, mob.pos, def.radius)) {
        hit(ctx, mob, p, def, mechanicDamage(ctx, mob, def.min, def.max));
        if (!p.dead) applyKnockback(ctx, mob, p, def.knockback);
      }
      return;
    }
    case 'tailLash': {
      const def = kit.tailLash;
      if (!def) return;
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'nova',
        ability: def.castId,
      });
      for (const p of players) {
        if (p.dead || !inCone(mob.pos, mob.facing + Math.PI, p.pos, def.range, def.arcDeg))
          continue;
        hit(ctx, mob, p, def, mechanicDamage(ctx, mob, def.min, def.max));
      }
      return;
    }
  }
}

/** Advance the cast in flight; returns true while a bar is running. */
function stepCast(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): boolean {
  const cast = st.cast;
  if (!cast) return false;
  const key = cast.key as CastKey;
  const def = castDef(kit, key);
  const broken =
    !def ||
    mob.castingAbility !== cast.castId ||
    ctx.isStunned(mob) ||
    (!isPhysicalKey(key) && isSilenced(mob));
  if (broken) {
    clearCast(mob, cast.castId);
    st.cast = null;
    if (key === 'toss') dropToss(ctx, inst, st);
    return false;
  }
  mob.castRemaining = Math.max(0, mob.castRemaining - DT);
  mob.swingTimer = Math.max(mob.swingTimer, SWING_HOLD_SECONDS);
  const target = cast.targetId !== null ? ctx.entities.get(cast.targetId) : undefined;
  // A lane holds the aim it locked at the start, a toss the spot it marked;
  // everything else tracks.
  if (key === 'line') holdLineAim(mob, st);
  else if (key === 'toss' && st.toss)
    mob.facing = angleTo(mob.pos, { x: st.toss.x, y: 0, z: st.toss.z });
  else if (target && !target.dead) mob.facing = angleTo(mob.pos, target.pos);
  if (mob.castRemaining > 0) return true;
  clearCast(mob, cast.castId);
  st.cast = null;
  landCast(ctx, inst, mob, kit, key, cast.targetId, players, st);
  return false;
}

/** Tick the cooldowns and start the first ready cast. */
function tryStartCast(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): void {
  for (const key of CAST_KEYS) {
    if (st.timers[key] !== undefined) st.timers[key] -= DT;
  }
  if (mob.castingAbility !== null || st.descent || st.leap) return;
  if (ctx.isStunned(mob)) return;
  for (const key of CAST_KEYS) {
    const def = castDef(kit, key);
    if (!def || (st.timers[key] ?? 0) > 0) continue;
    const physical = isPhysicalKey(key);
    if (!physical && (isSilenced(mob) || isLockedOut(mob, def.school as Aura['school']))) continue;
    const { ok, target } = castReady(ctx, inst, mob, kit, key, st, players);
    if (!ok) continue;
    st.timers[key] = def.every;
    st.casts++;
    st.cast = { key, castId: def.castId, targetId: target?.id ?? null };
    mob.castingAbility = def.castId;
    mob.castTotal = def.castTime;
    mob.castRemaining = def.castTime;
    mob.castTargetId = target?.id ?? null;
    mob.channeling = key === 'raise';
    if (key === 'line') lockLineAim(mob, st, target);
    else if (target) mob.facing = angleTo(mob.pos, target.pos);
    if (key === 'toss') lockToss(ctx, inst, mob, kit, st, target);
    holdAreaCast(ctx, mob, false);
    return;
  }
}

/** The leap: pick a victim when ready, fly the arc, open the bleed on landing.
 *  Returns true while the leap owns the mob's position. */
function stepLeap(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): boolean {
  const def = kit.leap;
  if (!def) return false;
  if (!st.leap) {
    st.timers.leap = (st.timers.leap ?? def.first) - DT;
    if (st.timers.leap > 0 || mob.castingAbility !== null || st.descent) return false;
    if (ctx.isStunned(mob) || ctx.isRooted(mob)) return false;
    const target = pickLeapTarget(players, mob.pos, def.minRange, def.maxRange);
    if (!target) return false;
    st.timers.leap = def.every;
    st.leap = { fromX: mob.pos.x, fromZ: mob.pos.z, fromY: mob.pos.y, targetId: target.id, t: 0 };
    mob.facing = angleTo(mob.pos, target.pos);
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: target.id,
      school: 'physical',
      fx: 'windup',
      ...(def.castId !== undefined ? { ability: def.castId } : {}),
    });
  }
  const leap = st.leap;
  const target = ctx.entities.get(leap.targetId);
  if (!target || target.dead || ctx.isStunned(mob)) {
    st.leap = null;
    return false;
  }
  leap.t += DT;
  const k = Math.min(1, leap.t / def.seconds);
  const dx = target.pos.x - leap.fromX;
  const dz = target.pos.z - leap.fromZ;
  const len = Math.hypot(dx, dz);
  const reach = Math.max(0, len - LEAP_STOP) / (len || 1);
  mob.pos.x = leap.fromX + dx * reach * k;
  mob.pos.z = leap.fromZ + dz * reach * k;
  const floor = groundY(ctx, mob);
  mob.pos.y = leap.fromY + (floor - leap.fromY) * k + Math.sin(Math.PI * k) * LEAP_ARC;
  mob.facing = angleTo(mob.pos, target.pos);
  if (k < 1) return true;
  mob.pos.y = floor;
  st.leap = null;
  if (def.bleed) {
    ctx.applyAura(target, {
      id: 'crypt_rending_leap',
      name: def.name,
      kind: 'dot',
      remaining: def.bleed.duration,
      duration: def.bleed.duration,
      value: Math.max(1, Math.round(def.bleed.perTick * (mob.mechanicDamageMult ?? 1))),
      tickInterval: def.bleed.interval,
      tickTimer: def.bleed.interval,
      sourceId: mob.id,
      school: 'physical',
    });
  }
  if (def.stun) {
    ctx.applyAura(target, {
      id: 'trash_kit_leap_stun',
      name: def.name,
      kind: 'stun',
      remaining: def.stun,
      duration: def.stun,
      value: 0,
      sourceId: mob.id,
      school: 'physical',
    });
  }
  // It fixates on the one it leapt at for a few seconds (a taunt still wins).
  mob.forcedTargetId = target.id;
  mob.forcedTargetTimer = def.fixate;
  mob.aggroTargetId = target.id;
  addThreat(mob, target.id, 1);
  return true;
}

/** A kit add that outlived its growth timer turns into its bigger form. */
function grow(ctx: SimContext, inst: InstanceSlot, mob: Entity, into: string): void {
  let owner: Entity = mob;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && e.summonedIds.includes(mob.id)) {
      owner = e;
      break;
    }
  }
  const victim = mob.aggroTargetId !== null ? (ctx.entities.get(mob.aggroTargetId) ?? null) : null;
  const grown = spawnKitAdd(
    ctx,
    inst,
    owner === mob ? mob : owner,
    into,
    mob.pos.x,
    mob.pos.z,
    victim,
  );
  if (grown) {
    grown.facing = mob.facing;
    grown.prevFacing = mob.facing;
    ctx.emit({
      type: 'spellfx',
      sourceId: grown.id,
      targetId: grown.id,
      school: 'shadow',
      fx: 'nova',
      ability: 'crypt_bone_growth',
    });
  }
  owner.summonedIds = owner.summonedIds.filter((id) => id !== mob.id);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === mob.id) e.targetId = grown?.id ?? null;
  }
  mob.trashKit = undefined;
  ctx.dropEntity(mob.id);
}

/** The claim mobs that summoned `mob` (a caller's flock). */
function summonersOf(ctx: SimContext, inst: InstanceSlot, mob: Entity): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e?.summonedIds.includes(mob.id)) out.push(e);
  }
  return out;
}

/** The pull ended in the claim (a death, an evade, a reset): a toss that will
 *  never land lifts its ring, then the kit state goes. */
function endPull(ctx: SimContext, inst: InstanceSlot, mob: Entity): void {
  if (mob.trashKit) dropToss(ctx, inst, mob.trashKit);
  endTrashKit(mob);
}

/** One mob's kit tick. */
function stepMob(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef | undefined,
  players: () => Entity[],
): void {
  if (mob.dead || mob.hp <= 0) {
    if (mob.trashKit) endPull(ctx, inst, mob);
    if (kit?.deathBurst) stepDeathBurst(ctx, inst, mob, kit, players());
    if (kit?.deathCloud) stepDeathCloud(ctx, inst, mob, kit, players());
    return;
  }
  // An area cast in flight (the kit's own, or the template's breath cone):
  // the mob AI walked and turned the caster this tick; stand it back on the
  // spot and the facing its bar began with (cast_hold.ts).
  holdAreaCast(ctx, mob, DUNGEONS[inst.dungeonId]?.areaCastsPlant === true);
  // A mob with no kit came only for its breath cone's hold.
  if (!kit && mob.perchY === undefined) return;
  const engaged =
    mob.inCombat &&
    mob.aggroTargetId !== null &&
    (mob.aiState === 'chase' || mob.aiState === 'attack');
  if (!engaged || !kit) {
    if (mob.trashKit) endPull(ctx, inst, mob);
    holdPerch(mob);
    // Remember how high it waits (a perch, a flight loop) for its pull.
    mob.airY = mob.pos.y > groundY(ctx, mob) + AIRBORNE ? mob.pos.y : undefined;
    // The last pack of a gate never stays on the wing (flier_call.ts).
    if (!engaged && mob.dungeonPatrol?.flightY !== undefined)
      callDownLastFlier(ctx, inst, mob, players());
    return;
  }
  const st = mob.trashKit ?? startTrashKit(ctx, mob, kit, inst);
  mob.trashKit = st;
  st.engaged += DT;
  if (kit.grow && st.engaged >= kit.grow.after) {
    grow(ctx, inst, mob, kit.grow.into);
    return;
  }
  stepDescent(ctx, mob, st);
  stepPulse(ctx, inst, mob, kit, st);
  // A brazier whose tender fell gutters out: nothing more this tick.
  if (stepStoke(ctx, inst, mob, kit, st) < 0) return;
  if (stepWithdraw(ctx, mob, kit, st)) return;
  stepCarapace(ctx, mob, kit, st);
  const list = players();
  if (kit.detonate && stepDetonate(ctx, mob, kit, list, summonersOf(ctx, inst, mob))) return;
  if (stepCast(ctx, inst, mob, kit, st, list)) return;
  if (stepLeap(ctx, mob, kit, st, list)) return;
  tryStartCast(ctx, inst, mob, kit, st, list);
}

/** One tick of every trash kit in every claimed dungeon. */
export function tickTrashKits(ctx: SimContext): void {
  for (const inst of ctx.instances) {
    if (inst.partyKey === null) continue;
    let cached: Entity[] | null = null;
    const players = (): Entity[] => {
      cached ??= claimPlayers(ctx, inst);
      return cached;
    };
    // A copy: a raise, a call or a growth appends to the roster mid-pass.
    for (const id of inst.mobIds.slice()) {
      const mob = ctx.entities.get(id);
      if (!mob || mob.kind !== 'mob') continue;
      const template = MOBS[mob.templateId];
      const kit = template?.trashKit;
      // (A mob with no kit still plants for its breath cone: cast_hold.ts.)
      const breath = template?.breathCone && DUNGEONS[inst.dungeonId]?.areaCastsPlant;
      if (!kit && mob.perchY === undefined && !breath) continue;
      stepMob(ctx, inst, mob, kit, players);
    }
  }
}
