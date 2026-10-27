// The Frozen Lake's ice under the Guardian of the Quench (docs/design/raid/
// smith_heart.md section 7.3): warmth comes from huddling, and huddling
// breaks the ice.
//
//   The strain   a huddle (three or more warm players together,
//                quench_geometry.ts huddlesOf) strains the ice where it
//                stands; a spot loaded for 8 s (its middle within 4 yd of
//                where it began) cracks. An unloaded spot heals slowly, so a
//                group that keeps moving its huddle never breaks through.
//   The crack    2.5 s of groaning ice (its footprint at the hole's exact
//                radius), then it opens: a round hole of freezing water.
//   The holes    stay for the rest of the fight (past 30 the oldest skins
//                over), so the safe ice shrinks and the raid keeps moving.
//                On the guardian's fall the whole lake refreezes.
//   The water    a body whose middle goes inside a hole's rim falls in
//                (walking, standing where one opens, a crossing blade's
//                lane): held in the water (an unbreakable root) for 4 s, the
//                plunge's hit and a hit each second, its cold climbing, then
//                it climbs out on the rim and has a moment before the water
//                can take it again. The water never kills on its own: its
//                hits stop one short of a body's last point of health.
//
// Only the lake's ice breaks (the shore ice keeps the fight on it). Zero rng
// in every place (the strain's spots are the huddles' own middles); the
// draws are the damage rolls, in player order.

import { DT, type Entity } from '../../types';
import { addCold, isFrozen } from './quench_cold';
import {
  climbOutSpot,
  holeAt,
  huddlesOf,
  insideRimewall,
  onLakeIce,
  type QBody,
  type QHole,
} from './quench_geometry';
import {
  crackTemplate,
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_NAMES,
  QUENCH_OBJECTS,
  QUENCH_TUNING as T,
} from './quench_ids';
import {
  at,
  dropAura,
  dropFightObject,
  frostHit,
  type QuenchScope,
  raidWarn,
  roll,
  spawnFightObject,
  survivableHit,
} from './quench_scope';
import type { QuenchFightState, QuenchHoleState } from './quench_state';
import { quenchSay } from './quench_voice';

/** Seconds between two of the crack's raid warnings. */
const CRACK_WARN_EVERY = 6;

// ---- the strain and the cracks ----------------------------------------------------------

/** Begin a crack at instance-local (x, z): its footprint at the hole's own
 *  radius, opening after `warn` seconds. Exported for the dev trigger and the
 *  crossing's lane. */
export function startCrack(
  s: QuenchScope,
  x: number,
  z: number,
  r: number = T.holeR,
  warn: number = T.crackWarn,
): void {
  const e = spawnFightObject(s.ctx, s.inst, crackTemplate(warn), QUENCH_NAMES.crack, x, z, r);
  s.st.cracks.push({ objectId: e.id, x, z, r, remaining: warn });
}

/** Is a spot already breaking or broken (a crack or a hole holds it)? */
function spotTaken(st: QuenchFightState, x: number, z: number): boolean {
  for (const c of st.cracks) if (Math.hypot(x - c.x, z - c.z) < c.r) return true;
  for (const h of st.holes) if (Math.hypot(x - h.x, z - h.z) < h.r) return true;
  return false;
}

/** The huddles strain the ice; a spot strained long enough cracks. */
function stepStrain(s: QuenchScope): void {
  const st = s.st;
  const bodies: QBody[] = [];
  for (const p of s.players) {
    if (p.dead || isFrozen(s, p.id) || st.trapped[p.id] !== undefined) continue;
    const here = at(s, p);
    bodies.push({ id: p.id, x: here.x, z: here.z });
  }
  for (const sp of st.strain) sp.loaded = false;
  for (const h of huddlesOf(bodies)) {
    if (!onLakeIce(h.x, h.z) || !insideRimewall(h.x, h.z, 1)) continue;
    let best = -1;
    let bestD = T.strainJoin + 1e-9;
    for (let i = 0; i < st.strain.length; i++) {
      const d = Math.hypot(st.strain[i].x - h.x, st.strain[i].z - h.z);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) {
      if (!st.strain[best].loaded) st.strain[best].t += DT;
      st.strain[best].loaded = true;
    } else st.strain.push({ x: h.x, z: h.z, t: DT, loaded: true });
  }
  const keep = [];
  for (const sp of st.strain) {
    if (!sp.loaded) sp.t -= T.strainHeal * DT;
    if (sp.t <= 0) continue;
    if (sp.t + 1e-9 >= T.strainLinger) {
      if (!spotTaken(st, sp.x, sp.z)) {
        startCrack(s, sp.x, sp.z);
        // Said at most once in CRACK_WARN_EVERY (the crack's own footprint
        // is the call; several at once are one warning).
        const last = st.said.warn_crack;
        if (last === undefined || st.clock - last >= CRACK_WARN_EVERY - 1e-9) {
          st.said.warn_crack = st.clock;
          raidWarn(s, s.boss, 'crack', 'The ice groans under the huddle! Move apart!');
        }
      }
      continue;
    }
    keep.push(sp);
  }
  st.strain = keep;
}

/** Open a hole of freezing water at (x, z): the crack's object gives way to
 *  the hole's. Exported for the dev trigger and the crossing's lane. */
export function openHole(s: QuenchScope, x: number, z: number, r: number = T.holeR): void {
  const st = s.st;
  const e = spawnFightObject(s.ctx, s.inst, QUENCH_OBJECTS.hole, QUENCH_NAMES.hole, x, z, r);
  st.holes.push({ objectId: e.id, x, z, r });
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + x,
    z: o.z + z,
    school: 'frost',
    fx: 'burst',
    radius: r,
    ability: QUENCH_CUES.hole,
  });
  quenchSay(s, s.boss, 'hole');
  // Past the cap the oldest skins over (a body held in it keeps its own
  // trap: the hole's place rides on the trap, so it still climbs out).
  while (st.holes.length > T.holeMax) {
    const old = st.holes.shift() as QuenchHoleState;
    dropFightObject(s.ctx, s.inst, old.objectId);
  }
}

function stepCracks(s: QuenchScope): void {
  const st = s.st;
  if (st.cracks.length === 0) return;
  const keep = [];
  for (const c of st.cracks) {
    c.remaining -= DT;
    if (c.remaining > 1e-9) {
      keep.push(c);
      continue;
    }
    dropFightObject(s.ctx, s.inst, c.objectId);
    openHole(s, c.x, c.z, c.r);
  }
  st.cracks = keep;
}

// ---- the water ----------------------------------------------------------------------------

/** `p` falls through the ice into `hole`: held in the water, the plunge's
 *  hit, the cold. Exported for the tests. */
export function plunge(s: QuenchScope, p: Entity, hole: QHole): void {
  const st = s.st;
  // In the water a breath inside the rim (the body sinks to its chest there).
  const here = at(s, p);
  const dx = here.x - hole.x;
  const dz = here.z - hole.z;
  const d = Math.hypot(dx, dz);
  const keep = Math.max(0, hole.r - 1.2);
  if (d > keep && d > 1e-6) {
    const o = s.ctx.instanceOriginOf(s.inst);
    const k = keep / d;
    const pos = s.ctx.groundPos(o.x + hole.x + dx * k, o.z + hole.z + dz * k);
    p.pos = pos;
    p.prevPos = { ...pos };
    s.ctx.rebucket(p);
  }
  st.trapped[p.id] = {
    x: hole.x,
    z: hole.z,
    r: hole.r,
    remaining: T.trapSeconds,
    tick: T.trapTick,
  };
  s.ctx.applyAura(p, {
    id: QUENCH_AURAS.trapped,
    name: QUENCH_NAMES.trapped,
    kind: 'root',
    remaining: T.trapSeconds + 1,
    duration: T.trapSeconds + 1,
    value: 0,
    sourceId: s.boss.id,
    school: 'frost',
    unbreakableControl: true,
    undispellable: true,
  });
  dropAura(p, QUENCH_AURAS.warmth);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.plunge,
  });
  const hit = survivableHit(p, roll(s, T.plungeMin, T.plungeMax));
  if (hit > 0) frostHit(s, p, hit, QUENCH_NAMES.water);
  addCold(s, p, T.plungeCold);
}

/** The trapped body climbs out on the rim. */
function climbOut(s: QuenchScope, p: Entity): void {
  const st = s.st;
  const trap = st.trapped[p.id];
  if (!trap) return;
  const spot = climbOutSpot(trap, at(s, p), st.holes);
  const o = s.ctx.instanceOriginOf(s.inst);
  const pos = s.ctx.groundPos(o.x + spot.x, o.z + spot.z);
  p.pos = pos;
  p.prevPos = { ...pos };
  s.ctx.rebucket(p);
  delete st.trapped[p.id];
  dropAura(p, QUENCH_AURAS.trapped);
  st.grace[p.id] = T.climbGrace;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: p.id,
    school: 'frost',
    fx: 'nova',
    ability: QUENCH_CUES.climb,
  });
}

/** The water: falls, the held bodies' hits, the climb out. */
function stepWater(s: QuenchScope): void {
  const st = s.st;
  for (const key of Object.keys(st.grace)) {
    const id = Number(key);
    st.grace[id] -= DT;
    if (st.grace[id] <= 1e-9) delete st.grace[id];
  }
  for (const p of s.players) {
    if (p.dead) continue;
    const trap = st.trapped[p.id];
    if (trap) {
      // Still held: the root stays (a class escape that broke it is put
      // back while the body is in the water).
      if (!p.auras.some((a) => a.id === QUENCH_AURAS.trapped))
        s.ctx.applyAura(p, {
          id: QUENCH_AURAS.trapped,
          name: QUENCH_NAMES.trapped,
          kind: 'root',
          remaining: trap.remaining + 1,
          duration: T.trapSeconds + 1,
          value: 0,
          sourceId: s.boss.id,
          school: 'frost',
          unbreakableControl: true,
          undispellable: true,
        });
      trap.remaining -= DT;
      trap.tick -= DT;
      if (trap.tick <= 1e-9 && trap.remaining > 1e-9) {
        trap.tick += T.trapTick;
        const hit = survivableHit(p, roll(s, T.trapMin, T.trapMax));
        if (hit > 0) frostHit(s, p, hit, QUENCH_NAMES.water);
      }
      if (trap.remaining <= 1e-9) climbOut(s, p);
      continue;
    }
    if (st.grace[p.id] !== undefined) continue;
    const here = at(s, p);
    const i = holeAt(here.x, here.z, st.holes);
    if (i >= 0) plunge(s, p, st.holes[i]);
  }
  // A body that left the fight (dead, away) is let go.
  for (const key of Object.keys(st.trapped)) {
    const id = Number(key);
    if (s.players.some((p) => p.id === id && !p.dead)) continue;
    const e = s.ctx.entities.get(id);
    if (e) dropAura(e, QUENCH_AURAS.trapped);
    delete st.trapped[id];
  }
}

/** One tick of the ice: the strain, the cracks, the water. */
export function stepIce(s: QuenchScope): void {
  stepStrain(s);
  stepCracks(s);
  stepWater(s);
}

/** Every crack and hole goes, every held body climbs out where it is (a
 *  reset, the guardian's fall: the lake refreezes whole). */
export function clearIce(s: Pick<QuenchScope, 'ctx' | 'inst' | 'st'>): void {
  const st = s.st;
  for (const c of st.cracks) dropFightObject(s.ctx, s.inst, c.objectId);
  for (const h of st.holes) dropFightObject(s.ctx, s.inst, h.objectId);
  st.cracks = [];
  st.holes = [];
  st.strain = [];
  for (const key of Object.keys(st.trapped)) {
    const e = s.ctx.entities.get(Number(key));
    if (e) dropAura(e, QUENCH_AURAS.trapped);
  }
  st.trapped = {};
  st.grace = {};
}
