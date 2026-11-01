// The blades' slashes (docs/design/raid/smith_heart.md section 7.3): every so often
// the awake blades mark players, in order, and go for each in turn. The mark's line
// runs from its blade through the player and past them, following them until it locks
// a moment before the blade flies: the marked lead it clear of the raid, then step off
// it. The flight strikes and throws whoever stands on the line once. The blade stays
// where it lands, so the next line starts from somewhere new. On Mythic one blade
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
import type { QuenchFightState, QuenchSlash } from './quench_state';
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

function lineEnd(slash: QuenchSlash): QPoint {
  return {
    x: slash.from.x + Math.sin(slash.facing) * slash.length,
    z: slash.from.z + Math.cos(slash.facing) * slash.length,
  };
}

/** The current mark's line toward where they stand now. */
function aimLine(s: QuenchScope, slash: QuenchSlash, target: Entity): void {
  const line = slashLine(slash.from, at(s, target), slash.facing);
  slash.facing = line.facing;
  slash.length = line.length;
  const lane = s.ctx.entities.get(slash.laneId);
  if (lane) {
    lane.facing = line.facing;
    lane.templateId = laneTemplate('warn', s.rules.slashAim, line.length);
  }
  const blade = s.ctx.entities.get(s.st.blades[slash.blade].objectId);
  if (blade) blade.facing = line.facing;
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
    const b = s.st.blades[slash.blade];
    if (!b) break;
    slash.from = { x: b.x, z: b.z };
    slash.phase = 'aim';
    slash.remaining = s.rules.slashAim;
    slash.struck = [];
    const lane = spawnFightObject(
      s.ctx,
      s.inst,
      laneTemplate('warn', s.rules.slashAim, T.slashMinLength),
      QUENCH_NAMES.cross,
      b.x,
      b.z,
      1,
    );
    slash.laneId = lane.id;
    aimLine(s, slash, target);
    return;
  }
  endRound(s);
}

/** A round now: the marks, in order. Exported for the dev trigger. */
export function startSlashes(s: QuenchScope): boolean {
  const st = s.st;
  if (st.slash || !st.blades.some((b) => b.awake)) return false;
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
function launch(s: QuenchScope, slash: QuenchSlash): void {
  slash.phase = 'fly';
  slash.remaining = T.slashFly;
  const lane = s.ctx.entities.get(slash.laneId);
  if (lane) lane.templateId = laneTemplate('fly', T.slashFly, slash.length);
  const blade = s.ctx.entities.get(s.st.blades[slash.blade].objectId);
  if (blade) setBladeObject(blade, 'fly');
  syncQuenchWalls(s.ctx, s.inst);
  const o = s.ctx.instanceOriginOf(s.inst);
  const to = lineEnd(slash);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + (slash.from.x + to.x) / 2,
    z: o.z + (slash.from.z + to.z) / 2,
    school: 'frost',
    fx: 'burst',
    radius: slash.length / 2,
    ability: QUENCH_CUES.cross,
  });
}

/** One flight tick: the blade on the eased curve, striking what it passes. */
function fly(s: QuenchScope, slash: QuenchSlash): void {
  const to = lineEnd(slash);
  const pt = (k: number): QPoint => ({
    x: slash.from.x + (to.x - slash.from.x) * k,
    z: slash.from.z + (to.z - slash.from.z) * k,
  });
  const a = pt(slashEase(1 - (slash.remaining + DT) / T.slashFly));
  const b = pt(slashEase(1 - Math.max(0, slash.remaining) / T.slashFly));
  const bl = s.st.blades[slash.blade];
  bl.x = b.x;
  bl.z = b.z;
  const blade = s.ctx.entities.get(bl.objectId);
  if (blade) moveFightObject(s.ctx, s.inst, blade, b.x, b.z);
  for (const p of livePlayers(s)) {
    if (slash.struck.includes(p.id)) continue;
    if (segmentDistance(a, b, at(s, p)) > T.laneHalf) continue;
    slash.struck.push(p.id);
    frostHit(s, p, roll(s, T.crossMin, T.crossMax), QUENCH_NAMES.cross);
    addCold(s, p, T.crossCold);
    if (blade) s.ctx.applyKnockback(blade, p, T.slashKnock);
  }
}

/** The blade is down where the line ended: the mark is spent. */
function land(s: QuenchScope, slash: QuenchSlash): void {
  const blade = s.ctx.entities.get(s.st.blades[slash.blade].objectId);
  if (blade) setBladeObject(blade, 'float');
  dropFightObject(s.ctx, s.inst, slash.laneId);
  slash.laneId = -1;
  const p = s.ctx.entities.get(slash.marks[slash.step]);
  if (p) dropAura(p, QUENCH_AURAS.marked);
  slash.phase = 'rest';
  slash.remaining = T.slashGap;
}

/** One tick of the slashes. */
export function stepSlashes(s: QuenchScope): void {
  const st = s.st;
  const slash = st.slash;
  if (!slash) {
    // The blades wait out the guardian's awakening of the others.
    if (st.half === 'wake' || !st.blades.some((b) => b.awake)) return;
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
    if (slash.remaining <= 1e-9) launch(s, slash);
    return;
  }
  if (slash.phase === 'fly') {
    fly(s, slash);
    if (slash.remaining <= 1e-9) land(s, slash);
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
