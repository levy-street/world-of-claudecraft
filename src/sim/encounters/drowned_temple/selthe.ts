// Choirmother Selthe in the Choir Court (docs/design/dungeon-rework/
// drowned_temple.md, "Boss 1"): stack for Chorus, spread for Solo (G16 marks).
// The caster pass: she never leaves her pool and never swings her hands; she
// fights with water (the numbers and their math: ids.ts SELTHE_TUNING).
//
//   Chorus          every 25 s (first at 10 s) one player is marked for 5 s;
//                   on expiry 400 frost is SPLIT among everyone within 6 yd of
//                   the mark. Five share it easily; alone it is most of a
//                   cloth health.
//   Solo            every 25 s, 12 s after each Chorus, one player is marked
//                   for 5 s; on expiry 150 frost hits the mark AND everyone
//                   within 8 yd.
//   Sea-Song        every 10 s a 1.5 s bar, then 35 to 45 frost to the whole
//                   court.
//   Moonwater Bolt  her filler between bars: a 2 s bar on her foe (the tank),
//                   one weapon roll x 0.8 of frost. Kickable.
//   Drowning Aria   every 22 s (first at 16 s) a 5 s sung beam on one player
//                   who is not the tank: a pulse a second, each 10 harder than
//                   the last on the same body. Kick it, break her sight of the
//                   target, or step into it (the first body on the beam's line
//                   catches the pulse, and the climb starts over).
//   Mere Surge      every 18 s (first at 12 s) a 3 s bar facing one player,
//                   then a wave crashes through a 60 degree wedge to 30 yd:
//                   110 to 130 frost and an 8 yd shove. Step out sideways.
//   Kicks           a cut bolt or aria silences her bolts and arias for 3 s.
//   Heroic          Duet: Chorus and Solo land together on two players. Echo:
//                   each mark resolves again at the same spot 4 s later.
//
// Zero rng in every pick (the marks' and the aria's victims and the surge's
// aim are hashed); the only draws are the damage rolls.

import { isLockedOut } from '../../combat/cc';
import { applyKnockback } from '../../knockback';
import { inCone, kitHash } from '../../mob/trash_kit/targets';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { angleTo, DT, dist2d, type Entity, type SeltheFightState, type Vec3 } from '../../types';
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
  SELTHE_ARIA_BROKEN,
  SELTHE_ARIA_PULSE,
  SELTHE_CHORUS_BURST,
  SELTHE_CHORUS_MARK,
  SELTHE_DROWNING_ARIA,
  SELTHE_ECHO_BURST,
  SELTHE_MERE_SURGE,
  SELTHE_MOONWATER_BOLT,
  SELTHE_SEA_SONG,
  SELTHE_SOLO_BURST,
  SELTHE_SOLO_MARK,
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
    surgeTimer: T.surgeFirst,
    ariaTimer: T.ariaFirst,
    boltGap: 0,
    quiet: 0,
    kickable: null,
    surgeYaw: null,
    aria: null,
    barCasts: 0,
    marks: [],
    echoes: [],
    casts: 0,
    flubbed: false,
  };
}

/** Her own bars (her bolts and arias can be kicked; the rest cannot). */
const SELTHE_CASTS: readonly string[] = [
  SELTHE_SEA_SONG,
  SELTHE_MOONWATER_BOLT,
  SELTHE_DROWNING_ARIA,
  SELTHE_MERE_SURGE,
];

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

/** Is she free to sing a kickable bar (no kick's hush, no school lockout)? */
function canSingKickable(boss: Entity, st: SeltheFightState): boolean {
  return st.quiet <= 0 && !isLockedOut(boss, 'frost');
}

/**
 * Who a Drowning Aria strikes: the first living body standing on the beam's
 * line between her and its target (within `width` of the line, strictly before
 * the target), else the target itself. Pure over positions, so the tests and
 * the renderer agree on the catch.
 */
export function ariaCatcher<P extends { id: number; pos: Vec3; dead: boolean }>(
  from: Vec3,
  target: P,
  bodies: readonly P[],
  width: number,
): P {
  const dx = target.pos.x - from.x;
  const dz = target.pos.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return target;
  const ux = dx / len;
  const uz = dz / len;
  let best = target;
  let bestAlong = len;
  for (const b of bodies) {
    if (b.dead || b.id === target.id) continue;
    const bx = b.pos.x - from.x;
    const bz = b.pos.z - from.z;
    const along = bx * ux + bz * uz;
    if (along <= 0 || along >= bestAlong) continue;
    if (Math.abs(bx * uz - bz * ux) > width) continue;
    best = b;
    bestAlong = along;
  }
  return best;
}

/** A Moonwater Bolt at her foe (the tank), or, when her foe is out of her
 *  sight or reach, at the nearest court player she can see. */
export function startBolt(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): boolean {
  const seen = (p: Entity) =>
    !p.dead && dist2d(p.pos, boss.pos) <= T.boltRange && ctx.hasLineOfSight(boss, p);
  const foe = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : undefined;
  let target: Entity | null = foe && foe.kind === 'player' && seen(foe) ? foe : null;
  if (!target) {
    let bestD = Infinity;
    for (const p of courtPlayers(ctx, inst)) {
      if (!seen(p)) continue;
      const d = dist2d(p.pos, boss.pos);
      if (d < bestD - 1e-9) {
        bestD = d;
        target = p;
      }
    }
  }
  if (!target) return false;
  startCast(boss, SELTHE_MOONWATER_BOLT, T.boltCast, target.id);
  st.kickable = SELTHE_MOONWATER_BOLT;
  return true;
}

function landBolt(ctx: SimContext, boss: Entity, targetId: number | null): void {
  const target = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!target || target.dead) return;
  if (dist2d(target.pos, boss.pos) > T.boltRange || !ctx.hasLineOfSight(boss, target)) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: target.id,
    school: 'frost',
    fx: 'projectile',
    ability: SELTHE_MOONWATER_BOLT,
  });
  // One weapon roll of frost (ids.ts SELTHE_TUNING: the tank-swing floor).
  const roll = ctx.rng.range(boss.weapon.min, boss.weapon.max);
  const amount = Math.max(1, Math.round(roll * T.boltWeaponShare));
  ctx.dealDamage(boss, target, amount, false, 'frost', 'Moonwater Bolt', 'hit', true);
}

/** A Drowning Aria on one court player who is not the tank, in her sight. */
export function startAria(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): boolean {
  const players = courtPlayers(ctx, inst).filter(
    (p) => !p.dead && dist2d(p.pos, boss.pos) <= T.ariaRange && ctx.hasLineOfSight(boss, p),
  );
  st.barCasts++;
  const target = pickMarkTarget(players, boss, st.barCasts * 13 + 5, []);
  if (!target) return false;
  startCast(boss, SELTHE_DROWNING_ARIA, T.ariaChannel, target.id, true);
  boss.facing = angleTo(boss.pos, target.pos);
  boss.prevFacing = boss.facing;
  st.aria = { targetId: target.id, struckId: target.id, streak: 0, pulse: T.ariaPulse };
  st.kickable = SELTHE_DROWNING_ARIA;
  return true;
}

/** The aria ends: sung out, or broken (a cue for the renderer's splash). */
function endAria(ctx: SimContext, boss: Entity, st: SeltheFightState, broken: boolean): void {
  if (broken && st.aria) {
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: st.aria.struckId,
      school: 'frost',
      fx: 'nova',
      ability: SELTHE_ARIA_BROKEN,
    });
  }
  st.aria = null;
  if (st.kickable === SELTHE_DROWNING_ARIA) st.kickable = null;
  clearCastOf(boss, SELTHE_DROWNING_ARIA);
}

function stepAria(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: SeltheFightState): void {
  const a = st.aria;
  if (!a) {
    endAria(ctx, boss, st, false);
    return;
  }
  const target = ctx.entities.get(a.targetId);
  if (
    !target ||
    target.dead ||
    dist2d(target.pos, boss.pos) > T.ariaRange ||
    !ctx.hasLineOfSight(boss, target)
  ) {
    endAria(ctx, boss, st, true);
    return;
  }
  const struck = ariaCatcher(
    boss.pos,
    target,
    claimPlayers(ctx, inst).filter((p) => !p.dead),
    T.ariaCatchWidth,
  );
  if (struck.id !== a.struckId) {
    // A new body in the beam: the climb starts over on it.
    a.struckId = struck.id;
    a.streak = 0;
  }
  boss.castTargetId = struck.id;
  boss.facing = angleTo(boss.pos, target.pos);
  a.pulse -= DT;
  if (a.pulse <= 1e-6) {
    a.pulse += T.ariaPulse;
    a.streak++;
    const base = T.ariaBase + T.ariaStep * (a.streak - 1);
    const amount = Math.max(1, Math.round(base * (boss.mechanicDamageMult ?? 1)));
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: struck.id,
      school: 'frost',
      fx: 'tick',
      ability: SELTHE_ARIA_PULSE,
    });
    ctx.dealDamage(boss, struck, amount, false, 'frost', 'Drowning Aria', 'hit', true);
  }
  boss.castRemaining = Math.max(0, boss.castRemaining - DT);
  if (boss.castRemaining <= 1e-6) endAria(ctx, boss, st, false);
}

/** A Mere Surge aimed at one court player (not the tank while others stand). */
export function startSurge(
  ctx: SimContext,
  inst: InstanceSlot,
  boss: Entity,
  st: SeltheFightState,
): boolean {
  st.barCasts++;
  const victim = pickMarkTarget(courtPlayers(ctx, inst), boss, st.barCasts * 17 + 9, []);
  if (!victim) return false;
  st.surgeYaw = angleTo(boss.pos, victim.pos);
  boss.facing = st.surgeYaw;
  boss.prevFacing = st.surgeYaw;
  startCast(boss, SELTHE_MERE_SURGE, T.surgeCast, victim.id);
  return true;
}

function landSurge(ctx: SimContext, inst: InstanceSlot, boss: Entity, yaw: number): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'frost',
    fx: 'nova',
    ability: SELTHE_MERE_SURGE,
  });
  for (const p of claimPlayers(ctx, inst)) {
    if (p.dead || !inCone(boss.pos, yaw, p.pos, T.surgeRange, T.surgeArcDeg)) continue;
    ctx.dealDamage(
      boss,
      p,
      mechanicDamage(ctx, boss, T.surgeMin, T.surgeMax),
      false,
      'frost',
      'Mere Surge',
      'hit',
      true,
    );
    if (!p.dead) applyKnockback(ctx, boss, p, T.surgeKnockback);
  }
}

function landSong(ctx: SimContext, inst: InstanceSlot, boss: Entity): void {
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
}

const PLAIN_BARS: readonly string[] = [SELTHE_SEA_SONG, SELTHE_MOONWATER_BOLT, SELTHE_MERE_SURGE];

function stepCasts(ctx: SimContext, inst: InstanceSlot, boss: Entity, st: SeltheFightState): void {
  // A kickable bar that is gone before she finished it was cut (a kick): an
  // aria breaks, and she sings no bolt or aria for a moment. The contract:
  // between two passes of this tick only a player interrupt clears her bar
  // (she is CC-immune, mobs take no spell pushback, an evade or a death resets
  // the fight first, and the dev triggers clear `kickable` with the bar), so a
  // new path that cancels her cast must clear `kickable` too.
  if (st.kickable !== null && boss.castingAbility !== st.kickable) {
    if (st.kickable === SELTHE_DROWNING_ARIA) endAria(ctx, boss, st, true);
    st.kickable = null;
    st.quiet = T.kickQuiet;
  }
  st.quiet = Math.max(0, st.quiet - DT);
  // Her timers run under any bar; a mechanic that comes due mid-bar waits for
  // the bar to end (at most a bolt's 2 s) and goes first.
  st.songTimer -= DT;
  st.surgeTimer -= DT;
  st.ariaTimer -= DT;
  const casting = boss.castingAbility;
  if (casting === SELTHE_DROWNING_ARIA) {
    stepAria(ctx, inst, boss, st);
    if (boss.castingAbility === null) st.boltGap = T.boltGap;
    return;
  }
  if (casting !== null && PLAIN_BARS.includes(casting)) {
    if (casting === SELTHE_MERE_SURGE && st.surgeYaw !== null) boss.facing = st.surgeYaw;
    if (casting === SELTHE_MOONWATER_BOLT && boss.castTargetId !== null) {
      const t = ctx.entities.get(boss.castTargetId);
      if (t) boss.facing = angleTo(boss.pos, t.pos);
    }
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining > 0) return;
    const targetId = boss.castTargetId;
    clearCastOf(boss, casting);
    st.boltGap = T.boltGap;
    if (casting === SELTHE_MOONWATER_BOLT) {
      st.kickable = null;
      landBolt(ctx, boss, targetId);
    } else if (casting === SELTHE_MERE_SURGE) {
      landSurge(ctx, inst, boss, st.surgeYaw ?? boss.facing);
      st.surgeYaw = null;
    } else landSong(ctx, inst, boss);
    return;
  }
  if (ctx.isStunned(boss) || casting !== null) return;
  if (st.surgeTimer <= 0) {
    st.surgeTimer = T.surgeEvery;
    if (startSurge(ctx, inst, boss, st)) return;
  }
  if (st.ariaTimer <= 0 && canSingKickable(boss, st)) {
    st.ariaTimer = T.ariaEvery;
    if (startAria(ctx, inst, boss, st)) return;
  }
  if (st.songTimer <= 0) {
    st.songTimer = T.songEvery;
    startCast(boss, SELTHE_SEA_SONG, T.songCast, null);
    return;
  }
  st.boltGap -= DT;
  if (st.boltGap <= 0 && canSingKickable(boss, st)) startBolt(ctx, inst, boss, st);
}

/** She never swings her hands: hold her melee swing off every tick (the mob
 *  AI runs before this pass, so its swing timer never reaches zero). */
function holdHands(boss: Entity): void {
  boss.swingTimer = Math.max(boss.swingTimer, 1);
  boss.autoAttack = false;
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
  for (const id of SELTHE_CASTS) clearCastOf(boss, id);
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
  if (!boss.dead) holdHands(boss);
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
