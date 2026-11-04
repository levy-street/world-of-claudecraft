// The Islands of the Wind (the Guardian of the Breath, docs/design/raid/
// smith_heart.md section 7.2; the owner's idea, approved with the team's
// feedback of 2026-11-03). Every number is breath_isle_ids.ts ISLE_TUNING and
// the tier's row (BREATH_DIFFICULTY `isleAt`, `isleCount`, `windwornSeconds`).
//
//   The round      in the Wind half, at each of the tier's health marks (70
//                  on normal; 80 and 60 on heroic and mythic) the guardian
//                  stops where it stands and raises its Gale Bulwark: an
//                  absorb as big as 7 percent of its health, held by a
//                  channel bar (no swing, no other bar; the wind keeps its
//                  own cycle, Thessaly keeps planting). Normal wakes one isle
//                  (hashed), heroic and mythic both.
//   The isles      each woken isle raises a Gale Sentinel and a Gale Mender.
//                  While ANY of the round's adds lives the Bulwark regrows (5
//                  percent of its whole a second), and every 9 s the Mender
//                  channels Mending Gale into it (a third of its whole back):
//                  a player interrupt cuts it.
//   The ride       a Gale Path stands on the Cornice by the rim facing each
//                  woken isle while its adds live: step in and the wind
//                  carries you on a FIXED scripted arc to the isle (stunned,
//                  carried; no physics, no wind on the way). When the last add
//                  of an isle falls, a Homeward Gale rises on it and carries
//                  whoever steps in back to the Cornice, beside the path.
//                  Heroic: the same group may ride again (to the other isle,
//                  or at the next mark). Mythic: a rider set down home is
//                  Windworn for 150 s (past the next mark) and no Gale Path takes them: two groups.
//   The end        the Bulwark broken, the round ends: any add still standing
//                  dissolves, the paths go, the guardian fights on. Held for
//                  75 s it bursts by itself (a heavy blow on the whole Cornice)
//                  and the round ends the same way: the fight never stalls
//                  (the raid bots do not ride).
//   A wipe         every body on an isle (alive or not) is set back on the
//                  Cornice; nothing of the round stays.
//
// Deterministic: the isle pick is hashed, the riders and the adds are in id
// order; the only rng draws are the damage rolls. Every visible state rides
// existing fields (breath_isle_ids.ts says which): no wire or IWorld change.

import { carryBody, setDownBody } from '../../carried_body';
import { isSilenced } from '../../combat/cc';
import { BREATH_ISLES } from '../../content/smith_heart_layout';
import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../../instances/difficulty';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { clearCastIf, dropEncounterBody, startBar } from '../sunken_bastion/claim';
import { thessalyOf } from './breath_gale';
import { breathHash } from './breath_geometry';
import { isleAt, isleSpots, rideArc } from './breath_isle_geometry';
import { holdIsleAdds } from './breath_isle_hold';
import {
  galePathTemplate,
  homeGaleTemplate,
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_CUES,
  ISLE_MOBS,
  ISLE_NAMES,
  rideTemplate,
  ISLE_TUNING as T,
} from './breath_isle_ids';
import {
  type BreathScope,
  dropAura,
  dropBreathObject,
  guardianFree,
  heldFast,
  livePlayers,
  living,
  local,
  roll,
  spawnBreathObject,
} from './breath_scope';
import type { BreathFightState, BreathIsleAdd, BreathRide } from './breath_state';
import { breathSay } from './breath_voice';

// ---- who stands where -----------------------------------------------------------------------

/** Living players of the claim standing on an isle's floor, with its index
 *  (entity-id order). */
export function islePlayers(ctx: SimContext, inst: InstanceSlot): { p: Entity; isle: number }[] {
  const o = ctx.instanceOriginOf(inst);
  const out: { p: Entity; isle: number }[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost || e.carriedBy !== undefined) continue;
    const i = isleAt(e.pos.x - o.x, e.pos.z - o.z);
    if (i < 0 || Math.abs(e.pos.y - BREATH_ISLES[i].h) > 4) continue;
    out.push({ p: e, isle: i });
  }
  return out.sort((a, b) => a.p.id - b.p.id);
}

/** The round's living adds on isle `i`. */
function livingAdds(s: Pick<BreathScope, 'ctx' | 'st'>, isle?: number): Entity[] {
  const out: Entity[] = [];
  for (const a of s.st.isles.adds) {
    if (isle !== undefined && a.isle !== isle) continue;
    const e = s.ctx.entities.get(a.id);
    if (living(e)) out.push(e);
  }
  return out;
}

function bulwarkOf(b: Entity) {
  return b.auras.find((a) => a.id === ISLE_AURAS.bulwark) ?? null;
}

// ---- the round ------------------------------------------------------------------------------

/** Is a round due now (a mark crossed in the Wind half, the guardian free,
 *  no indrawn breath running)? */
export function islesDue(s: BreathScope): boolean {
  const st = s.st;
  const marks = s.rules.isleAt;
  if (st.half !== 'wind' || st.isles.round || st.isles.next >= marks.length) return false;
  if (st.wind.phase === 'inhale' || st.wind.phase === 'exhale') return false;
  return s.boss.hp <= s.boss.maxHp * marks[st.isles.next] && guardianFree(s);
}

/** The guardian raises its Bulwark and wakes the round's isles. Exported for
 *  the dev trigger (`only`: one isle by index). */
export function startIsles(s: BreathScope, only?: number): boolean {
  const st = s.st;
  const b = s.boss;
  if (st.isles.round || st.half !== 'wind' || !living(b)) return false;
  const frac = b.hp / b.maxHp;
  // Every mark already crossed is spent by this one round.
  const marks = s.rules.isleAt;
  while (st.isles.next < marks.length && frac <= marks[st.isles.next]) st.isles.next++;
  st.casts++;
  const n = BREATH_ISLES.length;
  let isles: number[];
  if (only !== undefined) isles = [((only % n) + n) % n];
  else if (s.rules.isleCount >= n) isles = BREATH_ISLES.map((_, i) => i);
  else isles = [breathHash(b.id, st.casts) % n];
  const whole = Math.round(b.maxHp * T.bulwarkShare);
  st.isles.round = { isles, whole, elapsed: 0, at: { ...b.pos } };
  s.ctx.applyAura(b, {
    id: ISLE_AURAS.bulwark,
    name: ISLE_NAMES.bulwark,
    kind: 'absorb',
    remaining: T.bulwarkMax + 5,
    duration: T.bulwarkMax + 5,
    value: whole,
    value2: whole,
    sourceId: b.id,
    school: 'nature',
    undispellable: true,
  });
  startBar(b, ISLE_CASTS.bulwark, T.bulwarkMax, null, true);
  // Held where it stands: a root of its own (its control immunity lets its
  // own aura in), so the chase's stall clock never walks it home.
  s.ctx.applyAura(b, {
    id: ISLE_AURAS.hold,
    name: ISLE_NAMES.bulwark,
    kind: 'root',
    remaining: T.bulwarkMax + 5,
    duration: T.bulwarkMax + 5,
    value: 0,
    sourceId: b.id,
    school: 'nature',
    unbreakableControl: true,
    undispellable: true,
  });
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'nature',
    fx: 'nova',
    ability: ISLE_CUES.bulwarkUp,
  });
  for (const i of isles) wakeIsle(s, i);
  breathSay(s, b, 'guardian', 'isles');
  breathSay(s, thessalyOf(s.ctx, s.inst), 'thessaly', 'isles');
  return true;
}

/** An isle's adds rise; its Gale Path opens on the Cornice. */
function wakeIsle(s: BreathScope, i: number): void {
  const { ctx, inst } = s;
  const spots = isleSpots()[i];
  const o = ctx.instanceOriginOf(inst);
  const difficulty = inst.difficulty ?? 'normal';
  const hpMult = s.rules.damageMult;
  (['sentinel', 'mender'] as const).forEach((role, k) => {
    const template = MOBS[ISLE_MOBS[role]];
    if (!template) return;
    const at = spots.adds[k];
    const tuned = mobTemplateForDungeonDifficulty(template, inst.dungeonId, difficulty);
    const e = createMob(ctx.nextId++, tuned, tuned.maxLevel, ctx.groundPos(o.x + at.x, o.z + at.z));
    applyDungeonMobTuning(e, inst.dungeonId, difficulty);
    const hp = Math.round((role === 'sentinel' ? T.sentinelHealth : T.menderHealth) * hpMult);
    e.maxHp = hp;
    e.hp = hp;
    e.spawnPos = { ...e.pos };
    e.prevPos = { ...e.pos };
    e.facing = Math.atan2(spots.land.x - at.x, spots.land.z - at.z);
    e.prevFacing = e.facing;
    e.summonedAdd = true;
    e.tappedById = s.boss.tappedById;
    ctx.addEntity(e);
    inst.mobIds.push(e.id);
    s.boss.summonedIds.push(e.id);
    s.st.isles.adds.push({
      id: e.id,
      isle: i,
      role,
      next: T.mendFirst,
      at: null,
      floor: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
    });
  });
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + spots.x,
    z: o.z + spots.z,
    school: 'nature',
    fx: 'burst',
    radius: spots.r,
    ability: ISLE_CUES.isleWake,
  });
  const path = spawnBreathObject(
    ctx,
    inst,
    galePathTemplate(i),
    ISLE_NAMES.path,
    spots.path.x,
    spots.path.z,
    T.circleR,
  );
  s.st.isles.paths.push({ isle: i, objectId: path.id });
}

/** One tick of the round: the guardian held, the Bulwark regrowing while
 *  any add lives, the Menders' channels, the break and the burst. */
function stepRound(s: BreathScope): void {
  const st = s.st;
  const round = st.isles.round;
  if (!round) return;
  const b = s.boss;
  round.elapsed += DT;
  const shield = bulwarkOf(b);
  if (!shield) {
    // Broken: the raid struck it down.
    s.ctx.emit({
      type: 'spellfx',
      sourceId: b.id,
      targetId: b.id,
      school: 'nature',
      fx: 'nova',
      ability: ISLE_CUES.bulwarkBreak,
    });
    breathSay(s, b, 'guardian', 'bulwark');
    endRound(s);
    return;
  }
  if (round.elapsed + 1e-9 >= T.bulwarkMax) {
    burstBulwark(s);
    return;
  }
  // Held where it raised it, channeling, no swing.
  if (b.pos.x !== round.at.x || b.pos.z !== round.at.z) {
    b.pos.x = round.at.x;
    b.pos.y = round.at.y;
    b.pos.z = round.at.z;
    s.ctx.rebucket(b);
  }
  b.swingTimer = Math.max(b.swingTimer, 0.6);
  if (b.castingAbility !== ISLE_CASTS.bulwark)
    startBar(b, ISLE_CASTS.bulwark, T.bulwarkMax, null, true);
  b.castRemaining = Math.max(0, T.bulwarkMax - round.elapsed);
  b.castTotal = T.bulwarkMax;
  const alive = livingAdds(s);
  if (alive.length > 0)
    shield.value = Math.min(round.whole, shield.value + round.whole * T.regrowShare * DT);
  stepMenders(s, shield);
}

/** The Menders' channels into the Bulwark (a kick cuts one). */
function stepMenders(s: BreathScope, shield: { value: number }): void {
  const round = s.st.isles.round;
  if (!round) return;
  for (const a of s.st.isles.adds) {
    if (a.role !== 'mender') continue;
    const e = s.ctx.entities.get(a.id);
    if (!living(e)) continue;
    if (a.at) {
      const held = s.ctx.isStunned(e) || isSilenced(e);
      if (e.castingAbility !== ISLE_CASTS.mending || held) {
        // Cut (a player interrupt, a stun, a silence): it starts over.
        if (e.castingAbility === ISLE_CASTS.mending) clearCastIf(e, ISLE_CASTS.mending);
        e.channeling = false;
        a.at = null;
        a.next = T.mendEvery;
        continue;
      }
      if (e.pos.x !== a.at.x || e.pos.z !== a.at.z) {
        e.pos.x = a.at.x;
        e.pos.y = a.at.y;
        e.pos.z = a.at.z;
        s.ctx.rebucket(e);
      }
      e.swingTimer = Math.max(e.swingTimer, 0.6);
      e.castRemaining = Math.max(0, e.castRemaining - DT);
      if (e.castRemaining > 1e-9) continue;
      e.castingAbility = null;
      e.castRemaining = 0;
      e.castTotal = 0;
      e.castTargetId = null;
      e.channeling = false;
      a.at = null;
      a.next = T.mendEvery;
      shield.value = Math.min(round.whole, shield.value + round.whole * T.mendShare);
      s.ctx.emit({
        type: 'spellfx',
        sourceId: e.id,
        targetId: s.boss.id,
        school: 'nature',
        fx: 'beam',
        ability: ISLE_CUES.mended,
      });
      continue;
    }
    a.next -= DT;
    if (a.next > 1e-9 || e.castingAbility !== null) continue;
    if (s.ctx.isStunned(e) || isSilenced(e)) continue;
    startBar(e, ISLE_CASTS.mending, T.mendCast, s.boss.id, true);
    a.at = { ...e.pos };
  }
}

/** Held too long: the Bulwark bursts over the Cornice, the round ends. */
function burstBulwark(s: BreathScope): void {
  const b = s.boss;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'nature',
    fx: 'nova',
    ability: ISLE_CUES.bulwarkBurst,
  });
  for (const p of livePlayers(s))
    s.ctx.dealDamage(
      b,
      p,
      roll(s, T.burstMin, T.burstMax),
      false,
      'nature',
      ISLE_NAMES.burst,
      'hit',
      true,
    );
  endRound(s);
}

/** The round ends: the Bulwark, the guardian's channel, any add still up and
 *  the Gale Paths go. Riders already on an isle find their Homeward Gale. */
export function endRound(s: Pick<BreathScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const st = s.st;
  dropAura(s.boss, ISLE_AURAS.bulwark);
  dropAura(s.boss, ISLE_AURAS.hold);
  clearCastIf(s.boss, ISLE_CASTS.bulwark);
  s.boss.channeling = false;
  for (const a of st.isles.adds) {
    const e = s.ctx.entities.get(a.id);
    if (e) dropEncounterBody(s.ctx, s.inst, s.boss, a.id);
  }
  st.isles.adds = [];
  for (const p of st.isles.paths) dropBreathObject(s.ctx, s.inst, p.objectId);
  st.isles.paths = [];
  st.isles.round = null;
}

// ---- the circles and the rides --------------------------------------------------------------

/** May `p` take a ride now (alive, free, out of its grace, not worn)? */
function mayRide(st: BreathFightState, p: Entity): boolean {
  // The Knotted Gale's carrier and the anchored stay on the Cornice.
  if (p.dead || p.carriedBy !== undefined || heldFast(p)) return false;
  if ((st.isles.grace[p.id] ?? -1) > st.clock) return false;
  return !st.isles.rides.some((r) => r.playerId === p.id);
}

/** Set `p` riding the gale out to isle `i` or home from it. Exported for
 *  the dev trigger and the tests. */
export function startRide(
  s: Pick<BreathScope, 'ctx' | 'inst' | 'st' | 'boss'>,
  p: Entity,
  i: number,
  dir: 'out' | 'home',
): boolean {
  if (!mayRide(s.st, p)) return false;
  const spots = isleSpots()[i];
  const o = s.ctx.instanceOriginOf(s.inst);
  const at = local(s.ctx, s.inst, p);
  const end = dir === 'out' ? spots.land : spots.back;
  const from = { x: at.x, y: p.pos.y, z: at.z };
  const to = { x: end.x, y: s.ctx.groundPos(o.x + end.x, o.z + end.z).y, z: end.z };
  const obj = spawnBreathObject(
    s.ctx,
    s.inst,
    rideTemplate(dir, i, T.rideSeconds),
    ISLE_NAMES.riding,
    at.x,
    at.z,
    1,
  );
  obj.pos = { ...p.pos };
  carryBody(p, obj.id);
  s.ctx.applyAura(p, {
    id: ISLE_AURAS.riding,
    name: ISLE_NAMES.riding,
    kind: 'stun',
    remaining: T.rideSeconds + 1,
    duration: T.rideSeconds + 1,
    value: 0,
    sourceId: s.boss.id,
    school: 'nature',
    unbreakableControl: true,
    undispellable: true,
  });
  s.st.isles.rides.push({
    playerId: p.id,
    objectId: obj.id,
    isle: i,
    dir,
    from,
    to,
    t: 0,
    total: T.rideSeconds,
  });
  s.ctx.emit({
    type: 'spellfxAt',
    x: p.pos.x,
    z: p.pos.z,
    school: 'nature',
    fx: 'burst',
    radius: T.circleR,
    ability: ISLE_CUES.rideUp,
  });
  return true;
}

/** Every ride one tick along its arc; a landed one sets its body down. */
function stepRides(s: BreathScope): void {
  const st = s.st;
  if (st.isles.rides.length === 0) return;
  const o = s.ctx.instanceOriginOf(s.inst);
  const keep: BreathRide[] = [];
  for (const r of st.isles.rides) {
    const p = s.ctx.entities.get(r.playerId);
    const obj = s.ctx.entities.get(r.objectId);
    if (p?.dead && obj && p.carriedBy === r.objectId) {
      // Died in the air: the body is set down where the ride was bound.
      landRide(s, p, r, true);
      continue;
    }
    if (!p || !obj || p.carriedBy !== r.objectId) {
      // Let go some other way (a reset took the carrier, a death).
      if (p) dropAura(p, ISLE_AURAS.riding);
      dropBreathObject(s.ctx, s.inst, r.objectId);
      continue;
    }
    r.t = Math.min(r.total, r.t + DT);
    const at = rideArc(r.from, r.to, r.t / r.total);
    p.pos.x = o.x + at.x;
    p.pos.y = at.y;
    p.pos.z = o.z + at.z;
    obj.prevPos = { ...obj.pos };
    obj.pos = { ...p.pos };
    s.ctx.rebucket(p);
    s.ctx.rebucket(obj);
    if (r.t + 1e-9 < r.total) {
      keep.push(r);
      continue;
    }
    landRide(s, p, r);
  }
  st.isles.rides = keep;
}

function landRide(s: BreathScope, p: Entity, r: BreathRide, dead = false): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  const ground = s.ctx.groundPos(o.x + r.to.x, o.z + r.to.z);
  p.pos.x = ground.x;
  p.pos.z = ground.z;
  setDownBody(p, ground.y);
  p.prevPos = { ...p.pos };
  s.ctx.rebucket(p);
  dropAura(p, ISLE_AURAS.riding);
  dropBreathObject(s.ctx, s.inst, r.objectId);
  s.st.isles.grace[p.id] = s.st.clock + T.rideGrace;
  s.ctx.emit({
    type: 'spellfxAt',
    x: ground.x,
    z: ground.z,
    school: 'nature',
    fx: 'burst',
    radius: 3,
    ability: ISLE_CUES.rideDown,
  });
  if (dead) return;
  if (r.dir === 'out') {
    // The isle's wardens turn on whoever the wind set down among them.
    for (const e of livingAdds(s, r.isle)) s.ctx.aggroMob(e, p, false);
    return;
  }
  if (s.rules.windwornSeconds > 0)
    s.ctx.applyAura(p, {
      id: ISLE_AURAS.windworn,
      name: ISLE_NAMES.windworn,
      kind: 'vulnerability',
      remaining: s.rules.windwornSeconds,
      duration: s.rules.windwornSeconds,
      value: 0,
      sourceId: s.boss.id,
      school: 'nature',
      undispellable: true,
    });
}

/** The Gale Paths take whoever steps in; the Homeward Gales stand on every
 *  isle that has riders and no living add, and take them home. */
function stepCircles(s: BreathScope): void {
  const st = s.st;
  const spots = isleSpots();
  // Paths: only while their isle's adds live (the round's).
  for (const path of [...st.isles.paths]) {
    if (livingAdds(s, path.isle).length === 0) {
      dropBreathObject(s.ctx, s.inst, path.objectId);
      st.isles.paths = st.isles.paths.filter((q) => q !== path);
      continue;
    }
    const c = spots[path.isle].path;
    for (const p of livePlayers(s)) {
      if (!mayRide(st, p)) continue;
      if (p.auras.some((a) => a.id === ISLE_AURAS.windworn)) continue;
      const at = local(s.ctx, s.inst, p);
      if (Math.hypot(at.x - c.x, at.z - c.z) > T.circleR) continue;
      startRide(s, p, path.isle, 'out');
    }
  }
  // Homes: an isle with riders on it and no add left.
  const onIsles = islePlayers(s.ctx, s.inst);
  for (let i = 0; i < spots.length; i++) {
    const riders = onIsles.filter((q) => q.isle === i).map((q) => q.p);
    const want = riders.length > 0 && livingAdds(s, i).length === 0;
    const have = st.isles.homes.find((h) => h.isle === i);
    if (want && !have) {
      const e = spawnBreathObject(
        s.ctx,
        s.inst,
        homeGaleTemplate(i),
        ISLE_NAMES.home,
        spots[i].home.x,
        spots[i].home.z,
        T.circleR,
      );
      st.isles.homes.push({ isle: i, objectId: e.id });
    } else if (!want && have) {
      dropBreathObject(s.ctx, s.inst, have.objectId);
      st.isles.homes = st.isles.homes.filter((h) => h !== have);
    }
    if (!want) continue;
    const c = spots[i].home;
    for (const p of riders) {
      if (!mayRide(st, p)) continue;
      const at = local(s.ctx, s.inst, p);
      if (Math.hypot(at.x - c.x, at.z - c.z) > T.circleR) continue;
      startRide(s, p, i, 'home');
    }
  }
}

// ---- the tick and the wipe ------------------------------------------------------------------

/** One tick of the isles (rides and homes in any half: a rider in flight or
 *  stranded is always brought back). */
export function stepIsles(s: BreathScope): void {
  holdIsleAdds(s.ctx, s.inst, s.st);
  stepRound(s);
  stepRides(s);
  stepCircles(s);
}

/** Every add, circle, ride and the Bulwark go; every body on an isle (alive
 *  or dead) and every rider is set back on the Cornice by its isle's path
 *  (a wipe, a reset, the end). */
export function clearIsles(
  ctx: SimContext,
  inst: InstanceSlot,
  st: BreathFightState,
  boss: Entity,
): void {
  endRound({ ctx, inst, st, boss });
  const o = ctx.instanceOriginOf(inst);
  const spots = isleSpots();
  const home = (p: Entity, i: number) => {
    const back = spots[i].back;
    const at = ctx.groundPos(o.x + back.x, o.z + back.z);
    if (p.carriedBy !== undefined) setDownBody(p, at.y);
    p.pos = at;
    p.prevPos = { ...at };
    p.onGround = true;
    ctx.rebucket(p);
  };
  for (const r of st.isles.rides) {
    const p = ctx.entities.get(r.playerId);
    if (p) {
      dropAura(p, ISLE_AURAS.riding);
      home(p, r.isle);
    }
    dropBreathObject(ctx, inst, r.objectId);
  }
  st.isles.rides = [];
  for (const h of st.isles.homes) dropBreathObject(ctx, inst, h.objectId);
  st.isles.homes = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p) continue;
    dropAura(p, ISLE_AURAS.windworn);
    const i = isleAt(p.pos.x - o.x, p.pos.z - o.z);
    if (i >= 0 && Math.abs(p.pos.y - BREATH_ISLES[i].h) < 6) home(p, i);
  }
  st.isles.grace = {};
}

/** The adds of a round (dev readout, tests). */
export function isleAdds(st: BreathFightState): readonly BreathIsleAdd[] {
  return st.isles.adds;
}
