// The Guardian of the Quench's frostbite (docs/design/raid/smith_heart.md
// section 7.3): every player in the basin carries a cold bar (0 to 100).
//
//   The cold      alone it rises (full in about 30 s); within 6 yd of two or
//                 more other players (a huddle) it falls instead, and the
//                 huddle wears its warmth (an aura every client draws).
//   Frozen solid  at full the player freezes where they stand (an unbreakable
//                 stun) and the bar resets; 4 s later the ice SHATTERS: a hit
//                 on them, cold splashed onto everyone close (a chain if it
//                 fills another bar), then Frost-Brittle, more damage taken
//                 for 15 s. Heroic's contagious cold splashes further and
//                 harder.
//   Deepening     through phase 2 the cold rises faster every 20 s, without
//                 end (a stack on the guardian): the soft enrage.
//
// A player in the water (quench_ice.ts) takes no warmth and gives none, and
// their bar stops one short of full (the water never freezes them solid). A
// frozen player gives no warmth either. Zero rng but the damage rolls, in
// player order.

import { DT, type Entity } from '../../types';
import { type QBody, warmNeighbours } from './quench_geometry';
import {
  coldStep,
  deepenMult,
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_NAMES,
  QUENCH_TUNING as T,
} from './quench_ids';
import {
  at,
  auraOf,
  dropAura,
  frostHit,
  livePlayers,
  putMarker,
  type QuenchScope,
  raidWarn,
  roll,
} from './quench_scope';
import type { QuenchChill } from './quench_state';
import { quenchSay } from './quench_voice';

/** A player's chill entry (made on first need). */
export function chillOf(s: Pick<QuenchScope, 'st'>, id: number): QuenchChill {
  let c = s.st.chill[id];
  if (!c) {
    c = { cold: 0, frozen: 0 };
    s.st.chill[id] = c;
  }
  return c;
}

/** Write the bar onto the player's cold aura (the rounded value and the
 *  trend: what every client reads). */
function showCold(s: QuenchScope, p: Entity, cold: number, trend: number): void {
  const v = Math.round(cold);
  const a = auraOf(p, QUENCH_AURAS.cold);
  if (!a) {
    putMarker(p, QUENCH_AURAS.cold, QUENCH_NAMES.cold, 3600, s.boss.id, {
      permanent: true,
      value: v,
      value2: trend,
      school: 'frost',
    });
    return;
  }
  if (a.value !== v) a.value = v;
  if (a.value2 !== trend) a.value2 = trend;
}

function setWarm(s: QuenchScope, p: Entity, warm: boolean): void {
  const has = p.auras.some((a) => a.id === QUENCH_AURAS.warmth);
  if (warm && !has)
    putMarker(p, QUENCH_AURAS.warmth, QUENCH_NAMES.warmth, 3600, s.boss.id, {
      permanent: true,
      school: 'frost',
    });
  else if (!warm && has) dropAura(p, QUENCH_AURAS.warmth);
}

/** Is `id` frozen solid now? */
export function isFrozen(s: Pick<QuenchScope, 'st'>, id: number): boolean {
  return (s.st.chill[id]?.frozen ?? 0) > 0;
}

/** Freeze `p` solid: the bar resets, an unbreakable stun until the shatter.
 *  Exported for the dev trigger. */
export function freezePlayer(s: QuenchScope, p: Entity): void {
  const c = chillOf(s, p.id);
  c.cold = 0;
  c.frozen = T.freezeSeconds;
  setWarm(s, p, false);
  s.ctx.applyAura(p, {
    id: QUENCH_AURAS.frozen,
    name: QUENCH_NAMES.frozen,
    kind: 'stun',
    remaining: T.freezeSeconds,
    duration: T.freezeSeconds,
    // The shatter's splash radius (the difficulty's): every client rings it.
    value: s.rules.splashR,
    sourceId: s.boss.id,
    school: 'frost',
    unbreakableControl: true,
    undispellable: true,
  });
  showCold(s, p, 0, 0);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.freeze,
  });
  raidWarn(s, s.boss, 'frozen', `${p.name} is frozen solid! Step away before the ice shatters!`, {
    player: p.name,
  });
}

/** Add `amount` cold to `p` (a hit's chill, a splash). A full bar freezes
 *  them now (never in the water: one short of full there). */
export function addCold(s: QuenchScope, p: Entity, amount: number): void {
  if (p.dead) return;
  const c = chillOf(s, p.id);
  if (c.frozen > 0) return;
  const trapped = s.st.trapped[p.id] !== undefined;
  const cap = trapped ? T.coldMax - 1 : T.coldMax;
  c.cold = Math.min(cap, c.cold + amount);
  if (!trapped && c.cold >= T.coldMax - 1e-9) freezePlayer(s, p);
  else showCold(s, p, c.cold, 1);
}

/** The ice round a frozen player shatters: the hit, the splash, the brittle
 *  debuff. Returns the players the splash reached (the tests read it). */
export function shatter(s: QuenchScope, p: Entity): Entity[] {
  const c = chillOf(s, p.id);
  c.frozen = 0;
  dropAura(p, QUENCH_AURAS.frozen);
  const o = s.ctx.instanceOriginOf(s.inst);
  const here = at(s, p);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + here.x,
    z: o.z + here.z,
    school: 'frost',
    fx: 'burst',
    radius: s.rules.splashR,
    ability: QUENCH_CUES.shatter,
  });
  frostHit(s, p, roll(s, T.shatterMin, T.shatterMax), QUENCH_NAMES.shatter);
  if (!p.dead)
    s.ctx.applyAura(p, {
      id: QUENCH_AURAS.brittle,
      name: QUENCH_NAMES.brittle,
      kind: 'vulnerability',
      remaining: T.brittleSeconds,
      duration: T.brittleSeconds,
      value: T.brittlePct,
      sourceId: s.boss.id,
      school: 'frost',
      undispellable: true,
    });
  quenchSay(s, s.boss, 'shatter');
  const splashed: Entity[] = [];
  for (const q of livePlayers(s)) {
    if (q.id === p.id) continue;
    const there = at(s, q);
    if (Math.hypot(there.x - here.x, there.z - here.z) > s.rules.splashR) continue;
    splashed.push(q);
    addCold(s, q, s.rules.splashCold);
  }
  return splashed;
}

/** One tick of every player's cold. */
export function stepCold(s: QuenchScope): void {
  const st = s.st;
  // The bodies that give warmth: living, not frozen, not in the water.
  const donors: QBody[] = [];
  for (const p of s.players) {
    if (p.dead || isFrozen(s, p.id) || st.trapped[p.id] !== undefined) continue;
    const here = at(s, p);
    donors.push({ id: p.id, x: here.x, z: here.z });
  }
  const mult = deepenMult(st.deepenStacks);
  for (const p of s.players) {
    if (p.dead) continue;
    const c = chillOf(s, p.id);
    if (c.frozen > 0) {
      c.frozen -= DT;
      if (c.frozen <= 1e-9) shatter(s, p);
      continue;
    }
    const trapped = st.trapped[p.id] !== undefined;
    let others = 0;
    if (!trapped) {
      const here = at(s, p);
      others = warmNeighbours({ id: p.id, x: here.x, z: here.z }, donors);
    }
    const step = coldStep(others, mult);
    setWarm(s, p, !trapped && others >= T.warmNeed);
    const cap = trapped ? T.coldMax - 1 : T.coldMax;
    c.cold = Math.max(0, Math.min(cap, c.cold + step * DT));
    if (!trapped && c.cold >= T.coldMax - 1e-9) {
      freezePlayer(s, p);
      continue;
    }
    showCold(s, p, c.cold, step < 0 ? -1 : 1);
  }
  // A player gone from the basin (dead, or away) leaves the fight's marks.
  for (const key of Object.keys(st.chill)) {
    const id = Number(key);
    if (s.players.some((p) => p.id === id && !p.dead)) continue;
    const e = s.ctx.entities.get(id);
    if (e) clearColdMarks(e);
    delete st.chill[id];
  }
}

/** Phase 2: the cold deepens every 20 s, without end. */
export function stepDeepening(s: QuenchScope): void {
  const st = s.st;
  if (st.half !== 'echoes') return;
  st.deepenTimer -= DT;
  if (st.deepenTimer > 1e-9) return;
  st.deepenTimer += T.deepenEvery;
  st.deepenStacks++;
  const b = s.boss;
  const have = auraOf(b, QUENCH_AURAS.deepening);
  if (have) have.stacks = st.deepenStacks;
  else
    putMarker(b, QUENCH_AURAS.deepening, QUENCH_NAMES.deepening, 3600, b.id, {
      permanent: true,
      stacks: st.deepenStacks,
      school: 'frost',
    });
  if (st.deepenStacks >= 3) quenchSay(s, b, 'deepen');
}

/** Every mark of the cold off one body (a reset, a fall, a departure). The
 *  brittle debuff runs out on its own. */
export function clearColdMarks(e: Entity): void {
  dropAura(e, QUENCH_AURAS.cold);
  dropAura(e, QUENCH_AURAS.warmth);
  dropAura(e, QUENCH_AURAS.frozen);
}
