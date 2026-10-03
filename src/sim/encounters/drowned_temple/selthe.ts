// Choirmother Selthe in the Choir Court (docs/design/dungeon-rework/
// drowned_temple.md, "Boss 1"): stack for Chorus, spread for Solo (G16 marks).
//
//   Chorus      every 25 s (first at 10 s) one player is marked for 5 s; on
//               expiry 400 frost is SPLIT among everyone within 6 yd of the
//               mark. Five share it easily; alone it is most of a cloth health.
//   Solo        every 25 s, 12 s after each Chorus, one player is marked for
//               5 s; on expiry 150 frost hits the mark AND everyone within 8 yd.
//   Sea-Song    every 10 s a 1.5 s bar, then 35 to 45 frost to the whole court.
//   Tidal Slap  every 15 s a 1 s bar on the tank, then a slap that throws them
//               8 yd back.
//   Heroic      Duet: Chorus and Solo land together on two players. Echo: each
//               mark resolves again at the same spot 4 s later.
//
// Zero rng in every pick (the marks' victims are hashed); the only draws are
// the damage rolls.

import { applyKnockback } from '../../knockback';
import { kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type SeltheFightState } from '../../types';
import {
  claimPlayers,
  clearCastOf,
  dropEncounterObject,
  grantClaimDeed,
  mechanicDamage,
  spawnTempleObject,
  startCast,
} from './claim';
import {
  CHORUS_ECHO_TEMPLATE,
  COURT,
  chorusShare,
  SELTHE_CHORUS_BURST,
  SELTHE_CHORUS_MARK,
  SELTHE_ECHO_BURST,
  SELTHE_SEA_SONG,
  SELTHE_SOLO_BURST,
  SELTHE_SOLO_MARK,
  SELTHE_TIDAL_SLAP,
  SELTHE_TUNING,
  SOLO_ECHO_TEMPLATE,
} from './ids';

const T = SELTHE_TUNING;
export const SELTHE_DEED = 'dgn_selthe_pitch';

function freshState(heroic: boolean): SeltheFightState {
  return {
    kind: 'selthe',
    chorusTimer: T.chorusFirst,
    // Heroic Duet: the Solo lands with the Chorus.
    soloTimer: heroic ? T.chorusFirst : T.chorusFirst + T.soloOffset,
    songTimer: T.songFirst,
    slapTimer: T.slapFirst,
    marks: [],
    echoes: [],
    casts: 0,
    flubbed: false,
  };
}

/** Players in the court (the arena and a margin round its rim). */
function courtPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  return claimPlayers(ctx, inst).filter(
    (p) => Math.hypot(p.pos.x - o.x - COURT.x, p.pos.z - o.z - COURT.z) <= COURT.r + 12,
  );
}

/** A mark's victim: a hashed pick among the court's players, leaving out the
 *  tank and any player already marked, unless nobody else is there. */
export function pickMarkTarget(
  players: readonly Entity[],
  boss: Entity,
  salt: number,
  exclude: readonly number[],
): Entity | null {
  const living = players.filter((p) => !p.dead);
  if (living.length === 0) return null;
  const free = living.filter((p) => !exclude.includes(p.id));
  const others = free.filter((p) => p.id !== boss.aggroTargetId);
  const pool = others.length > 0 ? others : free.length > 0 ? free : living;
  return pool[kitHash(boss.id, salt) % pool.length];
}

function markPlayer(
  ctx: SimContext,
  boss: Entity,
  st: SeltheFightState,
  p: Entity,
  mark: 'chorus' | 'solo',
): void {
  const id = mark === 'chorus' ? SELTHE_CHORUS_MARK : SELTHE_SOLO_MARK;
  ctx.applyAura(p, {
    id,
    name: mark === 'chorus' ? 'Chorus' : 'Solo',
    // A mark, not a slow: the value leaves the runner at full speed.
    kind: 'slow',
    remaining: T.markSeconds,
    duration: T.markSeconds,
    value: 1,
    sourceId: boss.id,
    school: 'frost',
    undispellable: true,
  });
  st.marks.push({ mark, playerId: p.id, remaining: T.markSeconds });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'windup',
    ability: id,
  });
}

/** Mark a Chorus (and, on the Duet, a Solo on someone else at once). */
export function startChorus(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): boolean {
  const players = courtPlayers(ctx, inst);
  const taken = st.marks.map((m) => m.playerId);
  st.casts++;
  const p = pickMarkTarget(players, boss, st.casts * 7 + 1, taken);
  if (!p) return false;
  markPlayer(ctx, boss, st, p, 'chorus');
  return true;
}

export function startSolo(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): boolean {
  const players = courtPlayers(ctx, inst);
  const taken = st.marks.map((m) => m.playerId);
  st.casts++;
  const p = pickMarkTarget(players, boss, st.casts * 11 + 3, taken);
  if (!p) return false;
  markPlayer(ctx, boss, st, p, 'solo');
  return true;
}

/** A mark runs out where its player stands. */
function resolveMark(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
  mark: 'chorus' | 'solo',
  victim: Entity,
): void {
  const players = claimPlayers(ctx, inst).filter((p) => !p.dead);
  const radius = mark === 'chorus' ? T.chorusRadius : T.soloRadius;
  const caught = players.filter((p) => dist2d(p.pos, victim.pos) <= radius);
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: victim.id,
    school: 'frost',
    fx: 'nova',
    ability: mark === 'chorus' ? SELTHE_CHORUS_BURST : SELTHE_SOLO_BURST,
  });
  if (mark === 'chorus') {
    if (caught.length <= 1) st.flubbed = true;
    const share = chorusShare(T.chorusTotal, Math.max(1, caught.length));
    for (const p of caught) {
      const amount = Math.max(1, Math.round(share * (boss.mechanicDamageMult ?? 1)));
      ctx.dealDamage(boss, p, amount, false, 'frost', 'Chorus', 'hit', true);
    }
  } else {
    if (caught.some((p) => p.id !== victim.id)) st.flubbed = true;
    for (const p of caught) {
      const amount = Math.max(1, Math.round(T.soloDamage * (boss.mechanicDamageMult ?? 1)));
      ctx.dealDamage(boss, p, amount, false, 'frost', 'Solo', 'hit', true);
    }
  }
  // Echo (heroic): the conch sings the mark again where it fell.
  if (inst.difficulty === 'heroic') {
    const o = ctx.instanceOriginOf(inst);
    const x = victim.pos.x - o.x;
    const z = victim.pos.z - o.z;
    const obj = spawnTempleObject(
      ctx,
      inst,
      mark === 'chorus' ? CHORUS_ECHO_TEMPLATE : SOLO_ECHO_TEMPLATE,
      mark === 'chorus' ? 'Chorus Echo' : 'Solo Echo',
      x,
      z,
      radius,
    );
    st.echoes.push({ mark, x, z, remaining: T.echoAfter, objectId: obj.id });
  }
}

function stepMarks(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: SeltheFightState): void {
  for (let i = st.marks.length - 1; i >= 0; i--) {
    const m = st.marks[i];
    m.remaining -= DT;
    if (m.remaining > 0) continue;
    st.marks.splice(i, 1);
    const victim = ctx.entities.get(m.playerId);
    if (victim && !victim.dead) resolveMark(ctx, inst, boss, st, m.mark, victim);
  }
  const o = ctx.instanceOriginOf(inst);
  for (let i = st.echoes.length - 1; i >= 0; i--) {
    const e = st.echoes[i];
    e.remaining -= DT;
    if (e.remaining > 0) continue;
    st.echoes.splice(i, 1);
    const radius = e.mark === 'chorus' ? T.chorusRadius : T.soloRadius;
    const base = e.mark === 'chorus' ? T.chorusEchoDamage : T.soloDamage;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: e.objectId,
      school: 'frost',
      fx: 'nova',
      ability: SELTHE_ECHO_BURST,
    });
    for (const p of claimPlayers(ctx, inst)) {
      if (p.dead || Math.hypot(p.pos.x - o.x - e.x, p.pos.z - o.z - e.z) > radius) continue;
      const amount = Math.max(1, Math.round(base * (boss.mechanicDamageMult ?? 1)));
      ctx.dealDamage(boss, p, amount, false, 'frost', 'Echo', 'hit', true);
    }
    dropEncounterObject(ctx, inst, e.objectId);
  }
}

function stepCasts(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: SeltheFightState): void {
  if (boss.castingAbility === SELTHE_SEA_SONG || boss.castingAbility === SELTHE_TIDAL_SLAP) {
    boss.swingTimer = Math.max(boss.swingTimer, 0.6);
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    const castId = boss.castingAbility;
    const targetId = boss.castTargetId;
    clearCastOf(boss, castId);
    if (castId === SELTHE_SEA_SONG) {
      ctx.emit({
        type: 'spellfx',
        sourceId: boss.id,
        targetId: boss.id,
        school: 'frost',
        fx: 'nova',
        ability: SELTHE_SEA_SONG,
      });
      for (const p of courtPlayers(ctx, inst)) {
        if (p.dead) continue;
        ctx.dealDamage(
          boss,
          p,
          mechanicDamage(ctx, boss, T.songMin, T.songMax),
          false,
          'frost',
          'Sea-Song',
          'hit',
          true,
        );
      }
      return;
    }
    const tank = targetId !== null ? ctx.entities.get(targetId) : undefined;
    if (!tank || tank.dead || dist2d(tank.pos, boss.pos) > 9) return;
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: tank.id,
      school: 'frost',
      fx: 'nova',
      ability: SELTHE_TIDAL_SLAP,
    });
    ctx.dealDamage(
      boss,
      tank,
      mechanicDamage(ctx, boss, T.slapMin, T.slapMax),
      false,
      'frost',
      'Tidal Slap',
      'hit',
      true,
    );
    if (!tank.dead) applyKnockback(ctx, boss, tank, T.slapKnockback);
    return;
  }
  if (ctx.isStunned(boss) || boss.castingAbility !== null) return;
  st.songTimer -= DT;
  st.slapTimer -= DT;
  if (st.slapTimer <= 0 && boss.aggroTargetId !== null) {
    st.slapTimer = T.slapEvery;
    startCast(boss, SELTHE_TIDAL_SLAP, T.slapCast, boss.aggroTargetId);
    return;
  }
  if (st.songTimer <= 0) {
    st.songTimer = T.songEvery;
    startCast(boss, SELTHE_SEA_SONG, T.songCast, null);
  }
}

/** The fight ended: the marks fade and the echoes still ringing fall silent. */
export function resetSelthe(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
  const st = boss.templeFight?.kind === 'selthe' ? boss.templeFight : null;
  if (st) {
    for (const m of st.marks) {
      const p = ctx.entities.get(m.playerId);
      if (p)
        p.auras = p.auras.filter((a) => a.id !== SELTHE_CHORUS_MARK && a.id !== SELTHE_SOLO_MARK);
    }
    for (const e of st.echoes) dropEncounterObject(ctx, inst, e.objectId);
  }
  clearCastOf(boss, SELTHE_SEA_SONG);
  clearCastOf(boss, SELTHE_TIDAL_SLAP);
  boss.templeFight = undefined;
}

/** One tick of Selthe's fight. */
export function tickSelthe(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  engaged: boolean,
): void {
  let st = boss.templeFight?.kind === 'selthe' ? boss.templeFight : null;
  if (boss.dead) {
    if (st) {
      if (!st.flubbed) grantClaimDeed(ctx, inst, SELTHE_DEED);
      resetSelthe(ctx, inst, boss);
    }
    return;
  }
  if (!engaged) {
    if (st) resetSelthe(ctx, inst, boss);
    return;
  }
  if (!st) {
    st = freshState(inst.difficulty === 'heroic');
    boss.templeFight = st;
  }
  stepMarks(ctx, inst, boss, st);
  st.chorusTimer -= DT;
  st.soloTimer -= DT;
  if (st.chorusTimer <= 0) {
    st.chorusTimer = T.chorusEvery;
    startChorus(ctx, inst, boss, st);
  }
  if (st.soloTimer <= 0) {
    st.soloTimer = T.chorusEvery;
    startSolo(ctx, inst, boss, st);
  }
  stepCasts(ctx, inst, boss, st);
}
