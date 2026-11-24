// The Guardian of the Heat's overflow for the raid bots (scripts/lib/heart_raid_heat.mjs):
// the lava waves' corridors planned against the clock, and the Heroic Wellspawn
// burned while the raid stands in them.
//
// The bot pass of 2026-11-24 (BiS Heroic raids wiped at the 70 percent overflow, the
// Wellspawn fed the guardian two at once with 340 damage dealt to them): the raid
// walked to the nearest corridor at once and stood close to the wellspring, out of
// reach of the children walking in from the room's edge, and the casters kept
// starting bars they had to walk out of. Now:
//  - each upcoming wall (a ring rolling out, or the next one's glowing corridors
//    and their countdown) is timed at every radius, so a bot knows how long it has;
//  - a bot picks the corridor spot (any of the next wall's corridors, from the lip
//    out to MAX_R) it can reach in time that puts its target in reach, the walk
//    the shortest, so the damage dealers line the corridors toward the Wellspawn;
//  - `stillFor` gives the casters the time until they must walk, so a bar is only
//    begun when it can finish;
//  - the Wellspawn are split over the damage dealers (the fast ones first, nearest
//    the wellspring first), and the tanks join them while the guardian is under.
// Reads only what the server sends; the geometry is the sim's own pure module.

import { HEARTH_WELL } from '../../src/sim/content/smith_heart_layout';
import {
  inHearthFloor,
  inRingCorridor,
  wellDistance,
} from '../../src/sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_AURAS,
  HEAT_DIFFICULTY,
  HEAT_LIP_WALL,
  HEAT_MOBS,
  HEAT_TUNING,
} from '../../src/sim/encounters/smith_heart/heat_ids';
import { alive, auraOf, DIFF, hypot } from './heart_raid_bots.mjs';

const T = HEAT_TUNING;
const LIP = HEAT_LIP_WALL.outer;
/** A bot's planning run speed (a player runs 7). */
const RUN = 6.3;
/** The farthest out a bot stands in a corridor (the next corridor a quarter
 *  turn round is then still a few seconds' walk). */
const MAX_R = 30;
/** Yards a ranged bot plans to stand within of its target, and a melee one. */
const RANGED_REACH = 27;
const MELEE_REACH = 4.2;

const L = (world, p) => ({ x: p.x - world.origin.x, z: p.z - world.origin.z });
const W = (world, p) => ({ x: p.x + world.origin.x, z: p.z + world.origin.z });

/** The overflow's lava wave rule now (the first at 70 percent, the second at 40). */
function waveRule(world) {
  const g = world.mobs.guardian;
  const phase = g ? (auraOf(g, HEAT_AURAS.state)?.value ?? 1) : 1;
  const tier = HEAT_DIFFICULTY[DIFF] ?? HEAT_DIFFICULTY.normal;
  return tier.waves[phase >= 2 ? 1 : 0];
}

/** Is a lava wave on the floor or glowing (an overflow under way)? */
export function wavesOn(world) {
  const o = world.o;
  return !!o && (o.rings.length > 0 || o.gaps.length > 0);
}

/** The walls still to reach local radius `r`, soonest first: `t` seconds until
 *  the wall is on `r`, its corridors and their half width. */
export function wallsAt(world, r) {
  const o = world.o;
  const rule = waveRule(world);
  const out = [];
  for (const ring of o.rings) {
    if (ring.front - T.ringDepth > r + 0.2) continue;
    out.push({ t: Math.max(0, (r - ring.front) / rule.speed), gaps: ring.gaps, half: ring.half });
  }
  if (o.gaps.length) {
    const left = Math.max(0, Math.min(...o.gaps.map((g) => g.left)));
    out.push({
      t: left + Math.max(0, r - T.ringStart) / rule.speed,
      gaps: o.gaps.map((g) => g.g),
      half: o.gaps[0].half,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

const spotOn = (g, r) => ({
  x: HEARTH_WELL.x + Math.sin(g) * r,
  z: HEARTH_WELL.z + Math.cos(g) * r,
});

/** May a bot stand at local `at` through an overflow (on the floor, off the
 *  lip wall, out of every burning patch)? */
function standable(world, at) {
  if (!inHearthFloor(at.x, at.z) || wellDistance(at.x, at.z) < LIP + 1.2) return false;
  const w = W(world, at);
  return !world.o.spots.some((h) => hypot(h, w) < h.r);
}

/** The corridor spot for `me` now: reachable before its wall, nearest walk,
 *  its target in `reach` when one is given. Null outside an overflow. */
export function waveSpot(world, me, target, reach) {
  if (!wavesOn(world)) return null;
  const l = L(world, me);
  const d = wellDistance(l.x, l.z);
  const here = wallsAt(world, d)[0] ?? null;
  const hereIn = here ? inRingCorridor(here.gaps, Math.max(0.5, here.half - 0.8), l.x, l.z) : false;
  let best = null;
  for (let r = LIP + 2; r <= MAX_R + 1e-6; r += 2) {
    const wall = wallsAt(world, r)[0];
    if (!wall) continue;
    for (const g of wall.gaps) {
      const at = spotOn(g, r);
      if (!standable(world, at)) continue;
      const walk = hypot(at, l);
      // The walk must end inside before the wall reaches that radius, and must
      // not leave the corridor the wall nearest the bot now is about to pass.
      if (walk / RUN + 0.6 > wall.t) continue;
      if (here && hereIn && here.t < walk / RUN + 0.6) {
        if (!inRingCorridor(here.gaps, Math.max(0.5, here.half - 1), at.x, at.z)) continue;
      }
      let score = -walk / RUN - 0.03 * r;
      if (target) {
        const dd = hypot(at, L(world, target));
        score += dd <= reach ? 10 - 0.05 * dd : -0.25 * (dd - reach);
      }
      if (!best || score > best.score) best = { at, score, wall, g };
    }
  }
  // Never off the corridors: standing by a Wellspawn between walls looked
  // free but the bot pass of 2026-11-24 measured it worse (more walls taken,
  // a quarter of the damage on the children), so every spot is a corridor's.
  if (!best) return null;
  const inside = inRingCorridor([best.g], Math.max(0.5, best.wall.half - 1), l.x, l.z);
  const near = hypot(best.at, l);
  return {
    goal: W(world, best.at),
    // Inside its corridor and near the spot, it stands: no step for a yard.
    tol: inside && near < 2.5 ? Math.max(1, best.wall.half - 1.8) : 0.8,
    inReach: !!target && hypot(best.at, L(world, target)) <= reach,
  };
}

/** Seconds `me` may stand still before it must walk to a corridor. */
export function waveStill(world, me) {
  if (!wavesOn(world)) return undefined;
  const l = L(world, me);
  const d = wellDistance(l.x, l.z);
  let still = 99;
  for (const wall of wallsAt(world, d).slice(0, 2)) {
    if (inRingCorridor(wall.gaps, Math.max(0.5, wall.half - 0.8), l.x, l.z)) {
      // In this one's corridor: free until it has passed, and the next one's
      // walk counted after it.
      continue;
    }
    let walk = Number.POSITIVE_INFINITY;
    for (const g of wall.gaps) walk = Math.min(walk, hypot(spotOn(g, d), l));
    still = Math.min(still, wall.t - walk / RUN - 0.5);
  }
  return Math.max(0, still);
}

const spawnGap = (world, a) => {
  const l = L(world, a);
  return wellDistance(l.x, l.z);
};

/** The living Wellspawn. */
export function wellspawn(world) {
  return world.adds.filter((a) => a.tid === HEAT_MOBS.spawn && alive(a));
}

const fast = (a) => a.hp / Math.max(1, a.mhp) > T.spawnSlowAt;

/** A damage dealer's (or, while the guardian is under, a tank's) Wellspawn: the
 *  fast ones before the crawling ones, nearest the wellspring first, split over
 *  the hitters, the first one it can reach from a corridor. Null for none. */
export function spawnTarget(world, b, me) {
  const all = wellspawn(world);
  if (!all.length) return null;
  const melee = !!b.spec.melee || b.spec.role === 'tank';
  const reach = melee ? MELEE_REACH : RANGED_REACH;
  const quick = all.filter(fast);
  const pool = (quick.length ? quick : all).sort((x, y) => {
    // The crawling ones: the weakest first (kill them), else nearest the well.
    if (!quick.length) return x.hp - y.hp || spawnGap(world, x) - spawnGap(world, y);
    return spawnGap(world, x) - spawnGap(world, y);
  });
  const hitters = world.bots.filter((x) => x.spec.role === 'dps' || x.spec.role === 'tank');
  const k = Math.max(0, hitters.indexOf(b));
  const order = pool.map((_, i) => pool[(i + k) % pool.length]);
  if (!wavesOn(world)) return order[0];
  for (const t of order) if (waveSpot(world, me, t, reach)?.inReach) return t;
  return order[0];
}

/** The reach a hitter plans to stand within of its target. */
export function hitReach(b) {
  return b.spec.melee || b.spec.role === 'tank' ? MELEE_REACH : RANGED_REACH;
}
