// The Masterless Strength's Splinters (docs/design/raid/smith_heart.md
// section 7.5, part 2): one rises out of each awakened quarter as an
// intermission's call begins (final_intermission.ts says when and where).
// Real mobs: threat, nameplates, the target frame; their bars real cast bars.
// None of them ever raises another body (the owner's rule).
//
//   Every Splinter    Shearing Blow: every 11 s a 2 s bar at its target, its
//                     facing locked and the cone on the floor; its target
//                     takes the tank's share, anyone else in it the lethal
//                     one. Splintered Strength (the call's ramping raid
//                     damage) is the coordinator's, one pulse per Splinter.
//   The Heat          Cinder Trail: a burning patch every 3 yd it is dragged
//                     (kite it away from the raid). Bursting Coal: a marked
//                     player (two on Mythic) carries a coal that bursts after
//                     6 s on everyone else within 8 yd: leave the group.
//   The Quench        Rime Toll: a kickable 2.5 s bar; rung out it strikes the
//                     whole raid (a kick locks it out). Quenching Rings expand
//                     from it every 9 s with their gaps: walk through a gap
//                     (or be chilled and hurt).
//   The Hammer        Mounting Weight: every landed swing a stack on its
//                     target, and every stack it sees on its target makes its
//                     swings land harder: the tanks swap.
//   The Breath        Gale Pounce: a bar on a hashed player (never its tank),
//                     then it leaps onto them and hunts them (Wind-Tethered),
//                     its Buffeting Gale striking everyone else near it: the
//                     quarry drags it out of the group. Its circles: Storm
//                     Orbs round it, one player steps on each (solo soaks).
//
// Deterministic: every pick is hashed (pickPlayers, finalHash) or ordered;
// the only rng draws are the damage rolls, in claim-player order.

import { isLockedOut } from '../../combat/cc';
import type { SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_ROOM } from '../../content/smith_heart_layout';
import { heartQuarterSpot } from '../../content/smith_heart_quarters';
import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../../instances/difficulty';
import { DT, type Entity } from '../../types';
import { clearCastIf, dropEncounterBody, startBar } from '../sunken_bastion/claim';
import { raiseOrbs } from './final_breath';
import { layPool } from './final_heat';
import { finalHash } from './final_ids';
import {
  FINAL_PHASE_AURAS as A,
  FINAL_PHASE_CASTS as C,
  FINAL_ADD_MOBS,
  FINAL_PHASE_DIFFICULTY,
  type FinalPhaseRules,
  inRingGap,
  MOUNTING_WEIGHT_AURA,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  FINAL_PHASE_CUES as Q,
  QUENCH_RING_LIFE,
  quenchRingFront,
  quenchRingGaps,
  quenchRingTemplate,
} from './final_phase_ids';
import {
  at,
  auraOf,
  beamCue,
  cueAt,
  dropAura,
  dropFightObject,
  type FinalScope,
  type FPoint,
  facingTo,
  livePlayers,
  living,
  local,
  pickPlayers,
  putMarker,
  raidWarn,
  roll,
  spawnFightObject,
} from './final_scope';
import type { FinalAdd } from './final_state';

type School = 'fire' | 'frost' | 'nature' | 'physical' | 'arcane';

const VEIN_SCHOOL: Readonly<Record<SmithHeartVein, School>> = {
  heat: 'fire',
  quench: 'frost',
  breath: 'nature',
  hammer: 'physical',
};

/** This tier's part-2 rules. */
export function phaseRules(s: Pick<FinalScope, 'st'>): FinalPhaseRules {
  return FINAL_PHASE_DIFFICULTY[s.st.difficulty];
}

/** A hit from a Splinter (its own name in the log, its threat its own). */
export function addHit(
  s: FinalScope,
  from: Entity,
  p: Entity,
  amount: number,
  name: string,
  school: School,
): void {
  s.ctx.dealDamage(from, p, amount, false, school, name, 'hit', true);
}

/** A cue on one body from another. */
function cueOnFrom(
  s: FinalScope,
  from: Entity,
  target: Entity,
  ability: string,
  school: School,
): void {
  s.ctx.emit({
    type: 'spellfx',
    sourceId: from.id,
    targetId: target.id,
    school,
    fx: 'nova',
    ability,
  });
}

/** The living Splinter of `a`, or null. */
export function addBody(s: Pick<FinalScope, 'ctx'>, a: FinalAdd): Entity | null {
  const e = s.ctx.entities.get(a.id);
  return living(e) ? e : null;
}

// ---- the rise -----------------------------------------------------------------------------

/** Where a quarter's Splinter rises (instance-local): the middle of its
 *  quarter, `riseR` out. */
export function riseSpot(vein: SmithHeartVein): FPoint {
  const q = heartQuarterSpot(vein);
  const dx = q.x - HEART_ROOM.x;
  const dz = q.z - HEART_ROOM.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: HEART_ROOM.x + (dx / d) * P.riseR, z: HEART_ROOM.z + (dz / d) * P.riseR };
}

/** A quarter's Splinter climbs out of its quarter: tuned to the claim, on its
 *  roster and the boss's summons, its health this tier's, immune while it
 *  rises. Null when its template is missing. Exported for the dev verb. */
export function raiseSplinter(s: FinalScope, vein: SmithHeartVein): FinalAdd | null {
  const template = MOBS[FINAL_ADD_MOBS[vein]];
  if (!template) return null;
  const { ctx, inst } = s;
  const spot = riseSpot(vein);
  const o = ctx.instanceOriginOf(inst);
  const difficulty = inst.difficulty ?? 'normal';
  const tuned = mobTemplateForDungeonDifficulty(template, inst.dungeonId, difficulty);
  const e = createMob(
    ctx.nextId++,
    tuned,
    tuned.maxLevel,
    ctx.groundPos(o.x + spot.x, o.z + spot.z),
  );
  applyDungeonMobTuning(e, inst.dungeonId, difficulty);
  const hp = phaseRules(s).addHealth;
  e.maxHp = hp;
  e.hp = hp;
  e.spawnPos = { ...e.pos };
  e.prevPos = { ...e.pos };
  const facing = facingTo(spot, HEART_ROOM);
  e.facing = facing;
  e.prevFacing = facing;
  e.summonedAdd = true;
  e.ignoreHardLeash = true;
  e.tappedById = s.boss.tappedById;
  e.hostile = false;
  e.damageImmune = true;
  e.inCombat = true;
  ctx.addEntity(e);
  inst.mobIds.push(e.id);
  s.boss.summonedIds.push(e.id);
  putMarker(e, A.rising, N.shield, P.riseSeconds, e.id, { school: VEIN_SCHOOL[vein] });
  cueAt(s, Q.rise, spot.x, spot.z, 4, VEIN_SCHOOL[vein]);
  const add: FinalAdd = {
    id: e.id,
    vein,
    rise: P.riseSeconds,
    shear: P.shearFirst,
    a: 0,
    b: 0,
    bar: null,
    barAt: null,
    barFacing: 0,
    barTarget: null,
    trailAt: null,
    quarry: null,
    hunt: 0,
    buffet: 0,
    weapon: e.weapon ? { min: e.weapon.min, max: e.weapon.max } : null,
  };
  if (vein === 'heat') add.a = P.coalFirst;
  if (vein === 'quench') {
    add.a = P.tollFirst;
    add.b = P.ringFirst;
  }
  if (vein === 'breath') {
    add.a = P.pounceFirst;
    add.b = P.orbFirst;
  }
  s.st.phase.adds.push(add);
  return add;
}

/** The player nearest `e` (entity-id order breaks a tie), or null. */
function nearestPlayer(s: FinalScope, e: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of livePlayers(s)) {
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    if (d < bestD - 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** One tick of a rising Splinter: held, immune, then it takes the fight
 *  (on the player nearest it). */
function stepRise(s: FinalScope, a: FinalAdd, e: Entity): void {
  a.rise = Math.max(0, a.rise - DT);
  e.swingTimer = Math.max(e.swingTimer, 0.6);
  if (a.rise > 1e-9) {
    e.hostile = false;
    e.damageImmune = true;
    const sp = e.spawnPos;
    if (sp && (e.pos.x !== sp.x || e.pos.z !== sp.z)) {
      e.pos = { ...sp };
      s.ctx.rebucket(e);
    }
    return;
  }
  e.hostile = true;
  e.damageImmune = false;
  dropAura(e, A.rising);
  const first = nearestPlayer(s, e);
  if (first) s.ctx.aggroMob(e, first, false);
}

// ---- the bars -----------------------------------------------------------------------------

function beginAddBar(
  e: Entity,
  a: FinalAdd,
  castId: string,
  seconds: number,
  facing: number,
  target: number | null,
): void {
  a.bar = castId;
  a.barAt = { ...e.pos };
  a.barFacing = facing;
  a.barTarget = target;
  e.facing = facing;
  startBar(e, castId, seconds, target);
}

/** The bar in flight: planted, counting down, landing. A Rime Toll gone
 *  from its body was kicked; any other bar cut by anything still lands. */
function stepAddBar(s: FinalScope, a: FinalAdd, e: Entity): void {
  const id = a.bar;
  if (!id) return;
  if (e.castingAbility !== id) {
    a.bar = null;
    if (id === C.toll) tollKicked(a);
    else landAddBar(s, a, e, id);
    return;
  }
  e.facing = a.barFacing;
  e.swingTimer = Math.max(e.swingTimer, 0.6);
  const h = a.barAt;
  if (h && (e.pos.x !== h.x || e.pos.z !== h.z)) {
    e.pos.x = h.x;
    e.pos.y = h.y;
    e.pos.z = h.z;
    s.ctx.rebucket(e);
  }
  e.castRemaining = Math.max(0, e.castRemaining - DT);
  if (e.castRemaining > 1e-9) return;
  clearCastIf(e, id);
  a.bar = null;
  landAddBar(s, a, e, id);
}

function landAddBar(s: FinalScope, a: FinalAdd, e: Entity, id: string): void {
  if (id === C.shear) landShear(s, a, e);
  else if (id === C.toll) landToll(s, e);
  else if (id === C.pounce) landPounce(s, a, e);
}

/** Is `e` free to begin a bar (no bar, not held by control, risen)? */
function addFree(s: FinalScope, a: FinalAdd, e: Entity): boolean {
  return a.rise <= 0 && a.bar === null && e.castingAbility === null && !s.ctx.isStunned(e);
}

// ---- Shearing Blow ------------------------------------------------------------------------

/** Begin Shearing Blow at the Splinter's target. Exported for the tests. */
export function startShear(s: FinalScope, a: FinalAdd, e: Entity): boolean {
  a.shear = P.shearEvery;
  const id = e.aggroTargetId;
  const t = id !== null ? s.ctx.entities.get(id) : undefined;
  if (!living(t)) return false;
  beginAddBar(
    e,
    a,
    C.shear,
    P.shearCast,
    facingTo(local(s.ctx, s.inst, e), local(s.ctx, s.inst, t)),
    t.id,
  );
  return true;
}

/** The players in a Splinter's Shearing Blow (its locked facing, its arc and
 *  reach). */
export function inShear(s: FinalScope, e: Entity, facing: number): Entity[] {
  const half = (P.shearArcDeg * Math.PI) / 360;
  const reach = P.shearRange + (MOBS[e.templateId]?.bodyRadius ?? 0);
  const out: Entity[] = [];
  for (const p of livePlayers(s)) {
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    if (d > reach) continue;
    let da = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z) - facing;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (d > 0.5 && Math.abs(da) > half) continue;
    out.push(p);
  }
  return out;
}

function landShear(s: FinalScope, a: FinalAdd, e: Entity): Entity[] {
  const struck = inShear(s, e, a.barFacing);
  cueOnFrom(s, e, e, Q.shear, VEIN_SCHOOL[a.vein]);
  for (const p of struck) {
    const tank = p.id === a.barTarget;
    const amount = tank
      ? roll(s, P.shearTankMin, P.shearTankMax)
      : roll(s, P.shearOtherMin, P.shearOtherMax);
    addHit(s, e, p, amount, N.shear, VEIN_SCHOOL[a.vein]);
  }
  return struck;
}

// ---- the Heat: Cinder Trail and Bursting Coal -----------------------------------------------

function stepTrail(s: FinalScope, a: FinalAdd, e: Entity): void {
  const q = local(s.ctx, s.inst, e);
  if (!a.trailAt) {
    a.trailAt = q;
    return;
  }
  if (Math.hypot(q.x - a.trailAt.x, q.z - a.trailAt.z) < P.trailStep) return;
  layPool(s, 'trail', a.trailAt.x, a.trailAt.z);
  a.trailAt = q;
}

/** Bursting Coal on this tier's hashed players (never one already
 *  carrying one). Returns who. Exported for the dev verb. */
export function markCoals(s: FinalScope, from: Entity): Entity[] {
  const ph = s.st.phase;
  const busy = new Set(ph.coals.map((c) => c.pid));
  const marked = pickPlayers(s, phaseRules(s).coalMarks, s.st.casts + 1301, busy);
  s.st.casts++;
  for (const p of marked) {
    putMarker(p, A.coal, N.coal, P.coalSeconds, from.id, { school: 'fire' });
    ph.coals.push({ pid: p.id, left: P.coalSeconds, sourceId: from.id });
    beamCue(s, from.id, p.id, Q.coal, 'fire');
  }
  if (marked.length > 0)
    raidWarn(s, 'coal', 'Bursting Coal! The marked carry it out of the group before it bursts!');
  return marked;
}

/** One tick of every coal: at its time it bursts on everyone else near its
 *  player (and a little on them). */
export function stepCoals(s: FinalScope): void {
  const ph = s.st.phase;
  if (ph.coals.length === 0) return;
  const keep: typeof ph.coals = [];
  for (const c of ph.coals) {
    c.left -= DT;
    const p = s.ctx.entities.get(c.pid);
    if (!p) continue;
    if (c.left > 1e-9) {
      if (!p.dead) keep.push(c);
      else dropAura(p, A.coal);
      continue;
    }
    dropAura(p, A.coal);
    if (p.dead) continue;
    const from = s.ctx.entities.get(c.sourceId) ?? s.boss;
    const q = at(s, p);
    cueAt(s, Q.coal, q.x, q.z, P.coalReach, 'fire');
    addHit(s, from, p, roll(s, P.coalSelfMin, P.coalSelfMax), N.coal, 'fire');
    for (const o of livePlayers(s)) {
      if (o.id === p.id) continue;
      const r = at(s, o);
      if (Math.hypot(r.x - q.x, r.z - q.z) > P.coalReach) continue;
      addHit(s, from, o, roll(s, P.coalMin, P.coalMax), N.coal, 'fire');
    }
  }
  ph.coals = keep;
}

// ---- the Quench: Rime Toll and the Quenching Rings ------------------------------------------

/** Begin Rime Toll (never while a kick's lockout holds it). Exported for the
 *  dev verb. */
export function startToll(s: FinalScope, a: FinalAdd, e: Entity): boolean {
  a.a = P.tollEvery;
  if (isLockedOut(e, 'frost')) return false;
  beginAddBar(e, a, C.toll, P.tollCast, e.facing, null);
  raidWarn(s, 'toll', 'Rime Toll! Interrupt the Splinter of the Quench!');
  return true;
}

function landToll(s: FinalScope, e: Entity): Entity[] {
  cueOnFrom(s, e, e, Q.toll, 'frost');
  const struck = livePlayers(s);
  for (const p of struck) addHit(s, e, p, roll(s, P.tollMin, P.tollMax), N.toll, 'frost');
  return struck;
}

/** A Rime Toll was kicked: it rings nothing (its next waits its clock,
 *  and the kick's lockout holds it past that). */
function tollKicked(a: FinalAdd): void {
  a.a = Math.max(a.a, 2);
}

/** A Quenching Ring expands from the Splinter. Exported for the dev verb. */
export function raiseRing(s: FinalScope, e: Entity, salt = 0): void {
  const ph = s.st.phase;
  const q = local(s.ctx, s.inst, e);
  const gapsN = phaseRules(s).ringGaps;
  const seed = finalHash(e.id + salt, s.st.casts * 13 + 7) % 100000;
  s.st.casts++;
  const obj = spawnFightObject(
    s.ctx,
    s.inst,
    quenchRingTemplate(gapsN, seed),
    N.ring,
    q.x,
    q.z,
    P.ringReach,
  );
  ph.rings.push({
    objectId: obj.id,
    x: q.x,
    z: q.z,
    age: 0,
    gaps: quenchRingGaps(seed, gapsN),
    struck: [],
  });
}

/** One tick of every ring: its front rides out; whoever it reaches outside
 *  a gap is chilled and hurt (once a ring). */
export function stepRings(s: FinalScope): void {
  const ph = s.st.phase;
  if (ph.rings.length === 0) return;
  const keep: typeof ph.rings = [];
  for (const r of ph.rings) {
    r.age += DT;
    const front = quenchRingFront(r.age);
    for (const p of livePlayers(s)) {
      if (r.struck.includes(p.id)) continue;
      const q = at(s, p);
      const d = Math.hypot(q.x - r.x, q.z - r.z);
      if (d > front) continue;
      r.struck.push(p.id);
      if (inRingGap(Math.atan2(q.x - r.x, q.z - r.z), r.gaps)) continue;
      const src = s.boss;
      addHit(s, src, p, roll(s, P.ringMin, P.ringMax), N.ring, 'frost');
      if (p.dead) continue;
      s.ctx.applyAura(p, {
        id: A.chill,
        name: N.ring,
        kind: 'slow',
        remaining: P.chillSeconds,
        duration: P.chillSeconds,
        value: P.chillSlow,
        sourceId: src.id,
        school: 'frost',
        undispellable: true,
      });
    }
    if (r.age >= QUENCH_RING_LIFE - 1e-9) {
      dropFightObject(s.ctx, s.inst, r.objectId);
      continue;
    }
    keep.push(r);
  }
  ph.rings = keep;
}

// ---- the Hammer: Mounting Weight -------------------------------------------------------------

/** Mounting Weight's stacks on `p`. */
export function weightStacks(p: Entity | null | undefined): number {
  if (!p) return 0;
  return Math.round(auraOf(p, MOUNTING_WEIGHT_AURA)?.stacks ?? 0);
}

/** Its swing for its target's stacks (only when it changes). */
function stepWeight(s: FinalScope, a: FinalAdd, e: Entity): void {
  if (!a.weapon || !e.weapon) return;
  const id = e.aggroTargetId;
  const t = id !== null ? s.ctx.entities.get(id) : undefined;
  const k = 1 + phaseRules(s).weightStep * weightStacks(t);
  const min = Math.round(a.weapon.min * k);
  const max = Math.round(a.weapon.max * k);
  if (e.weapon.min !== min) e.weapon.min = min;
  if (e.weapon.max !== max) e.weapon.max = max;
}

// ---- the Breath: Gale Pounce and its circles --------------------------------------------------

/** Begin Gale Pounce on a hashed player (never its tank). Exported for the
 *  dev verb. */
export function startPounce(s: FinalScope, a: FinalAdd, e: Entity): Entity | null {
  a.a = P.pounceEvery;
  const busy = new Set<number>(e.aggroTargetId !== null ? [e.aggroTargetId] : []);
  const [victim] = pickPlayers(s, 1, s.st.casts + 1401 + e.id, busy);
  s.st.casts++;
  if (!victim) return null;
  beginAddBar(
    e,
    a,
    C.pounce,
    P.pounceCast,
    facingTo(local(s.ctx, s.inst, e), at(s, victim)),
    victim.id,
  );
  putMarker(victim, A.tether, N.tether, P.pounceCast + P.tetherSeconds, e.id, { school: 'nature' });
  raidWarn(
    s,
    'pounce',
    'Gale Pounce! Its quarry drags the Splinter of the Breath out of the group!',
  );
  return victim;
}

function landPounce(s: FinalScope, a: FinalAdd, e: Entity): void {
  const id = a.barTarget;
  const v = id !== null ? s.ctx.entities.get(id) : undefined;
  if (!living(v)) return;
  // It lands a stride short of its quarry, facing it.
  const dx = e.pos.x - v.pos.x;
  const dz = e.pos.z - v.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const land = s.ctx.groundPos(v.pos.x + (dx / d) * 1.5, v.pos.z + (dz / d) * 1.5);
  e.prevPos = { ...e.pos };
  e.pos = land;
  s.ctx.rebucket(e);
  const q = at(s, v);
  cueAt(s, Q.pounce, q.x, q.z, 3, 'nature');
  addHit(s, e, v, roll(s, P.pounceMin, P.pounceMax), N.pounce, 'nature');
  a.quarry = v.id;
  a.hunt = P.tetherSeconds;
  a.buffet = 1;
  e.forcedTargetId = v.id;
  e.forcedTargetTimer = P.tetherSeconds;
  e.aggroTargetId = v.id;
}

/** One tick of the hunt: its Buffeting Gale on everyone else near it, the
 *  tether's end. */
function stepHunt(s: FinalScope, a: FinalAdd, e: Entity): void {
  if (a.quarry === null) return;
  const v = s.ctx.entities.get(a.quarry);
  a.hunt -= DT;
  if (a.hunt <= 1e-9 || !living(v)) {
    if (v) dropAura(v, A.tether);
    a.quarry = null;
    return;
  }
  a.buffet -= DT;
  if (a.buffet > 1e-9) return;
  a.buffet = 1;
  cueOnFrom(s, e, e, Q.buffet, 'nature');
  for (const p of livePlayers(s)) {
    if (p.id === a.quarry) continue;
    if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) > P.buffetReach) continue;
    addHit(s, e, p, roll(s, P.buffetMin, P.buffetMax), N.buffet, 'nature');
  }
}

/** Its circles: Storm Orbs round it (solo soaks). Exported for the dev
 *  verb. */
export function raiseCircles(s: FinalScope, a: FinalAdd, e: Entity): number {
  a.b = P.orbEvery;
  return raiseOrbs(s, {
    around: local(s.ctx, s.inst, e),
    count: phaseRules(s).pounceOrbs,
    salt: e.id,
  });
}

// ---- one tick of every Splinter ---------------------------------------------------------------

/** One tick of every Splinter: the rise, the bars, the signatures. The dead
 *  leave the list (their coals and rings run on). */
export function stepAdds(s: FinalScope): void {
  const ph = s.st.phase;
  ph.adds = ph.adds.filter((a) => {
    const e = addBody(s, a);
    if (e) return true;
    // A dead Splinter's quarry is free.
    if (a.quarry !== null) {
      const v = s.ctx.entities.get(a.quarry);
      if (v) dropAura(v, A.tether);
    }
    return false;
  });
  for (const a of ph.adds) {
    const e = addBody(s, a);
    if (!e) continue;
    e.inCombat = true;
    if (a.rise > 0) {
      stepRise(s, a, e);
      continue;
    }
    stepAddBar(s, a, e);
    if (!addBody(s, a)) continue;
    if (a.vein === 'heat') stepTrail(s, a, e);
    if (a.vein === 'hammer') stepWeight(s, a, e);
    if (a.vein === 'breath') stepHunt(s, a, e);
    a.shear -= DT;
    a.a -= DT;
    a.b -= DT;
    // The signatures that are no bar run whatever it is doing.
    if (a.vein === 'heat' && a.a <= 1e-9) {
      a.a = P.coalEvery;
      markCoals(s, e);
    }
    if (a.vein === 'quench' && a.b <= 1e-9) {
      a.b = P.ringEvery;
      raiseRing(s, e);
    }
    if (a.vein === 'breath' && a.b <= 1e-9) raiseCircles(s, a, e);
    if (!addFree(s, a, e)) continue;
    if (a.shear <= 1e-9 && startShear(s, a, e)) continue;
    if (a.vein === 'quench' && a.a <= 1e-9) startToll(s, a, e);
    else if (a.vein === 'breath' && a.a <= 1e-9 && a.quarry === null) startPounce(s, a, e);
  }
}

/** A Splinter leaves the fight (it poured, a wipe, the kill). */
export function dropAdd(s: Pick<FinalScope, 'ctx' | 'inst' | 'boss' | 'st'>, a: FinalAdd): void {
  if (a.quarry !== null) {
    const v = s.ctx.entities.get(a.quarry);
    if (v) dropAura(v, A.tether);
  }
  dropEncounterBody(s.ctx, s.inst, s.boss, a.id);
}

/** Every Splinter, ring, coal and tether gone (a wipe, the kill). */
export function clearAdds(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'boss' | 'st'>,
  players: readonly Entity[],
): void {
  const ph = s.st.phase;
  for (const a of ph.adds) dropAdd(s, a);
  ph.adds = [];
  for (const r of ph.rings) dropFightObject(s.ctx, s.inst, r.objectId);
  ph.rings = [];
  ph.coals = [];
  for (const p of players) {
    dropAura(p, A.coal);
    dropAura(p, A.tether);
  }
}
