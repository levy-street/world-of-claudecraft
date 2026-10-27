// The Smith's four blades of ice under the Guardian of the Quench (docs/
// design/raid/smith_heart.md section 7.3).
//
//   Sunk          four great swords sunk point first round the lake (claim
//                 objects, round combat walls): scenery through phase 1.
//   The blades wake at half health: the guardian raises its arms (a 4 s bar,
//                 planted) and the four tear free, stand upright and float in
//                 place, a blue light in each; they cannot be targeted or
//                 harmed (objects, never bodies).
//   The echoes    through phase 2 every Quenching Breath and Tempering Strike
//                 is repeated by each blade 3 s after the guardian's own (2 s
//                 below a quarter health), from the blade's place and facing
//                 the way the guardian's attack faced: all four footprints show
//                 the moment the guardian begins (the breath's bar, the
//                 strike's swing). The tank turning the guardian aims them.
//   The lee       behind each blade (on the side away from the attack) is
//                 always safe: the cold breaks on the blade's ice, the
//                 guardian's own breath and every echo alike.
//   The crossing  heroic: about every 40 s two blades swap places, flying
//                 in a straight line (across the lake or along its side):
//                 their lane is telegraphed (3 s), the flight strikes whoever
//                 stands in it, and the lane then
//                 cracks into holes, so the safe spots move.
//
// Zero rng in every pick (the crossing's pair is hashed); the draws are the
// damage rolls, in player order.

import { QUENCH_BLADE_SPOTS } from '../../content/smith_heart_layout';
import { syncCombatWallCollision } from '../../mob/trash_kit/combat_walls';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity } from '../../types';
import { addCold } from './quench_cold';
import {
  CROSSING_PAIRS,
  crossingPair,
  inEchoReach,
  laneHoleSpots,
  type QPoint,
  segmentDistance,
  shelteredByBlade,
} from './quench_geometry';
import { startCrack } from './quench_ice';
import {
  bladeStateOf,
  bladeTemplate,
  echoDelay,
  echoTemplate,
  laneTemplate,
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_NAMES,
  QUENCH_OBJECTS,
  type QuenchBladeState,
  type QuenchEchoKind,
  QUENCH_TUNING as T,
} from './quench_ids';
import {
  at,
  beginBar,
  dropAura,
  dropFightObject,
  frostHit,
  livePlayers,
  moveFightObject,
  putMarker,
  type QuenchScope,
  raidWarn,
  roll,
  spawnFightObject,
} from './quench_scope';
import type { QuenchBlade, QuenchFightState } from './quench_state';
import { quenchSay } from './quench_voice';

/** A blade's wall stands as long as the claim (it never runs out). */
const BLADE_WALL_LIFE = 1e9;

// ---- the claim's blades ---------------------------------------------------------------

/** The claim's four blade objects, by home (QUENCH_BLADE_SPOTS order); a
 *  missing one is null. */
export function claimBlades(ctx: SimContext, inst: InstanceSlot): (Entity | null)[] {
  const out: (Entity | null)[] = QUENCH_BLADE_SPOTS.map(() => null);
  const o = ctx.instanceOriginOf(inst);
  const loose: Entity[] = [];
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (!e || !e.templateId.startsWith(QUENCH_OBJECTS.bladePrefix)) continue;
    const i = QUENCH_BLADE_SPOTS.findIndex(
      (sp) => Math.hypot(sp.x - (e.pos.x - o.x), sp.z - (e.pos.z - o.z)) < 1,
    );
    if (i >= 0 && !out[i]) out[i] = e;
    else loose.push(e);
  }
  // A blade away from home (a crossing in flight at a reset) takes the
  // first empty home, in roster order.
  for (const e of loose) {
    const i = out.indexOf(null);
    if (i >= 0) out[i] = e;
  }
  return out;
}

/** How many of the claim's objects are combat walls (the publication's
 *  census: the shore ice and the blades). */
function wallCount(ctx: SimContext, inst: InstanceSlot): number {
  let n = 0;
  for (const id of inst.objectIds) if (ctx.entities.get(id)?.kitObject?.kind === 'wall') n++;
  return n;
}

/** Publish the claim's walls now (a read later this tick sees the change). */
export function syncQuenchWalls(ctx: SimContext, inst: InstanceSlot): void {
  syncCombatWallCollision(ctx, inst, wallCount(ctx, inst));
}

/** Set a blade object's state: its template (whether it walls) and its
 *  engine wall state with it. */
function setBladeObject(e: Entity, state: QuenchBladeState): void {
  e.templateId = bladeTemplate(state);
  if (state === 'fly') e.kitObject = undefined;
  else e.kitObject ??= { kind: 'wall', remaining: BLADE_WALL_LIFE };
}

/** The blades the claim spawned with are plain objects: give each the
 *  engine's wall state once, so the trash engine publishes it every tick.
 *  Returns true when any was new. */
export function ensureBladeWalls(ctx: SimContext, inst: InstanceSlot): boolean {
  let fresh = false;
  claimBlades(ctx, inst).forEach((e, i) => {
    if (!e || e.kitObject || bladeStateOf(e.templateId) === 'fly') return;
    e.kitObject = { kind: 'wall', remaining: BLADE_WALL_LIFE };
    // Faced as its home is (as a reset sinks it), from the claim's first tick.
    e.facing = QUENCH_BLADE_SPOTS[i].rot;
    fresh = true;
  });
  if (fresh) syncQuenchWalls(ctx, inst);
  return fresh;
}

/** The fight's blades as the state holds them (at their homes, sunk). */
export function bladesAtHome(ctx: SimContext, inst: InstanceSlot): QuenchBlade[] {
  const out: QuenchBlade[] = [];
  claimBlades(ctx, inst).forEach((e, i) => {
    if (!e) return;
    const sp = QUENCH_BLADE_SPOTS[i];
    out.push({ objectId: e.id, home: i, x: sp.x, z: sp.z });
  });
  return out;
}

/** Every blade back to its home, sunk (a reset, the fall). */
export function sinkBlades(ctx: SimContext, inst: InstanceSlot): void {
  const o = ctx.instanceOriginOf(inst);
  claimBlades(ctx, inst).forEach((e, i) => {
    if (!e) return;
    const sp = QUENCH_BLADE_SPOTS[i];
    if (Math.hypot(e.pos.x - o.x - sp.x, e.pos.z - o.z - sp.z) > 1e-6) {
      const p = ctx.groundPos(o.x + sp.x, o.z + sp.z);
      e.prevPos = { ...e.pos };
      e.pos = p;
      ctx.rebucket(e);
    }
    e.facing = sp.rot;
    setBladeObject(e, 'sunk');
  });
  syncQuenchWalls(ctx, inst);
}

/** The blades' places now (the ones not in flight). */
function standing(s: QuenchScope): QPoint[] {
  const d = s.st.dance;
  return s.st.blades.filter((_, i) => !(d && d.phase === 'fly' && (i === d.a || i === d.b)));
}

// ---- the blades wake ------------------------------------------------------------------

/** Is the awakening due (half health, the Lake half, the guardian free)? */
export function wakeDue(s: QuenchScope, free: boolean): boolean {
  return s.st.half === 'lake' && s.boss.hp <= s.boss.maxHp * T.wakeAt && free;
}

/** The guardian raises its arms and the blades begin to tear free. Exported
 *  for the dev trigger. */
export function startWake(s: QuenchScope): boolean {
  if (s.st.half !== 'lake') return false;
  s.st.half = 'wake';
  beginBar(s, QUENCH_CASTS.wake, T.wakeCast, s.boss.facing);
  for (const b of s.st.blades) {
    const e = s.ctx.entities.get(b.objectId);
    if (e) setBladeObject(e, 'wake');
  }
  raidWarn(
    s,
    s.boss,
    'wake',
    "The Smith's blades tear free of the lake! Stand behind a blade when they strike!",
  );
  quenchSay(s, s.boss, 'wake');
  return true;
}

/** The bar lands: the blades stand upright and float; the Echoes begin. */
export function landWake(s: QuenchScope): void {
  const st = s.st;
  const b = s.boss;
  st.half = 'echoes';
  for (const bl of st.blades) {
    const e = s.ctx.entities.get(bl.objectId);
    if (!e) continue;
    setBladeObject(e, 'float');
    e.facing = b.facing;
  }
  putMarker(b, QUENCH_AURAS.awake, QUENCH_NAMES.awake, 3600, b.id, {
    permanent: true,
    school: 'frost',
  });
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: b.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.wake,
  });
  st.deepenTimer = T.deepenEvery;
  st.danceTimer = T.danceFirst;
  syncQuenchWalls(s.ctx, s.inst);
}

/** Phase 2: the floating blades turn with the guardian (their blades point
 *  the way its attacks would echo). */
function stepBladeFacing(s: QuenchScope): void {
  if (s.st.half !== 'echoes') return;
  const d = s.st.dance;
  s.st.blades.forEach((bl, i) => {
    if (d && d.phase === 'fly' && (i === d.a || i === d.b)) return;
    const e = s.ctx.entities.get(bl.objectId);
    if (e && e.facing !== s.boss.facing) e.facing = s.boss.facing;
  });
}

// ---- the echoes -----------------------------------------------------------------------

/** Every standing blade's echo of an attack facing `facing`, landing in
 *  `seconds`: its footprint shows now. Returns how many. */
export function spawnEchoes(
  s: QuenchScope,
  kind: QuenchEchoKind,
  facing: number,
  seconds: number,
  ofBar = false,
): number {
  const range = kind === 'breath' ? T.breathRange : T.strikeRange;
  let n = 0;
  for (const b of standing(s)) {
    const e = spawnFightObject(
      s.ctx,
      s.inst,
      echoTemplate(kind, seconds),
      kind === 'breath' ? QUENCH_NAMES.echoBreath : QUENCH_NAMES.echoStrike,
      b.x,
      b.z,
      range,
    );
    e.facing = facing;
    s.st.echoes.push({
      objectId: e.id,
      kind,
      x: b.x,
      z: b.z,
      facing,
      remaining: seconds,
      shown: 0,
      ...(ofBar ? { ofBar: true as const } : {}),
    });
    n++;
  }
  if (n > 0) quenchSay(s, s.boss, 'echo');
  return n;
}

/** The guardian's breath bar was cut: the echoes it raised never come
 *  (their footprints go). Returns how many were dropped. */
export function dropBarEchoes(s: QuenchScope): number {
  let n = 0;
  const keep = [];
  for (const ec of s.st.echoes) {
    if (ec.ofBar && ec.shown <= 0) {
      dropFightObject(s.ctx, s.inst, ec.objectId);
      n++;
    } else keep.push(ec);
  }
  s.st.echoes = keep;
  return n;
}

/** The seconds from now to an echo of the guardian's attack that lands in
 *  `lands` seconds. */
export function echoSeconds(s: QuenchScope, lands: number): number {
  return lands + echoDelay(s.boss.hp / Math.max(1, s.boss.maxHp));
}

/** Is `p` safe in a blade's lee from an attack facing `facing` (phase 2
 *  only: before the blades wake there is no lee)? */
export function inLee(s: QuenchScope, p: QPoint, facing: number): boolean {
  if (s.st.half !== 'echoes') return false;
  return shelteredByBlade(standing(s), facing, p);
}

/** An echo lands: everyone in its reach and out of every lee is struck.
 *  Returns who (the tests read it). */
export function landEcho(s: QuenchScope, echo: QuenchFightState['echoes'][number]): Entity[] {
  const breath = echo.kind === 'breath';
  const range = breath ? T.breathRange : T.strikeRange;
  const arc = breath ? T.breathArcDeg : T.strikeArcDeg;
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + echo.x,
    z: o.z + echo.z,
    school: 'frost',
    fx: 'burst',
    radius: range,
    ability: QUENCH_CUES.echo,
  });
  const hit: Entity[] = [];
  for (const p of livePlayers(s)) {
    const here = at(s, p);
    if (!inEchoReach(echo, echo.facing, here, range, arc)) continue;
    if (inLee(s, here, echo.facing)) continue;
    hit.push(p);
    frostHit(
      s,
      p,
      breath
        ? roll(s, T.echoBreathMin, T.echoBreathMax)
        : roll(s, T.echoStrikeMin, T.echoStrikeMax),
      breath ? QUENCH_NAMES.echoBreath : QUENCH_NAMES.echoStrike,
    );
    addCold(s, p, breath ? T.breathCold : T.echoStrikeCold);
  }
  return hit;
}

function stepEchoes(s: QuenchScope): void {
  const st = s.st;
  if (st.echoes.length === 0) return;
  const keep = [];
  for (const ec of st.echoes) {
    if (ec.shown > 0) {
      ec.shown -= DT;
      if (ec.shown <= 1e-9) dropFightObject(s.ctx, s.inst, ec.objectId);
      else keep.push(ec);
      continue;
    }
    ec.remaining -= DT;
    if (ec.remaining > 1e-9) {
      keep.push(ec);
      continue;
    }
    landEcho(s, ec);
    const e = s.ctx.entities.get(ec.objectId);
    if (e) e.templateId = echoTemplate(ec.kind, 'hit');
    ec.shown = T.echoShow;
    keep.push(ec);
  }
  st.echoes = keep;
}

// ---- heroic: the crossing -------------------------------------------------------------

/** Two blades begin to cross: the lane's warning. Exported for the dev
 *  trigger. */
export function startCrossing(s: QuenchScope): boolean {
  const st = s.st;
  if (st.half !== 'echoes' || st.dance || st.blades.length < 4) return false;
  const pairIndex = crossingPair(s.boss.id * 31 + 7, st.dances, st.lastPair);
  const [ia, ib] = CROSSING_PAIRS[pairIndex];
  const a = st.blades[ia];
  const b = st.blades[ib];
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const half = Math.hypot(b.x - a.x, b.z - a.z) / 2;
  const lane = spawnFightObject(
    s.ctx,
    s.inst,
    laneTemplate('warn', T.danceWarn),
    QUENCH_NAMES.cross,
    mid.x,
    mid.z,
    half,
  );
  lane.facing = Math.atan2(b.x - a.x, b.z - a.z);
  st.dance = {
    pair: pairIndex,
    a: ia,
    b: ib,
    laneId: lane.id,
    phase: 'warn',
    remaining: T.danceWarn,
    from: { x: a.x, z: a.z },
    to: { x: b.x, z: b.z },
    struck: [],
  };
  st.dances++;
  st.lastPair = pairIndex;
  st.danceTimer = T.danceEvery;
  raidWarn(s, s.boss, 'cross', 'Two blades cross the lake! Clear their path!');
  quenchSay(s, s.boss, 'cross');
  return true;
}

/** Strike whoever the flying blades pass over between flight fractions
 *  `k0` and `k1` (once each per crossing): both blades sweep the lane, one
 *  from each end. */
function strikeLane(s: QuenchScope, k0: number, k1: number): void {
  const d = s.st.dance;
  if (!d) return;
  const pt = (k: number): QPoint => ({
    x: d.from.x + (d.to.x - d.from.x) * k,
    z: d.from.z + (d.to.z - d.from.z) * k,
  });
  const a0 = pt(k0);
  const a1 = pt(k1);
  const b0 = pt(1 - k0);
  const b1 = pt(1 - k1);
  for (const p of livePlayers(s)) {
    if (d.struck.includes(p.id)) continue;
    const here = at(s, p);
    const near =
      segmentDistance(a0, a1, here) <= T.laneHalf || segmentDistance(b0, b1, here) <= T.laneHalf;
    if (!near) continue;
    d.struck.push(p.id);
    frostHit(s, p, roll(s, T.crossMin, T.crossMax), QUENCH_NAMES.cross);
    addCold(s, p, T.crossCold);
  }
}

function stepDance(s: QuenchScope): void {
  const st = s.st;
  if (st.half !== 'echoes') return;
  if (!st.dance) {
    if (!s.rules.dance) return;
    st.danceTimer -= DT;
    if (st.danceTimer <= 1e-9) startCrossing(s);
    return;
  }
  const d = st.dance;
  const lane = s.ctx.entities.get(d.laneId);
  const ea = s.ctx.entities.get(st.blades[d.a].objectId);
  const eb = s.ctx.entities.get(st.blades[d.b].objectId);
  d.remaining -= DT;
  if (d.phase === 'warn') {
    if (d.remaining > 1e-9) return;
    d.phase = 'fly';
    d.remaining = T.danceFly;
    if (lane) lane.templateId = laneTemplate('fly', T.danceFly);
    for (const e of [ea, eb]) if (e) setBladeObject(e, 'fly');
    const o = s.ctx.instanceOriginOf(s.inst);
    s.ctx.emit({
      type: 'spellfxAt',
      x: o.x + (d.from.x + d.to.x) / 2,
      z: o.z + (d.from.z + d.to.z) / 2,
      school: 'frost',
      fx: 'burst',
      radius: Math.hypot(d.to.x - d.from.x, d.to.z - d.from.z) / 2,
      ability: QUENCH_CUES.cross,
    });
    syncQuenchWalls(s.ctx, s.inst);
    return;
  }
  if (d.phase === 'fly') {
    // Both fly the same straight line, each from its end to the other's.
    const k0 = Math.min(1, 1 - Math.max(0, d.remaining + DT) / T.danceFly);
    const k = Math.min(1, 1 - Math.max(0, d.remaining) / T.danceFly);
    if (ea)
      moveFightObject(
        s.ctx,
        s.inst,
        ea,
        d.from.x + (d.to.x - d.from.x) * k,
        d.from.z + (d.to.z - d.from.z) * k,
      );
    if (eb)
      moveFightObject(
        s.ctx,
        s.inst,
        eb,
        d.to.x + (d.from.x - d.to.x) * k,
        d.to.z + (d.from.z - d.to.z) * k,
      );
    strikeLane(s, Math.max(0, k0), k);
    if (d.remaining > 1e-9) return;
    // Landed: the blades have swapped places; the lane cracks.
    const A = st.blades[d.a];
    const B = st.blades[d.b];
    A.x = d.to.x;
    A.z = d.to.z;
    B.x = d.from.x;
    B.z = d.from.z;
    for (const e of [ea, eb]) {
      if (!e) continue;
      setBladeObject(e, 'float');
      e.facing = s.boss.facing;
    }
    syncQuenchWalls(s.ctx, s.inst);
    d.phase = 'crack';
    d.remaining = T.laneCrack;
    if (lane) lane.templateId = laneTemplate('crack', T.laneCrack);
    for (const sp of laneHoleSpots(d.from, d.to))
      startCrack(s, sp.x, sp.z, T.laneHoleR, T.laneCrack);
    return;
  }
  if (d.remaining > 1e-9) return;
  dropFightObject(s.ctx, s.inst, d.laneId);
  st.dance = null;
}

/** One tick of the blades: their facing, the echoes, the crossing. */
export function stepBlades(s: QuenchScope): void {
  stepBladeFacing(s);
  stepEchoes(s);
  stepDance(s);
}

/** Every echo and the crossing go; the blades sink home (a reset, the fall). */
export function clearBlades(ctx: SimContext, inst: InstanceSlot, st: QuenchFightState): void {
  for (const ec of st.echoes) dropFightObject(ctx, inst, ec.objectId);
  st.echoes = [];
  if (st.dance) dropFightObject(ctx, inst, st.dance.laneId);
  st.dance = null;
  sinkBlades(ctx, inst);
  st.blades = bladesAtHome(ctx, inst);
}

/** Off the guardian: the blades' marker (a reset, the fall). */
export function clearBladeMarks(boss: Entity): void {
  dropAura(boss, QUENCH_AURAS.awake);
}
