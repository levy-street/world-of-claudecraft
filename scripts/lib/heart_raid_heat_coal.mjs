// The Guardian of the Heat's Heroic Live Coals for the raid bots
// (scripts/lib/heart_raid_heat.mjs; the sim is encounters/smith_heart/heat_coal.ts):
//  - a bearer walks out of reach of everyone (the leap's 2 yd and a stride; the
//    burst's 7 yd and a stride over the fuse's last seconds), staying in both
//    healers' reach and out of every other danger, the Wheel's red slices too;
//  - everyone else keeps off a bearer: a bearer is a hazard to rest away from
//    and a circle the walk steers round (the Wheel's crossing included);
//  - the healers break the absorb first (the shared kits' `crusted` already
//    heals a heal absorb through before anything but a dying tank; the urgency
//    here lifts a coal near its burst over every other need).
// It also counts what happened to each coal, read off the bearers' auras.
//
// IGNORE=coal  the bearers stand where they are (the burst's check)

import { HEAT_AURAS, HEAT_TUNING } from '../../src/sim/encounters/smith_heart/heat_ids';
import { auraOf, fightSec, fmtSec, hypot, IGNORE, log } from './heart_raid_bots.mjs';

const T = HEAT_TUNING;
/** A bearer's clearance from everyone (the leap reach and a stride). */
const LEAP_CLEAR = T.coalLeapR + 2.5;
/** Over the fuse's last seconds, the burst's reach and a stride. */
const BURST_CLEAR = T.coalBurstR + 1.5;
const BURST_SOON = 4;

/** The coal aura on `p`, or null. */
export const coalOf = (p) => auraOf(p, HEAT_AURAS.coal);

/** The living bearers. */
export function bearers(world) {
  return world.living().filter((p) => coalOf(p));
}

/** How far everyone must keep from bearer `p` now. */
export function coalClear(p) {
  const a = coalOf(p);
  return a && (a.rem ?? 99) <= BURST_SOON ? BURST_CLEAR : LEAP_CLEAR;
}

/** The hazard circles a coal lays for bot `b`: a bearer's clearance round
 *  every other body (its own walk), else round every bearer. */
export function coalHazards(world, b) {
  const me = world.players.get(b.pid);
  const out = [];
  if (!me) return out;
  if (coalOf(me)) {
    const r = coalClear(me);
    for (const p of world.living()) if (p.pid !== b.pid) out.push({ x: p.x, z: p.z, r });
    return out;
  }
  for (const p of bearers(world)) out.push({ x: p.x, z: p.z, r: coalClear(p) });
  return out;
}

/** The circles a walk steers round: the leap's reach and a margin. */
export function coalObstacles(world, b) {
  const me = b ? world.players.get(b.pid) : null;
  if (!me) return [];
  const r = T.coalLeapR + 0.8;
  if (coalOf(me))
    return world
      .living()
      .filter((p) => p.pid !== b.pid)
      .map((p) => ({ x: p.x, z: p.z, r }));
  return bearers(world).map((p) => ({ x: p.x, z: p.z, r }));
}

/** A healer's extra reason to heal a bearer first (0 to 0.3). */
export function coalUrgency(p) {
  const a = coalOf(p);
  if (!a) return 0;
  return (a.rem ?? 99) <= 6 ? 0.3 : 0.15;
}

/** The bearer's own duty (or one walking clear of a bearer): a spot clear of
 *  everyone by the clearance, out of danger, in the healers' reach; null when
 *  nothing calls for a step. `safeNear(from, extra, max)` is the boss module's
 *  safe-spot search. */
export function coalDuty(world, st, b, me, safeNear, safe = () => true) {
  if (IGNORE === 'coal') return null;
  const others = world.living().filter((p) => p.pid !== b.pid);
  if (coalOf(me)) {
    const clear = coalClear(me);
    const healers = others.filter((p) => p.bot?.spec.role === 'healer');
    // A kept spot is checked again every tick: a fist or a Wheel slice may
    // have come down on it since (the bot pass of 2026-11-24: a healer kept
    // its coal spot under a Basalt Fist).
    const ok = (at) =>
      safe(at) &&
      others.every((p) => hypot(p, at) >= clear) &&
      healers.every((h) => hypot(h, at) <= 25);
    st.coalSpot ??= new Map();
    const kept = st.coalSpot.get(b.pid);
    if (kept && ok(kept)) {
      if (hypot(kept, me) > 1) return { goal: kept, tol: 0.8, duty: 'coal: keep apart' };
      if (ok(me)) return null;
    }
    if (ok(me)) return null;
    const spot = safeNear(me, ok, 22);
    if (!spot) return null;
    st.coalSpot.set(b.pid, spot);
    return { goal: spot, tol: 0.8, duty: 'coal: keep apart' };
  }
  const near = bearers(world).filter((p) => hypot(p, me) < coalClear(p));
  if (!near.length) return null;
  const ok = (at) => near.every((p) => hypot(p, at) >= coalClear(p) + 0.5);
  const spot = safeNear(me, ok, 14);
  return spot ? { goal: spot, tol: 0.8, duty: 'clear of a coal' } : null;
}

/** The tallies: set, healed out, leapt, burst (and gone with a death). */
export function initCoalTally(st) {
  st.coal ??= { set: 0, out: 0, leaps: 0, bursts: 0, died: 0, prev: new Map(), log: [] };
  return st.coal;
}

/** Read the bearers off the raid: a coal new on one player while another just
 *  lost one is a leap; one gone with its fuse out a burst, with its bearer
 *  alive and its fuse left healed out (or doused, `sunk`: the guardian going
 *  under puts every coal out). */
export function trackCoals(world, st, sunk = false) {
  const c = initCoalTally(st);
  const now = new Map();
  for (const p of world.players.values()) {
    const a = coalOf(p);
    if (a && !p.dead) now.set(p.pid, { rem: a.rem ?? 0, name: p.name });
  }
  const gained = [...now.keys()].filter((pid) => !c.prev.has(pid));
  const lost = [...c.prev.keys()].filter((pid) => !now.has(pid));
  let leaps = Math.min(gained.length, lost.length);
  const lostLeft = [...lost];
  // A leap pairs a gain with a loss whose fuse matches (it carries on).
  for (const g of gained) {
    const i = lostLeft.findIndex((pid) => Math.abs(c.prev.get(pid).rem - now.get(g).rem) < 1.2);
    if (leaps > 0 && i >= 0) {
      const from = c.prev.get(lostLeft[i]);
      lostLeft.splice(i, 1);
      leaps--;
      c.leaps++;
      log(`LIVE COAL leaps: ${from.name} to ${now.get(g).name}`);
      continue;
    }
    c.set++;
    log(`LIVE COAL on ${now.get(g).name}`);
  }
  for (const pid of lostLeft) {
    const was = c.prev.get(pid);
    const p = world.players.get(pid);
    if (sunk) {
      c.doused = (c.doused ?? 0) + 1;
      log(`LIVE COAL doused as the guardian sinks (${was.name})`);
    } else if (p?.dead) {
      c.died++;
      c.log.push(`${fmtSec(fightSec())} ${was.name} died with it`);
      log(`LIVE COAL gone with ${was.name}'s death`);
    } else if (was.rem <= 0.7) {
      c.bursts++;
      c.log.push(`${fmtSec(fightSec())} ${was.name} burst`);
      log(`LIVE COAL BURST on ${was.name}`);
    } else {
      c.out++;
      log(`LIVE COAL healed out on ${was.name} (${was.rem.toFixed(1)} s left)`);
    }
  }
  c.prev = now;
}
