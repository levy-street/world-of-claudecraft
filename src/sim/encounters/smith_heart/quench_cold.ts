// The Guardian of the Quench's frostbite (docs/design/raid/smith_heart.md
// section 7.3): every player in the basin carries a cold bar (0 to 100).
//
//   The cold      alone it rises (full in about 24 s); within 6 yd of two or
//                 more other players (a huddle) it falls instead, and the
//                 huddle wears its warmth (an aura every client draws).
//   Frozen solid  at full the player freezes where they stand (an unbreakable
//                 stun, double damage taken) and the bar resets; 6 s later
//                 the ice SHATTERS: a hit on them, cold splashed onto everyone
//                 close (a chain if it fills another bar), then Frost-Brittle,
//                 more damage taken for 15 s. Heroic's contagious cold
//                 splashes further and harder.
//   Bounded       a player takes one splash a tick however many shatter at
//                 once (a frozen one takes none), and a splash never takes a
//                 Frost-Brittle player past 80: one who just shattered has
//                 seconds alone before a chain can freeze them again, so a
//                 wave of shatters cannot lock the raid in a burst.
//   Immunities    never warmth (quench_bite.ts): a body in stasis gives and
//                 takes no warmth, and the rime cracks a breakable immunity
//                 as its wearer freezes, stays frozen or shatters.
//   Deepening     through phase 2 the cold rises faster every 20 s, without
//                 end (a stack on the guardian): the soft enrage.
//   Living Rime   while it holds (quench_rime.ts), its carrier's bar rises
//                 the tier's rimeColdMult times as fast (twice on Normal,
//                 half again on Heroic and Mythic; alone, as the rime sends
//                 them); a burst of it splashes like a shatter (`splashRound`).
//
// A player in the water (quench_ice.ts) takes no warmth and gives none, and
// their bar stops one short of full (the water never freezes them solid). A
// frozen player gives no warmth either. Zero rng but the damage rolls, in
// player order.

import { DT, type Entity } from '../../types';
import { biteThrough, warded } from './quench_bite';
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
  lakeListeners,
  livePlayers,
  putMarker,
  type QuenchScope,
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

/** Frost-Brittle at `pct` for `seconds` (the freeze's, or the shatter's). */
function brittle(s: QuenchScope, p: Entity, pct: number, seconds: number): void {
  dropAura(p, QUENCH_AURAS.brittle);
  s.ctx.applyAura(p, {
    id: QUENCH_AURAS.brittle,
    name: QUENCH_NAMES.brittle,
    kind: 'vulnerability',
    remaining: seconds,
    duration: seconds,
    value: pct,
    sourceId: s.boss.id,
    school: 'frost',
    undispellable: true,
  });
}

/** Freeze `p` solid: the bar resets, an unbreakable stun until the shatter,
 *  double damage taken while it holds; the rime cracks any immunity they
 *  wear. Exported for the dev trigger. */
export function freezePlayer(s: QuenchScope, p: Entity): void {
  const c = chillOf(s, p.id);
  c.cold = 0;
  c.frozen = T.freezeSeconds;
  setWarm(s, p, false);
  biteThrough(s, p);
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
  brittle(s, p, T.frozenPct, T.freezeSeconds);
  showCold(s, p, 0, 0);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.freeze,
  });
}

/** Add `amount` cold to `p` (a hit's chill, a splash). A full bar freezes
 *  them now (never in the water: one short of full there; nor, with `soft`,
 *  while they are Frost-Brittle: a splash stops at brittleSplashCap then).
 *  Returns the cold actually added. */
export function addCold(s: QuenchScope, p: Entity, amount: number, soft = false): number {
  if (p.dead) return 0;
  const c = chillOf(s, p.id);
  if (c.frozen > 0) return 0;
  const trapped = s.st.trapped[p.id] !== undefined;
  const brittleNow = soft && auraOf(p, QUENCH_AURAS.brittle) !== undefined;
  const held = trapped || brittleNow;
  const cap = brittleNow
    ? Math.max(c.cold, T.brittleSplashCap)
    : trapped
      ? T.coldMax - 1
      : T.coldMax;
  const before = c.cold;
  const next = Math.max(before, Math.min(cap, before + amount));
  c.cold = next;
  if (!held && next >= T.coldMax - 1e-9) freezePlayer(s, p);
  else showCold(s, p, next, 1);
  return next - before;
}

/** A shatter's splash on `q`: its cold (one a tick, however many shatter at
 *  once; never a freeze while they are Frost-Brittle) and the mark the
 *  client's shards and the player's own alert read. Returns false when the
 *  tick's one splash had already struck them. */
function splash(s: QuenchScope, q: Entity, from: Entity): boolean {
  // The frozen are sealed in their own ice: nothing reaches them.
  if (isFrozen(s, q.id)) return false;
  const struck = s.splashed ?? new Set<number>();
  s.splashed = struck;
  if (struck.has(q.id)) return false;
  struck.add(q.id);
  const added = addCold(s, q, s.rules.splashCold, true);
  // Only a splash that moved the bar marks them (no "+0" alert or shard).
  if (added > 0.5)
    putMarker(q, QUENCH_AURAS.splashed, QUENCH_NAMES.splashed, T.splashMarkSeconds, s.boss.id, {
      value: Math.round(added),
      value2: from.id,
      school: 'frost',
    });
  return true;
}

/** The ice round a frozen player shatters: the hit, the splash, the brittle
 *  debuff. Returns the players the splash reached (the tests read it). */
export function shatter(s: QuenchScope, p: Entity): Entity[] {
  const c = chillOf(s, p.id);
  c.frozen = 0;
  biteThrough(s, p);
  dropAura(p, QUENCH_AURAS.frozen);
  // The freeze's double damage ends as the ice breaks: the shatter's own hit
  // lands on the plain body.
  dropAura(p, QUENCH_AURAS.brittle);
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
  frostHit(s, p, roll(s, T.shatterMin, T.shatterMax, s.rules.shatterMult), QUENCH_NAMES.shatter);
  if (!p.dead) brittle(s, p, T.brittlePct, T.brittleSeconds);
  quenchSay(s, s.boss, 'shatter');
  return splashRound(s, p, s.rules.splashR);
}

/** Cold splashed from `from` onto every other living player within `radius`
 *  (the tier's splashCold each, one splash a tick, bounded by Frost-Brittle):
 *  a shatter's, and a Living Rime's burst. Returns the players it reached. */
export function splashRound(s: QuenchScope, from: Entity, radius: number): Entity[] {
  const here = at(s, from);
  const splashed: Entity[] = [];
  for (const q of livePlayers(s)) {
    if (q.id === from.id) continue;
    const there = at(s, q);
    if (Math.hypot(there.x - here.x, there.z - here.z) > radius) continue;
    if (splash(s, q, from)) splashed.push(q);
  }
  return splashed;
}

/** One tick of every player's cold. */
export function stepCold(s: QuenchScope): void {
  const st = s.st;
  // The bodies that give warmth: living, not frozen, not in the water, not
  // sealed in an immunity.
  const donors: QBody[] = [];
  for (const p of s.players) {
    if (p.dead || isFrozen(s, p.id) || st.trapped[p.id] !== undefined || warded(p)) continue;
    const here = at(s, p);
    donors.push({ id: p.id, x: here.x, z: here.z });
  }
  const mult = deepenMult(st.deepenStacks);
  for (const p of s.players) {
    if (p.dead) continue;
    const c = chillOf(s, p.id);
    if (c.frozen > 0) {
      // No immunity holds inside the rime (an Ice Block pressed in the ice).
      if (warded(p)) biteThrough(s, p);
      c.frozen -= DT;
      if (c.frozen <= 1e-9) shatter(s, p);
      continue;
    }
    const trapped = st.trapped[p.id] !== undefined;
    // An immunity is no warmth: its wearer's bar rises as if alone.
    const sealed = warded(p);
    let others = 0;
    if (!trapped && !sealed) {
      const here = at(s, p);
      others = warmNeighbours({ id: p.id, x: here.x, z: here.z }, donors);
    }
    // The interphase holds the cold: a huddle still warms, nothing else moves it.
    const rising = coldStep(others, mult);
    // Living Rime's carrier: the bar rises the tier's rimeColdMult times as
    // fast while it holds.
    const raw =
      rising > 0 && auraOf(p, QUENCH_AURAS.rime) !== undefined
        ? rising * s.rules.rimeColdMult
        : rising;
    const step = st.flurry && raw > 0 ? 0 : raw;
    setWarm(s, p, !trapped && !sealed && others >= T.warmNeed);
    const cap = trapped ? T.coldMax - 1 : T.coldMax;
    c.cold = Math.max(0, Math.min(cap, c.cold + step * DT));
    if (!trapped && c.cold >= T.coldMax - 1e-9) {
      freezePlayer(s, p);
      continue;
    }
    showCold(s, p, c.cold, step < 0 ? -1 : 1);
  }
  // A player gone from the basin leaves the fight's marks: the dead, and
  // the living gone far from the lake. A living player just off the ice
  // (a leap, a flight over the floor band) keeps their bar, held where it
  // stands, so leaving the lake for a moment never resets it.
  let near: Entity[] | null = null;
  for (const key of Object.keys(st.chill)) {
    const id = Number(key);
    if (s.players.some((p) => p.id === id && !p.dead)) continue;
    const e = s.ctx.entities.get(id);
    if (e && !e.dead) {
      near ??= lakeListeners(s.ctx, s.inst);
      if (near.some((q) => q.id === id)) continue;
    }
    if (e) clearColdMarks(e);
    delete st.chill[id];
  }
}

/** Phase 2: the cold deepens every 20 s, without end. */
export function stepDeepening(s: QuenchScope): void {
  const st = s.st;
  if (st.half !== 'awake' || st.flurry) return;
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

/** Every mark of the cold off one body (a reset, a fall, a departure), the
 *  brittle and a splash's mark with it. */
export function clearColdMarks(e: Entity): void {
  dropAura(e, QUENCH_AURAS.cold);
  dropAura(e, QUENCH_AURAS.warmth);
  dropAura(e, QUENCH_AURAS.frozen);
  dropAura(e, QUENCH_AURAS.brittle);
  dropAura(e, QUENCH_AURAS.splashed);
}
