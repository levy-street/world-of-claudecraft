// The Masterless Strength's Quench star, Crossing Blade (docs/design/raid/
// smith_heart.md section 7.5, the rework of 2026-11-18): the Guardian of the
// Quench's great swords of ice, sweeping the Anvil of the World.
//
//   A round      the tier's `bladeMarks` hashed players (never the tank while
//                anyone else stands), one after another.
//   The line     a sword of ice rises at the rim across the room from its mark
//                and its line runs from it through the mark to the far rim,
//                following the mark (the line turns about the blade) until it
//                locks `bladeLock` before it flies: the mark steers it. Every
//                player on it when it flies is struck once.
//   The pillars  the flight shatters every pillar its line crosses
//                (final_pillars.ts): the raid lays the line through the
//                stone to clear the room, the charged pillars first.
//
// Zero rng in every pick (hashed); the draws are the damage rolls, in player
// order.

import { HEART_ROOM } from '../../content/smith_heart_layout';
import { HEART_QUARTERS } from '../../content/smith_heart_quarters';
import { DT, type Entity } from '../../types';
import {
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_NAMES,
  finalBladeTemplate,
  finalHash,
  finalLaneTemplate,
  FINAL_TUNING as T,
} from './final_ids';
import { shatterPillar } from './final_pillars';
import {
  at,
  cueAt,
  dropAura,
  dropFightObject,
  type FinalScope,
  type FPoint,
  facingTo,
  hit,
  livePlayers,
  moveFightObject,
  overTheVoid,
  pickPlayers,
  putMarker,
  roll,
  spawnFightObject,
} from './final_scope';
import type { FinalBladeRun } from './final_state';
import { segmentDistance } from './quench_geometry';

/** How far in from the platform's edge a blade rises and its line stops. */
const RIM_IN = 1.5;

/** The rim's circle a line runs inside. */
function rimR(): number {
  return HEART_ROOM.r - RIM_IN;
}

/** Where a blade rises for a mark at `p` (pure over its inputs): on the rim
 *  to one side of the mark (a hashed side and turn, 30 to 70 degrees round
 *  the rim from the mark's own bearing), at least `bladeMinReach` from it,
 *  so the blade is near its mark and the line runs from it through the mark
 *  across the room. Its online reach: the blade and its line stay within
 *  the marked player's interest (90 yd), never across the whole room. */
export function bladeOrigin(p: FPoint, hash: number): FPoint {
  const c = HEART_ROOM;
  const bearing = Math.atan2(p.x - c.x, p.z - c.z);
  const side = hash % 2 === 0 ? 1 : -1;
  const turn = ((30 + (hash % 41)) * Math.PI) / 180;
  for (const t of [turn, turn + Math.PI / 4, -turn, Math.PI]) {
    const a = bearing + side * t;
    const o = { x: c.x + Math.sin(a) * rimR(), z: c.z + Math.cos(a) * rimR() };
    if (Math.hypot(o.x - p.x, o.z - p.z) >= T.bladeMinReach) return o;
  }
  const a = bearing + Math.PI;
  return { x: c.x + Math.sin(a) * rimR(), z: c.z + Math.cos(a) * rimR() };
}

/** The line's middle (its object stands there: the whole line within
 *  reach of the room's players online). */
export function laneMiddle(from: FPoint, facing: number, length: number): FPoint {
  return along(from, facing, length / 2);
}

/** Where a blade rises over standing floor (Mythic's collapse: never over a
 *  fallen quarter): the rim across from its mark, else turned round the rim,
 *  else the ring's edge across from it. */
function standingOrigin(s: FinalScope, p: FPoint, hash: number): FPoint {
  const o = bladeOrigin(p, hash);
  if (!overTheVoid(s, o)) return o;
  const c = HEART_ROOM;
  const bearing = Math.atan2(p.x - c.x, p.z - c.z);
  for (const turn of [60, -60, 120, -120, 180]) {
    const a = bearing + (turn * Math.PI) / 180;
    const q = { x: c.x + Math.sin(a) * rimR(), z: c.z + Math.cos(a) * rimR() };
    if (!overTheVoid(s, q)) return q;
  }
  const a = bearing + Math.PI;
  const r = HEART_QUARTERS.ringR - 1;
  return { x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r };
}

/** A line from `from` (on the rim) heading `facing`: its length to the far
 *  rim (pure). */
export function lineLength(from: FPoint, facing: number): number {
  const dx = Math.sin(facing);
  const dz = Math.cos(facing);
  const ox = from.x - HEART_ROOM.x;
  const oz = from.z - HEART_ROOM.z;
  // |o + t d| = R: t^2 + 2 (o.d) t + |o|^2 - R^2 = 0, the far root.
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - rimR() * rimR();
  const disc = b * b - c;
  if (disc <= 0) return 4;
  return Math.max(4, -b + Math.sqrt(disc));
}

/** A point along a line. */
function along(from: FPoint, facing: number, d: number): FPoint {
  return { x: from.x + Math.sin(facing) * d, z: from.z + Math.cos(facing) * d };
}

/** Does a pillar's footprint come within the line's reach of a segment? */
export function bladeCrossesPillar(a: FPoint, b: FPoint, pillar: FPoint): boolean {
  return segmentDistance(a, b, pillar) <= T.pillarR + T.bladeHalf;
}

/** The line's length over standing floor: to the far rim, cut short where
 *  it would first cross a fallen quarter (Mythic's collapse). */
function standingLength(s: FinalScope, from: FPoint, facing: number): number {
  const full = lineLength(from, facing);
  if (s.st.phase.fallenMask === 0) return full;
  for (let d = 1; d < full; d += 1)
    if (overTheVoid(s, along(from, facing, d))) return Math.max(4, d - 1);
  return full;
}

function aimAt(s: FinalScope, run: FinalBladeRun, target: Entity): void {
  run.facing = facingTo(run.from, at(s, target));
  run.length = standingLength(s, run.from, run.facing);
  const lane = s.ctx.entities.get(run.laneId);
  if (lane) {
    const mid = laneMiddle(run.from, run.facing, run.length);
    moveFightObject(s.ctx, s.inst, lane, mid.x, mid.z);
    lane.facing = run.facing;
    lane.templateId = finalLaneTemplate(run.left > T.bladeLock ? 'warn' : 'lock', run.length);
  }
  const blade = s.ctx.entities.get(run.bladeId);
  if (blade) blade.facing = run.facing;
}

/** Begin the next mark's line, or end the round. */
function nextBlade(s: FinalScope): void {
  const st = s.st.stars;
  while (st.bladeQueue.length > 0) {
    const pid = st.bladeQueue.shift() as number;
    const target = livePlayers(s).find((p) => p.id === pid);
    if (!target) continue;
    const from = standingOrigin(s, at(s, target), finalHash(s.boss.id + pid, st.volleys));
    const blade = spawnFightObject(
      s.ctx,
      s.inst,
      finalBladeTemplate('aim'),
      FINAL_NAMES.blade,
      from.x,
      from.z,
      1,
    );
    const lane = spawnFightObject(
      s.ctx,
      s.inst,
      finalLaneTemplate('warn', 4),
      FINAL_NAMES.blade,
      from.x,
      from.z,
      1,
    );
    const run: FinalBladeRun = {
      bladeId: blade.id,
      laneId: lane.id,
      target: pid,
      phase: 'aim',
      left: s.rules.bladeAim,
      from,
      facing: 0,
      length: 4,
      flown: 0,
      struck: [],
    };
    st.blade = run;
    putMarker(target, FINAL_AURAS.bladeMark, FINAL_NAMES.blade, s.rules.bladeAim, s.boss.id, {
      value: 1,
      school: 'frost',
    });
    aimAt(s, run, target);
    return;
  }
  st.blade = null;
}

/** A round of blades now (exported for the dev verb and the tests): the
 *  tier's count of marks, in turn. Returns the marks. */
export function startBlades(s: FinalScope, forced?: Entity): Entity[] {
  const st = s.st.stars;
  if (st.blade || st.bladeQueue.length > 0) return [];
  const salt = s.boss.id * 19 + st.volleys * 23 + 1501;
  st.volleys++;
  const marks = forced ? [forced] : pickPlayers(s, s.rules.bladeMarks, salt);
  st.bladeQueue = marks.map((p) => p.id);
  nextBlade(s);
  return marks;
}

/** The blade flies: its line locked, the lane lit for the flight. */
function launch(s: FinalScope, run: FinalBladeRun): void {
  run.phase = 'fly';
  run.left = T.bladeFly;
  run.flown = 0;
  const lane = s.ctx.entities.get(run.laneId);
  if (lane) lane.templateId = finalLaneTemplate('fly', run.length);
  const blade = s.ctx.entities.get(run.bladeId);
  if (blade) blade.templateId = finalBladeTemplate('fly');
  const target = s.ctx.entities.get(run.target);
  if (target) dropAura(target, FINAL_AURAS.bladeMark);
  const mid = along(run.from, run.facing, run.length / 2);
  cueAt(s, FINAL_CUES.blade, mid.x, mid.z, run.length / 2, 'frost');
}

/** One flight tick: the blade along its line, striking and shattering what
 *  it passes. */
function fly(s: FinalScope, run: FinalBladeRun): void {
  const k = Math.min(1, 1 - Math.max(0, run.left) / T.bladeFly);
  const a = along(run.from, run.facing, run.length * run.flown);
  const b = along(run.from, run.facing, run.length * k);
  run.flown = k;
  const blade = s.ctx.entities.get(run.bladeId);
  if (blade) moveFightObject(s.ctx, s.inst, blade, b.x, b.z);
  for (const p of livePlayers(s)) {
    if (run.struck.includes(p.id)) continue;
    if (segmentDistance(a, b, at(s, p)) > T.bladeHalf) continue;
    run.struck.push(p.id);
    hit(s, p, roll(s, T.bladeMin, T.bladeMax), FINAL_NAMES.blade, 'frost');
  }
  for (const pl of [...s.st.stars.pillars]) if (bladeCrossesPillar(a, b, pl)) shatterPillar(s, pl);
}

/** One tick of the round in flight. */
export function stepBlades(s: FinalScope): void {
  const st = s.st.stars;
  const run = st.blade;
  if (!run) return;
  run.left -= DT;
  if (run.phase === 'aim') {
    const target = livePlayers(s).find((p) => p.id === run.target);
    if (!target) {
      dropFightObject(s.ctx, s.inst, run.bladeId);
      dropFightObject(s.ctx, s.inst, run.laneId);
      nextBlade(s);
      return;
    }
    if (run.left > T.bladeLock) aimAt(s, run, target);
    else {
      const lane = s.ctx.entities.get(run.laneId);
      const locked = finalLaneTemplate('lock', run.length);
      if (lane && lane.templateId !== locked) {
        lane.templateId = locked;
        const mark = target.auras.find((a) => a.id === FINAL_AURAS.bladeMark);
        if (mark) mark.value = 2;
      }
    }
    if (run.left <= 1e-9) launch(s, run);
    return;
  }
  if (run.phase === 'fly') {
    fly(s, run);
    if (run.left <= 1e-9) {
      dropFightObject(s.ctx, s.inst, run.bladeId);
      dropFightObject(s.ctx, s.inst, run.laneId);
      run.phase = 'rest';
      run.left = T.bladeGap;
    }
    return;
  }
  if (run.left <= 1e-9) nextBlade(s);
}

/** Every blade, line and mark gone (a wipe, the kill). */
export function clearBlades(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'st'>,
  players: readonly Entity[],
): void {
  const st = s.st.stars;
  if (st.blade) {
    dropFightObject(s.ctx, s.inst, st.blade.bladeId);
    dropFightObject(s.ctx, s.inst, st.blade.laneId);
  }
  st.blade = null;
  st.bladeQueue = [];
  for (const p of players) dropAura(p, FINAL_AURAS.bladeMark);
}
