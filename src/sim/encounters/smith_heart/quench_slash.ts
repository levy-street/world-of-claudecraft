// The blades' slashes (docs/design/raid/smith_heart.md section 7.3): every so often
// the awake blades mark players, in order, and go for each in turn. The mark's line
// runs from its blade through the player and on across the whole lake, following them
// until it locks a moment before the blade flies: the marked lead it clear of the raid,
// then step off it. The flight strikes whoever stands on the line once and goes through
// them, moving no one. The blade stays where it lands, across the lake, so the next
// line starts from somewhere new. On Mythic one blade
// makes the whole round, each slash starting where the last one ended.
//
// One line at a time: a mark waits its number. Zero rng in the picks (hashed); the
// draws are the damage rolls, in player order. Everything rides existing entity
// fields: the line is an object at the blade (its facing the way it runs, its state
// and length in the template), the mark an aura (`value` its number, `value2` the
// round's count).

import { DT, type Entity } from '../../types';
import { setBladeObject, syncQuenchWalls } from './quench_blades';
import { addCold } from './quench_cold';
import { type QPoint, segmentDistance, slashLine } from './quench_geometry';
import {
  laneTemplate,
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_NAMES,
  quenchHash,
  slashEase,
  QUENCH_TUNING as T,
} from './quench_ids';
import {
  at,
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
import type { QuenchFightState, QuenchLine, QuenchSlash } from './quench_state';
import { quenchSay } from './quench_voice';

/** Who the blades may mark: not the tank, nor anyone who cannot move, unless nobody
 *  else stands on the lake (a dev run alone). In a hashed order, never rng. */
function pickMarks(s: QuenchScope, count: number): Entity[] {
  const live = livePlayers(s);
  const tank = s.boss.aggroTargetId;
  const free = live.filter(
    (p) => p.id !== tank && !s.st.trapped[p.id] && (s.st.chill[p.id]?.frozen ?? 0) <= 0,
  );
  const salt = s.boss.id * 31 + s.st.casts * 7;
  return (free.length > 0 ? free : live)
    .map((p) => ({ p, key: quenchHash(salt, p.id) }))
    .sort((a, b) => a.key - b.key || a.p.id - b.p.id)
    .slice(0, count)
    .map((o) => o.p);
}

/** The next awake blade in rotation. */
function nextBlade(s: QuenchScope): number {
  const awake = s.st.blades.flatMap((b, i) => (b.awake ? [i] : []));
  if (awake.length === 0) return -1;
  return awake[s.st.slashes++ % awake.length];
}

function lineEnd(line: QuenchLine): QPoint {
  return {
    x: line.from.x + Math.sin(line.facing) * line.length,
    z: line.from.z + Math.cos(line.facing) * line.length,
  };
}

/** A line toward where its target stands now. */
function aimLine(s: QuenchScope, line: QuenchLine, target: Entity): void {
  const next = slashLine(line.from, at(s, target), line.facing);
  line.facing = next.facing;
  line.length = next.length;
  const lane = s.ctx.entities.get(line.laneId);
  if (lane) {
    lane.facing = next.facing;
    lane.templateId = laneTemplate('warn', line.warn, next.length);
  }
  const blade = s.ctx.entities.get(s.st.blades[line.blade].objectId);
  if (blade) blade.facing = next.facing;
}

/** Fill `line` for `blade` going through `target` in `seconds`, its object spawned. */
function layLine(
  s: QuenchScope,
  line: QuenchLine,
  blade: number,
  target: Entity,
  seconds: number,
): void {
  const b = s.st.blades[blade];
  line.blade = blade;
  line.from = { x: b.x, z: b.z };
  line.phase = 'aim';
  line.remaining = seconds;
  line.warn = seconds;
  line.struck = [];
  line.laneId = spawnFightObject(
    s.ctx,
    s.inst,
    laneTemplate('warn', seconds, T.slashMinLength),
    QUENCH_NAMES.cross,
    b.x,
    b.z,
    1,
  ).id;
  aimLine(s, line, target);
}

/** A new line for the interphase. */
export function openLine(
  s: QuenchScope,
  blade: number,
  target: Entity,
  seconds: number,
): QuenchLine {
  const line: QuenchLine = {
    blade,
    laneId: -1,
    phase: 'aim',
    remaining: seconds,
    warn: seconds,
    from: { x: 0, z: 0 },
    facing: s.boss.facing,
    length: T.slashMinLength,
    struck: [],
  };
  layLine(s, line, blade, target, seconds);
  return line;
}

function endRound(s: QuenchScope): void {
  const slash = s.st.slash;
  if (!slash) return;
  for (const id of slash.marks) {
    const p = s.ctx.entities.get(id);
    if (p) dropAura(p, QUENCH_AURAS.marked);
  }
  s.st.slash = null;
  s.st.slashTimer = s.st.half === 'lake' ? T.slashEveryLake : T.slashEveryAwake;
}

/** Begin the line for the mark at `slash.step`, or end the round. */
function beginStep(s: QuenchScope, slash: QuenchSlash): void {
  while (slash.step < slash.marks.length) {
    const target = s.players.find((p) => p.id === slash.marks[slash.step] && !p.dead);
    if (!target) {
      slash.step++;
      continue;
    }
    if (!s.rules.slashChain || slash.blade < 0) slash.blade = nextBlade(s);
    if (!s.st.blades[slash.blade]) break;
    layLine(s, slash, slash.blade, target, s.rules.slashAim);
    return;
  }
  endRound(s);
}

/** A round now: the marks, in order. Exported for the dev trigger. */
export function startSlashes(s: QuenchScope): boolean {
  const st = s.st;
  if (st.slash || st.flurry || !st.blades.some((b) => b.awake)) return false;
  const count = st.half === 'lake' ? s.rules.slashMarksLake : s.rules.slashMarksAwake;
  st.casts++;
  const picked = pickMarks(s, count);
  if (picked.length === 0) return false;
  const slash: QuenchSlash = {
    marks: picked.map((p) => p.id),
    step: 0,
    blade: -1,
    laneId: -1,
    phase: 'aim',
    remaining: 0,
    warn: 0,
    from: { x: 0, z: 0 },
    facing: 0,
    length: T.slashMinLength,
    struck: [],
  };
  st.slash = slash;
  // Each mark lasts until its own slash can have landed.
  const each = s.rules.slashAim + T.slashFly + T.slashGap;
  picked.forEach((p, i) => {
    putMarker(p, QUENCH_AURAS.marked, QUENCH_NAMES.cross, each * (i + 1), s.boss.id, {
      value: i + 1,
      value2: picked.length,
    });
  });
  const list = picked.map((p, i) => `${i + 1}. ${p.name}`).join(', ');
  raidWarn(s, s.boss, 'marks', `The blades mark ${list}! Lead them clear of the raid!`, { list });
  quenchSay(s, s.boss, 'cross');
  beginStep(s, slash);
  return true;
}

/** The line has locked and its time is up: the blade flies. */
export function launchLine(s: QuenchScope, line: QuenchLine): void {
  line.phase = 'fly';
  line.remaining = T.slashFly;
  const lane = s.ctx.entities.get(line.laneId);
  if (lane) lane.templateId = laneTemplate('fly', T.slashFly, line.length);
  const blade = s.ctx.entities.get(s.st.blades[line.blade].objectId);
  if (blade) setBladeObject(blade, 'fly');
  syncQuenchWalls(s.ctx, s.inst);
  const o = s.ctx.instanceOriginOf(s.inst);
  const to = lineEnd(line);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + (line.from.x + to.x) / 2,
    z: o.z + (line.from.z + to.z) / 2,
    school: 'frost',
    fx: 'burst',
    radius: line.length / 2,
    ability: QUENCH_CUES.cross,
  });
}

/** One flight tick: the blade on the eased curve, striking what it passes. The
 *  interphase's slashes bring no cold. */
export function flyLine(s: QuenchScope, line: QuenchLine): void {
  const to = lineEnd(line);
  const pt = (k: number): QPoint => ({
    x: line.from.x + (to.x - line.from.x) * k,
    z: line.from.z + (to.z - line.from.z) * k,
  });
  const a = pt(slashEase(1 - (line.remaining + DT) / T.slashFly));
  const b = pt(slashEase(1 - Math.max(0, line.remaining) / T.slashFly));
  const bl = s.st.blades[line.blade];
  bl.x = b.x;
  bl.z = b.z;
  const blade = s.ctx.entities.get(bl.objectId);
  if (blade) moveFightObject(s.ctx, s.inst, blade, b.x, b.z);
  for (const p of livePlayers(s)) {
    if (line.struck.includes(p.id)) continue;
    if (segmentDistance(a, b, at(s, p)) > T.laneHalf) continue;
    line.struck.push(p.id);
    frostHit(s, p, roll(s, T.crossMin, T.crossMax), QUENCH_NAMES.cross);
    if (!s.st.flurry) addCold(s, p, T.crossCold);
  }
}

/** The blade is down where the line ended, the line gone. */
export function landLine(s: QuenchScope, line: QuenchLine): void {
  const blade = s.ctx.entities.get(s.st.blades[line.blade].objectId);
  if (blade) setBladeObject(blade, 'float');
  dropFightObject(s.ctx, s.inst, line.laneId);
  line.laneId = -1;
}

/** One tick of the slashes. */
export function stepSlashes(s: QuenchScope): void {
  const st = s.st;
  const slash = st.slash;
  if (!slash) {
    // The blades wait out the guardian's awakening of the others, and the interphase.
    if (st.flurry || st.half === 'wake' || !st.blades.some((b) => b.awake)) return;
    st.slashTimer -= DT;
    if (st.slashTimer <= 1e-9) startSlashes(s);
    return;
  }
  slash.remaining -= DT;
  if (slash.phase === 'aim') {
    if (slash.remaining > T.slashLock) {
      const target = s.players.find((p) => p.id === slash.marks[slash.step] && !p.dead);
      if (!target) {
        // Gone before the line locked: on to the next mark.
        dropFightObject(s.ctx, s.inst, slash.laneId);
        slash.laneId = -1;
        slash.step++;
        beginStep(s, slash);
        return;
      }
      aimLine(s, slash, target);
    }
    if (slash.remaining <= 1e-9) launchLine(s, slash);
    return;
  }
  if (slash.phase === 'fly') {
    flyLine(s, slash);
    if (slash.remaining <= 1e-9) {
      landLine(s, slash);
      const p = s.ctx.entities.get(slash.marks[slash.step]);
      if (p) dropAura(p, QUENCH_AURAS.marked);
      slash.phase = 'rest';
      slash.remaining = T.slashGap;
    }
    return;
  }
  if (slash.remaining > 1e-9) return;
  slash.step++;
  beginStep(s, slash);
}

/** Every line and mark goes (a reset, the fall). */
export function clearSlashes(s: Pick<QuenchScope, 'ctx' | 'inst'>, st: QuenchFightState): void {
  const slash = st.slash;
  if (!slash) return;
  if (slash.laneId >= 0) dropFightObject(s.ctx, s.inst, slash.laneId);
  for (const id of slash.marks) {
    const p = s.ctx.entities.get(id);
    if (p) dropAura(p, QUENCH_AURAS.marked);
  }
  st.slash = null;
}
