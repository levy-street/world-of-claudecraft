// The Fanglord Beastmaster and his Great Jaguar in the Beast Pits
// (docs/design/dungeon-rework/wildheart_basin.md section 5.1): keep master and
// jaguar apart (G15, a linked pair).
//
//   Shared health  one pool across both bodies: every hit on either comes off
//                  the same health, so damage goes on whichever is safest to
//                  hit; when the pool runs dry both fall.
//   Pack Bond      while the two stand within 15 yd (heroic Frenzied Bond: 20)
//                  both take 50 percent less damage and deal 20 percent more
//                  (a jade spirit cord between them, brighter as they close).
//   Stalk          the jaguar cannot be taunted. It fixates a random non-tank
//                  for 10 s (a fang mark over the prey), then picks another,
//                  and bites its prey every 2 s in reach: 120 to 150 and a
//                  bleed. Stuns, roots and slows land on it, but each kind
//                  only once per 20 s (control_gate.ts; the Wary auras).
//   Beast Pit Quake  every 13 s a 1.5 s bar, then 8 yd round the master: 180 to
//                  220.
//   Call of the Hunt every 20 s both attack 20 percent faster for 7 s.
//   Thickhide Ward  every 18 s an absorb on the jaguar.
//   Heroic Heel!   every 25 s the jaguar crouches (a 2 s bar, an arc to its
//                  master on the floor) and leaps back to his side: separate
//                  them again. A stun on the jaguar during the bar stops it.
//
// The deed (Divide and Conquer): defeat them with Pack Bond up for less than
// 10 s in total. Deterministic: the prey is hashed (pickMarkTargets); the only
// rng draws are damage rolls. Every visible state rides existing fields (the
// bars, the bond, mark, wary, haste and ward auras, `spellfx` with the cast
// ids), so the online client mirrors it with no wire change.

import { BEAST_PITS } from '../../content/wildheart_basin_layout';
import { emitMobYell } from '../../mob/yells';
import { combatProfileForMob } from '../../mob_combat';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { addThreat } from '../../threat';
import {
  type BeastmasterFightState,
  DT,
  dist2d,
  type Entity,
  type JaguarFightState,
} from '../../types';
import {
  arenaPlayers,
  claimPlayers,
  clearCastIf,
  dropAuraById,
  grantClaimDeed,
  holdPlanted,
  mechanicDamage,
  pickHuntMark,
  placeAt,
  runAlone,
  startBar,
  tankOf,
} from './claim';
import {
  BEAST_CALL_OF_THE_HUNT,
  BEAST_HEEL,
  BEAST_JAGUAR_BITE,
  BEAST_PACK_BOND,
  BEAST_PACK_BOND_FURY,
  BEAST_PIT_QUAKE,
  BEAST_RENDING_BITE,
  BEAST_STALKED,
  BEAST_THICKHIDE_WARD,
  BEAST_WARY_AURA,
  BEASTMASTER_DEED,
  BEASTMASTER_LINES,
  bondReachFor,
  controlGroupOf,
  BEAST_TUNING as T,
} from './ids';

type Group = keyof JaguarFightState['windows'];
const GROUPS: readonly Group[] = ['stun', 'root', 'slow'];

function freshState(jaguar: Entity, pool: number, timers: boolean): BeastmasterFightState {
  const off = timers ? 0 : 99;
  return {
    kind: 'beastmaster',
    jaguarId: jaguar.id,
    pool,
    quakeTimer: T.quakeFirst + off,
    huntTimer: T.huntFirst + off,
    wardTimer: T.wardFirst + off,
    heelTimer: T.heelFirst + off,
    plantedAt: null,
    preyId: null,
    waitAt: null,
    stalkTimer: timers ? T.stalkFirst : 0,
    biteTimer: T.biteEvery,
    heelFrom: null,
    bonded: false,
    bondSeconds: 0,
    casts: 0,
  };
}

/** The jaguar's control windows (created with the pair's fight). */
export function jaguarState(jaguar: Entity): JaguarFightState {
  if (jaguar.wildheartFight?.kind !== 'jaguar')
    jaguar.wildheartFight = { kind: 'jaguar', windows: { stun: 0, root: 0, slow: 0 } };
  return jaguar.wildheartFight;
}

/** The pair's fight state on the Beastmaster, started on its first engaged
 *  tick (a dev trigger starts it with its clocks parked). One pool from here:
 *  the jaguar takes the master's health and size. */
export function beastState(
  ctx: SimContext,
  bm: Entity,
  jaguar: Entity,
  timers = true,
): BeastmasterFightState {
  if (bm.wildheartFight?.kind === 'beastmaster') return bm.wildheartFight;
  jaguar.maxHp = bm.maxHp;
  const pool = Math.max(1, Math.min(bm.hp, jaguar.hp, bm.maxHp));
  bm.hp = pool;
  jaguar.hp = pool;
  const st = freshState(jaguar, pool, timers);
  bm.wildheartFight = st;
  jaguarState(jaguar);
  emitMobYell(ctx, bm, BEASTMASTER_LINES.engage);
  return st;
}

/** The highest-threat living attacker of either body (the kill's credit). */
function topAttacker(ctx: SimContext, a: Entity, b: Entity): Entity | null {
  let best: Entity | null = null;
  let bestT = -1;
  for (const mob of [a, b]) {
    for (const [id, t] of mob.threat) {
      const e = ctx.entities.get(id);
      if (!e || e.dead || t <= bestT) continue;
      best = e;
      bestT = t;
    }
  }
  return best;
}

/** One pool: whatever either body lost (or gained) since the last sync comes
 *  off (or onto) the pool, and both bodies read it. Returns the pool. */
export function syncPool(st: BeastmasterFightState, bm: Entity, jaguar: Entity): number {
  const pool = Math.max(0, Math.min(bm.maxHp, bm.hp + jaguar.hp - st.pool));
  st.pool = pool;
  if (!bm.dead) bm.hp = pool;
  if (!jaguar.dead) jaguar.hp = pool;
  return pool;
}

/** The pool ran dry or one body fell: the other falls with it. */
function fellTogether(ctx: SimContext, bm: Entity, jaguar: Entity): void {
  const killer = topAttacker(ctx, bm, jaguar);
  for (const e of [bm, jaguar]) {
    if (e.dead) continue;
    e.hp = 0;
    ctx.handleDeath(e, killer);
  }
}

function applyBond(ctx: SimContext, e: Entity, src: Entity): void {
  if (!e.auras.some((a) => a.id === BEAST_PACK_BOND)) {
    ctx.applyAura(e, {
      id: BEAST_PACK_BOND,
      name: 'Pack Bond',
      kind: 'buff_dr',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: T.bondDr,
      sourceId: src.id,
      school: 'nature',
      undispellable: true,
    });
  }
  if (!e.auras.some((a) => a.id === BEAST_PACK_BOND_FURY)) {
    ctx.applyAura(e, {
      id: BEAST_PACK_BOND_FURY,
      name: 'Pack Bond',
      kind: 'buff_dmg_done',
      remaining: 3600,
      duration: 3600,
      permanent: true,
      value: T.bondDamage,
      sourceId: src.id,
      school: 'nature',
      undispellable: true,
    });
  }
}

function dropBond(e: Entity): void {
  dropAuraById(e, BEAST_PACK_BOND);
  dropAuraById(e, BEAST_PACK_BOND_FURY);
}

/** Pack Bond: on while they stand within reach. Returns whether it holds. */
function stepBond(
  ctx: SimContext,
  inst: InstanceSlot,
  st: BeastmasterFightState,
  bm: Entity,
  jaguar: Entity,
): boolean {
  const bonded = dist2d(bm.pos, jaguar.pos) <= bondReachFor(inst.difficulty === 'heroic');
  if (bonded) {
    applyBond(ctx, bm, jaguar);
    applyBond(ctx, jaguar, bm);
    st.bondSeconds += DT;
  } else if (st.bonded) {
    dropBond(bm);
    dropBond(jaguar);
  }
  st.bonded = bonded;
  return bonded;
}

/** The pits' players (a margin past the rim, or `extra` yards further): the
 *  jaguar never hunts anyone who left the pits. */
function pitPlayers(ctx: SimContext, inst: InstanceSlot, extra = 0): Entity[] {
  return arenaPlayers(
    ctx,
    inst,
    claimPlayers(ctx, inst),
    BEAST_PITS.x,
    BEAST_PITS.z,
    BEAST_PITS.r + 12 + extra,
  );
}

/** Whom the jaguar may stalk: the pits' players, NEVER the master's tank
 *  while the run holds anyone else. With nobody but the tank in the pits it
 *  looks further out (the rest standing back, within `stalkFarReach` more);
 *  empty when nobody can be had (it waits). Alone, the lone player is all
 *  there is: the jaguar stalks them. */
export function stalkCandidates(ctx: SimContext, inst: InstanceSlot, bm: Entity): Entity[] {
  const alone = runAlone(ctx, inst);
  const tank = alone ? null : tankOf(ctx, bm);
  const near = pitPlayers(ctx, inst).filter((p) => p.id !== tank?.id);
  if (near.length > 0 || alone) return near;
  return pitPlayers(ctx, inst, T.stalkFarReach).filter((p) => p.id !== tank?.id);
}

/** A group's tank stands within the jaguar's hunting reach of the pits. */
function tankNearPits(ctx: SimContext, inst: InstanceSlot, bm: Entity): boolean {
  if (runAlone(ctx, inst)) return false;
  const tank = tankOf(ctx, bm);
  return tank !== null && pitPlayers(ctx, inst, T.stalkFarReach).includes(tank);
}

/** Stalk: the jaguar marks a new prey (never the master's tank while anyone
 *  else is in the run, never the last prey while another can be had).
 *  Returns the prey, or null when nobody can be marked (it waits). */
export function startStalk(
  ctx: SimContext,
  inst: InstanceSlot,
  bm: Entity,
  jaguar: Entity,
  st: BeastmasterFightState,
): Entity | null {
  st.casts++;
  const old = st.preyId !== null ? ctx.entities.get(st.preyId) : undefined;
  if (old) dropAuraById(old, BEAST_STALKED);
  const players = stalkCandidates(ctx, inst, bm);
  const busy = new Set<number>(st.preyId !== null && players.length > 1 ? [st.preyId] : []);
  const prey = pickHuntMark(bm, players, st.casts, busy);
  st.preyId = prey?.id ?? null;
  st.stalkTimer = T.stalkSeconds;
  if (!prey) {
    // Nobody to hunt: it lets the last prey go and holds where it stands.
    if (old && jaguar.forcedTargetId === old.id) {
      jaguar.forcedTargetId = null;
      jaguar.forcedTargetTimer = 0;
    }
    return null;
  }
  st.waitAt = null;
  ctx.applyAura(prey, {
    id: BEAST_STALKED,
    name: 'Stalked',
    kind: 'vulnerability',
    remaining: T.stalkSeconds,
    duration: T.stalkSeconds,
    value: 0,
    sourceId: jaguar.id,
    school: 'physical',
    undispellable: true,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: jaguar.id,
    targetId: prey.id,
    school: 'physical',
    fx: 'windup',
    ability: BEAST_STALKED,
  });
  addThreat(jaguar, prey.id, 1);
  jaguar.forcedTargetId = prey.id;
  jaguar.forcedTargetTimer = T.stalkSeconds;
  jaguar.aggroTargetId = prey.id;
  if (jaguar.aiState === 'attack' || jaguar.aiState === 'idle') jaguar.aiState = 'chase';
  jaguar.inCombat = true;
  return prey;
}

/** The jaguar bites its prey (120 to 150 and a bleed). */
function bite(ctx: SimContext, jaguar: Entity, prey: Entity): void {
  jaguar.facing = Math.atan2(prey.pos.x - jaguar.pos.x, prey.pos.z - jaguar.pos.z);
  ctx.emit({
    type: 'spellfx',
    sourceId: jaguar.id,
    targetId: prey.id,
    school: 'physical',
    fx: 'nova',
    ability: BEAST_JAGUAR_BITE,
  });
  ctx.dealDamage(
    jaguar,
    prey,
    mechanicDamage(ctx, jaguar, T.biteMin, T.biteMax),
    false,
    'physical',
    'Jaguar Bite',
    'hit',
    true,
  );
  if (prey.dead) return;
  ctx.applyAura(prey, {
    id: BEAST_RENDING_BITE,
    name: 'Rending Bite',
    kind: 'dot',
    remaining: T.bleedSeconds,
    duration: T.bleedSeconds,
    value: Math.max(1, Math.round(T.bleedPerTick * (jaguar.mechanicDamageMult ?? 1))),
    tickInterval: T.bleedInterval,
    tickTimer: T.bleedInterval,
    sourceId: jaguar.id,
    school: 'physical',
  });
}

/** Stalk each tick: keep the fixate, re-mark when the hunt runs out or the
 *  prey falls, and bite in reach. The jaguar's own swings are its bites. */
function stepStalk(
  ctx: SimContext,
  inst: InstanceSlot,
  bm: Entity,
  jaguar: Entity,
  st: BeastmasterFightState,
): void {
  jaguar.swingTimer = Math.max(jaguar.swingTimer, 0.5);
  if (jaguar.castingAbility === BEAST_HEEL) return;
  st.stalkTimer -= DT;
  const prey = st.preyId !== null ? ctx.entities.get(st.preyId) : undefined;
  const present = prey && !prey.dead && stalkCandidates(ctx, inst, bm).includes(prey);
  if (!present || st.stalkTimer <= 0) {
    // Waiting with nobody to stalk: only mark again once someone can be had
    // (the hash salt stays put while it waits).
    const idle = st.preyId === null && st.waitAt !== null;
    if (
      (!idle || stalkCandidates(ctx, inst, bm).length > 0) &&
      startStalk(ctx, inst, bm, jaguar, st)
    )
      return;
    // Nobody it may hunt but the tank near the pits (a group): it holds its
    // ground, never closing on the tank (its swings are held above), and
    // looks again next tick. With nobody near the pits at all (a chain pull
    // from afar) its own pursuit stands.
    if (tankNearPits(ctx, inst, bm)) {
      if (st.waitAt === null) st.waitAt = { ...jaguar.pos };
      holdPlanted(ctx, jaguar, st.waitAt);
    } else st.waitAt = null;
    return;
  }
  if (!prey) return;
  // Hold the fixate against a taunt (the jaguar ignores them) or a blip.
  jaguar.forcedTargetId = prey.id;
  jaguar.forcedTargetTimer = Math.max(st.stalkTimer, DT * 2);
  jaguar.aggroTargetId = prey.id;
  const quick = jaguar.auras.some((a) => a.id === BEAST_CALL_OF_THE_HUNT) ? T.huntHaste : 1;
  st.biteTimer -= DT * quick;
  if (st.biteTimer > 0 || ctx.isStunned(jaguar)) return;
  const reach = combatProfileForMob(jaguar.templateId, jaguar.scale).meleeRange + 0.5;
  if (dist2d(jaguar.pos, prey.pos) > reach) return;
  st.biteTimer = T.biteEvery;
  bite(ctx, jaguar, prey);
}

/** Tick the jaguar's control windows and show them as its Wary auras. A
 *  window opens on the first control of its kind seen ON the jaguar (so a
 *  control another guard refused never spends it); while it is open the aura
 *  gate (control_gate.ts) turns that kind away. */
function stepWindows(ctx: SimContext, jaguar: Entity): void {
  const js = jaguarState(jaguar);
  for (const a of jaguar.auras) {
    if (a.sourceId === jaguar.id) continue;
    const g = controlGroupOf(a.kind);
    if (g && js.windows[g] <= 0) js.windows[g] = T.controlWindow + DT;
  }
  for (const g of GROUPS) {
    const left = Math.max(0, js.windows[g] - DT);
    js.windows[g] = left;
    const id = BEAST_WARY_AURA[g];
    const have = jaguar.auras.find((a) => a.id === id);
    if (left <= 0) {
      if (have) dropAuraById(jaguar, id);
      continue;
    }
    if (have) {
      have.remaining = left;
      continue;
    }
    ctx.applyAura(jaguar, {
      id,
      name: g === 'stun' ? 'Wary of Stuns' : g === 'root' ? 'Wary of Roots' : 'Wary of Slows',
      kind: 'buff_dr',
      remaining: left,
      duration: T.controlWindow,
      value: 0,
      sourceId: jaguar.id,
      school: 'nature',
      undispellable: true,
    });
  }
}

/** Start a Beast Pit Quake. Returns true when it started. */
export function startQuake(bm: Entity, st: BeastmasterFightState): boolean {
  if (bm.castingAbility !== null) return false;
  st.casts++;
  st.quakeTimer = T.quakeEvery;
  st.plantedAt = { ...bm.pos };
  startBar(bm, BEAST_PIT_QUAKE, T.quakeCast, null);
  return true;
}

/** The quake lands: everyone within 8 yd of him. Returns how many it struck. */
function landQuake(ctx: SimContext, inst: InstanceSlot, bm: Entity): number {
  ctx.emit({
    type: 'spellfx',
    sourceId: bm.id,
    targetId: bm.id,
    school: 'physical',
    fx: 'nova',
    ability: BEAST_PIT_QUAKE,
  });
  let n = 0;
  for (const p of claimPlayers(ctx, inst)) {
    if (dist2d(p.pos, bm.pos) > T.quakeRadius) continue;
    ctx.dealDamage(
      bm,
      p,
      mechanicDamage(ctx, bm, T.quakeMin, T.quakeMax),
      false,
      'physical',
      'Beast Pit Quake',
      'hit',
      true,
    );
    n++;
  }
  return n;
}

/** Call of the Hunt: both beasts attack faster for 7 s. */
export function callOfTheHunt(
  ctx: SimContext,
  bm: Entity,
  jaguar: Entity,
  st: BeastmasterFightState,
): void {
  st.huntTimer = T.huntEvery;
  for (const e of [bm, jaguar]) {
    if (e.dead) continue;
    ctx.applyAura(e, {
      id: BEAST_CALL_OF_THE_HUNT,
      name: 'Call of the Hunt',
      kind: 'buff_haste',
      remaining: T.huntSeconds,
      duration: T.huntSeconds,
      value: T.huntHaste,
      sourceId: bm.id,
      school: 'physical',
    });
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: bm.id,
    targetId: bm.id,
    school: 'physical',
    fx: 'nova',
    ability: BEAST_CALL_OF_THE_HUNT,
  });
}

/** Thickhide Ward: an absorb shield on the jaguar. */
export function thickhideWard(
  ctx: SimContext,
  inst: InstanceSlot,
  bm: Entity,
  jaguar: Entity,
  st: BeastmasterFightState,
): void {
  st.wardTimer = T.wardEvery;
  if (jaguar.dead) return;
  ctx.applyAura(jaguar, {
    id: BEAST_THICKHIDE_WARD,
    name: 'Thickhide Ward',
    kind: 'absorb',
    remaining: T.wardSeconds,
    duration: T.wardSeconds,
    value: inst.difficulty === 'heroic' ? T.heroicWardAmount : T.wardAmount,
    sourceId: bm.id,
    school: 'nature',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: bm.id,
    targetId: jaguar.id,
    school: 'nature',
    fx: 'nova',
    ability: BEAST_THICKHIDE_WARD,
  });
}

/** Heroic Heel!: the jaguar crouches for its leap home. Returns true when the
 *  bar started. */
export function startHeel(
  ctx: SimContext,
  bm: Entity,
  jaguar: Entity,
  st: BeastmasterFightState,
): boolean {
  st.heelTimer = T.heelEvery;
  if (jaguar.castingAbility !== null || ctx.isStunned(jaguar)) return false;
  st.casts++;
  st.heelFrom = { ...jaguar.pos };
  startBar(jaguar, BEAST_HEEL, T.heelCast, bm.id);
  emitMobYell(ctx, bm, BEASTMASTER_LINES.heel);
  return true;
}

/** The leap lands: the jaguar at its master's side, facing out. */
function landHeel(ctx: SimContext, bm: Entity, jaguar: Entity): void {
  const away = Math.atan2(jaguar.pos.x - bm.pos.x, jaguar.pos.z - bm.pos.z);
  placeAt(ctx, jaguar, bm.pos.x + Math.sin(away) * 4, bm.pos.z + Math.cos(away) * 4);
  jaguar.facing = away;
  ctx.emit({
    type: 'spellfx',
    sourceId: jaguar.id,
    targetId: jaguar.id,
    school: 'physical',
    fx: 'nova',
    ability: BEAST_HEEL,
  });
}

/** The Heel! bar in flight. Returns true while the jaguar is held by it. */
function stepHeel(ctx: SimContext, bm: Entity, jaguar: Entity, st: BeastmasterFightState): boolean {
  if (jaguar.castingAbility !== BEAST_HEEL) return false;
  // A stun on the crouching jaguar stops the leap.
  if (ctx.isStunned(jaguar)) {
    clearCastIf(jaguar, BEAST_HEEL);
    st.heelFrom = null;
    return false;
  }
  if (st.heelFrom) holdPlanted(ctx, jaguar, st.heelFrom);
  jaguar.castRemaining = Math.max(0, jaguar.castRemaining - DT);
  if (jaguar.castRemaining > 0) return true;
  clearCastIf(jaguar, BEAST_HEEL);
  st.heelFrom = null;
  landHeel(ctx, bm, jaguar);
  return false;
}

/** The pull ended (a kill, an evade, a wipe): every mark, bond, ward and bar
 *  goes, and the jaguar lets its prey go. */
function endBeastFight(ctx: SimContext, bm: Entity, jaguar: Entity | null): void {
  const st = bm.wildheartFight?.kind === 'beastmaster' ? bm.wildheartFight : null;
  if (st?.preyId !== null && st?.preyId !== undefined) {
    const prey = ctx.entities.get(st.preyId);
    if (prey) dropAuraById(prey, BEAST_STALKED);
  }
  dropBond(bm);
  clearCastIf(bm, BEAST_PIT_QUAKE);
  bm.wildheartFight = undefined;
  if (!jaguar) return;
  dropBond(jaguar);
  for (const g of GROUPS) dropAuraById(jaguar, BEAST_WARY_AURA[g]);
  clearCastIf(jaguar, BEAST_HEEL);
  jaguar.forcedTargetId = null;
  jaguar.forcedTargetTimer = 0;
  jaguar.wildheartFight = undefined;
}

/** One tick of the pair (after the mob AI). `engaged`: either body is in its
 *  fight. */
export function tickBeastmaster(
  ctx: SimContext,
  inst: InstanceSlot,
  bm: Entity,
  jaguar: Entity | null,
  engaged: boolean,
): void {
  const live = bm.wildheartFight?.kind === 'beastmaster' ? bm.wildheartFight : null;
  if (jaguar && bm.dead !== jaguar.dead) {
    // One pool: one body down means both are down.
    if (live) syncPool(live, bm, jaguar);
    fellTogether(ctx, bm, jaguar);
  }
  if (bm.dead) {
    if (live) {
      if (live.bondSeconds < T.bondDeedSeconds) grantClaimDeed(ctx, inst, BEASTMASTER_DEED);
      emitMobYell(ctx, bm, BEASTMASTER_LINES.death);
      endBeastFight(ctx, bm, jaguar);
    }
    return;
  }
  if (!jaguar) return;
  // One pool: a body walking home ends the pair's pull for both (its reset
  // to full must never refill the pool while the other still fights).
  const homeward = bm.aiState === 'evade' || jaguar.aiState === 'evade';
  if (!engaged || (live && homeward)) {
    if (live) {
      endBeastFight(ctx, bm, jaguar);
      for (const e of [bm, jaguar]) {
        if (e.aiState === 'evade') continue;
        e.inCombat = false;
        e.aggroTargetId = null;
        e.aiState = 'evade';
      }
    }
    return;
  }
  const st = beastState(ctx, bm, jaguar);
  if (syncPool(st, bm, jaguar) <= 0) {
    fellTogether(ctx, bm, jaguar);
    return;
  }
  stepBond(ctx, inst, st, bm, jaguar);
  stepWindows(ctx, jaguar);
  const heeling = stepHeel(ctx, bm, jaguar, st);
  if (!heeling) stepStalk(ctx, inst, bm, jaguar, st);
  st.huntTimer -= DT;
  if (st.huntTimer <= 0) callOfTheHunt(ctx, bm, jaguar, st);
  st.wardTimer -= DT;
  if (st.wardTimer <= 0) thickhideWard(ctx, inst, bm, jaguar, st);
  if (inst.difficulty === 'heroic' && !heeling) {
    st.heelTimer -= DT;
    if (st.heelTimer <= 0) startHeel(ctx, bm, jaguar, st);
  }
  // The master's own bar: the quake.
  if (bm.castingAbility === BEAST_PIT_QUAKE) {
    if (st.plantedAt) holdPlanted(ctx, bm, st.plantedAt);
    bm.swingTimer = Math.max(bm.swingTimer, 0.6);
    bm.castRemaining = Math.max(0, bm.castRemaining - DT);
    if (bm.castRemaining > 0) return;
    clearCastIf(bm, BEAST_PIT_QUAKE);
    st.plantedAt = null;
    landQuake(ctx, inst, bm);
    return;
  }
  st.quakeTimer -= DT;
  if (st.quakeTimer <= 0 && bm.castingAbility === null && !ctx.isStunned(bm)) startQuake(bm, st);
}
