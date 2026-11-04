// The Guardian of the Breath's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=breath; the plumbing is scripts/lib/heart_raid_bots.mjs). The raid holds
// the guardian in the Cornice's middle and stands on its walled west side,
// walks against the blows and off the open rim, takes Thessaly's circle,
// faces the Summit Roar on a bearing whose throw lands on the floor, rides the
// Gale Paths to the Islands of the Wind and kills the adds, then in the storm
// spreads for the Leaping Bolt, gathers under Thunder's Cradle, leads Drawn
// Lightning away and dodges the strikes. Mythic: the Knotted Gale's portal
// marks stand by the ball and at a lip, a third player carries it through and
// throws it. Reads only what the server sends; the geometry is the sim's own
// pure module (claim-local, so every spot is shifted by the claim's origin).
//
// IGNORE=roar   the raid stands anywhere for the Summit Roar (the key mechanic)
// IGNORE=knot   mythic: nobody carries the Knotted Gale

import { BREATH, BREATH_ISLES } from '../../src/sim/content/smith_heart_layout';
import {
  inBreathArena,
  lipDistance,
  nearestLipSpot,
  openLipAt,
  THESSALY_POST,
} from '../../src/sim/encounters/smith_heart/breath_geometry';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_OBJECTS,
  BREATH_TUNING,
  breathWindOf,
  calmOf,
  knotOf,
} from '../../src/sim/encounters/smith_heart/breath_ids';
import { isleAt, isleSpots } from '../../src/sim/encounters/smith_heart/breath_isle_geometry';
import {
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_MOBS,
  isleCircleOf,
} from '../../src/sim/encounters/smith_heart/breath_isle_ids';
import {
  add,
  alive,
  DIFF,
  dirOf,
  fightSec,
  fmtSec,
  hasAura,
  hypot,
  IGNORE,
  log,
  segDist,
  unit,
} from './heart_raid_bots.mjs';

const RULES = BREATH_DIFFICULTY[DIFF];
const THROW = RULES.gustThrow;
const WIND = RULES.windSpeed;
const PORTAL_TIDS = {
  [BREATH_OBJECTS.portalA]: 'A',
  [BREATH_OBJECTS.portalB]: 'B',
  [BREATH_OBJECTS.portalC]: 'C',
  [BREATH_OBJECTS.portalD]: 'D',
};
const MARK = {
  A: BREATH_AURAS.portalA,
  B: BREATH_AURAS.portalB,
  C: BREATH_AURAS.portalC,
  D: BREATH_AURAS.portalD,
};
const PARTNER = { A: 'B', B: 'A', C: 'D', D: 'C' };
/** Who rides to which isle, in preference order (never a tank or the priest). */
const RIDERS = [
  ['h2', 'rogue', 'mage', 'hunter', 'lock', 'ele', 'arms', 'h1'],
  ['h1', 'arms', 'lock', 'ele', 'rogue', 'mage', 'hunter', 'h2'],
];

// ---- coordinates --------------------------------------------------------------------

const L = (world, p) => ({ x: p.x - world.origin.x, z: p.z - world.origin.z });
const W = (world, p) => ({ x: p.x + world.origin.x, z: p.z + world.origin.z });
/** On the Cornice's floor, this far in from the open rim. */
function onCornice(world, at, margin = 4) {
  const l = L(world, at);
  return inBreathArena(l.x, l.z) && lipDistance(l.x, l.z) >= margin;
}
function lipOf(world, at) {
  const l = L(world, at);
  return inBreathArena(l.x, l.z) ? lipDistance(l.x, l.z) : 0;
}

export const breath = {
  key: 'breath',
  title: 'Guardian of the Breath',
  tids: { guardian: 'heart_breath_guardian' },
  tp: '/dev heart tp cornice',
  resetGrace: 9000,
  setup(diff) {
    const out = ['/dev heart kill hammer', '/dev heart gates', '/dev heart breath reset'];
    if (diff === 'mythic') out.push('/dev heart breath mythic on');
    else if (diff === 'heroic') out.push('/dev heart breath heroic on');
    else out.push('/dev heart breath heroic off', '/dev heart breath mythic off');
    return out;
  },

  locate(world) {
    const th = [...world.obs.ents.values()].find((e) => e.tid === 'heart_captain_thessaly');
    if (!th) return false;
    world.origin = { x: th.x - THESSALY_POST.x, z: th.z - THESSALY_POST.z };
    world.center = W(world, BREATH.cornice);
    world.home = unit(world.center, th);
    // The guardian held in the middle, the raid on the walled west side.
    world.tankSpot = add(world.center, world.home, 2);
    world.anchor = add(world.center, world.home, 7);
    world.rangeScale = 0.55;
    world.arcSpan = 1.4;
    world.prepull = add(world.center, world.home, 24);
    world.reach = 50;
    return true;
  },

  read(world) {
    const o = {
      wind: null,
      calm: null,
      vortex: [],
      gales: [],
      strikes: [],
      charged: [],
      cradles: [],
      knots: [],
      portals: {},
      paths: {},
      homes: {},
    };
    for (const e of world.obs.ents.values()) {
      if (e.k !== 'object' || typeof e.tid !== 'string') continue;
      const t = e.tid;
      const at = { x: e.x, z: e.z, r: e.sc ?? 3, id: e.id };
      if (t.startsWith(BREATH_OBJECTS.windPrefix)) o.wind = breathWindOf(t);
      else if (t.startsWith(BREATH_OBJECTS.calmPrefix)) o.calm = { ...at, ...calmOf(t) };
      else if (t === BREATH_OBJECTS.vortex) o.vortex.push(at);
      else if (t === BREATH_OBJECTS.gale) o.gales.push(at);
      else if (t.startsWith(BREATH_OBJECTS.strikePrefix)) o.strikes.push(at);
      else if (t.startsWith(BREATH_OBJECTS.chargedPrefix)) o.charged.push(at);
      else if (t.startsWith(BREATH_OBJECTS.cradlePrefix)) o.cradles.push(at);
      else if (t.startsWith(BREATH_OBJECTS.knotPrefix)) o.knots.push({ ...at, ...knotOf(t) });
      else if (PORTAL_TIDS[t]) o.portals[PORTAL_TIDS[t]] = at;
      else {
        const c = isleCircleOf(t);
        if (c?.kind === 'path') o.paths[c.isle] = at;
        else if (c?.kind === 'home') o.homes[c.isle] = at;
      }
    }
    world.o = o;
    world.isleAdds = [...world.obs.ents.values()].filter(
      (e) =>
        e.k === 'mob' && (e.tid === ISLE_MOBS.sentinel || e.tid === ISLE_MOBS.mender) && alive(e),
    );
  },

  onFloor(world, at) {
    return onCornice(world, at, 5);
  },
  // A bot walks round the vortex before the maw and the loose gales.
  obstacles(world) {
    const o = world.o;
    if (!o) return [];
    return [...o.vortex, ...o.gales].map((h) => ({ x: h.x, z: h.z, r: h.r + 1.5 }));
  },
  tankSpot(world) {
    return world.tankSpot;
  },
  tankAdd(a) {
    return a.tid !== ISLE_MOBS.sentinel && a.tid !== ISLE_MOBS.mender;
  },
  meleeReach() {
    return 6.5;
  },
  targets(world, st, b) {
    const me = world.players.get(b.pid);
    const isle = me ? isleOf(world, me) : -1;
    if (isle >= 0) return isleTarget(world, isle, me);
    const g = world.mobs.guardian;
    return g?.hostile === false ? null : g;
  },
  kickables(world) {
    return world.isleAdds
      .filter((m) => m.cast === ISLE_CASTS.mending)
      .map((m) => ({ mob: m, cast: m.cast }));
  },
  stillFor(world, st, b) {
    const me = world.players.get(b.pid);
    if (!me || hasAura(me, BREATH_AURAS.anchor)) return 99;
    const w = world.o?.wind;
    if (!w || (w.phase !== 'blow' && w.phase !== 'gust')) return 99;
    const d = dirOf(w.bearingDeg);
    // How long the blow may carry the caster before the rim comes too near.
    for (let s = 0; s <= 30; s += 1)
      if (!onCornice(world, add(me, d, s), 6)) return Math.max(0, s / WIND - 0.4);
    return 99;
  },

  bad(world, st, at) {
    if (!onCornice(world, at, 6)) return true;
    const o = world.o;
    if (!o) return false;
    for (const h of [...o.strikes, ...o.charged, ...o.vortex, ...o.gales])
      if (hypot(h, at) < h.r + 1.2) return true;
    const lance = lanceLine(world);
    if (lance && segDist(at, lance.from, lance.to) < lance.half) return true;
    const w = o.wind;
    if (
      w &&
      (w.phase === 'blow' || w.phase === 'gather' || w.phase === 'gust' || w.phase === 'gustgather')
    ) {
      if (!onCornice(world, add(at, dirOf(w.bearingDeg), 9), 3)) return true;
    }
    return false;
  },
  hazards(world, st, b, me) {
    const out = [];
    const o = world.o;
    if (!o) return out;
    for (const h of [...o.strikes, ...o.charged, ...o.vortex, ...o.gales])
      out.push({ x: h.x, z: h.z, r: h.r + 1.2 });
    // The Leaping Bolt's target and the conductor keep the raid away.
    const g = world.mobs.guardian;
    if (g?.cast === BREATH_CASTS.fork && g.castTgt !== b.pid) {
      const t = world.players.get(g.castTgt);
      if (t) out.push({ x: t.x, z: t.z, r: BREATH_TUNING.forkJump + 1.5 });
    }
    for (const p of world.living())
      if (p.pid !== b.pid && hasAura(p, BREATH_AURAS.drawn)) out.push({ x: p.x, z: p.z, r: 6 });
    return out;
  },

  track(world, st) {
    track(world, st);
  },
  plan(world, st) {
    plan(world, st);
  },
  duty(world, st, b, me) {
    return duty(world, st, b, me);
  },

  statusLine(world, st) {
    const w = world.o?.wind;
    return `wind ${w ? `${w.phase} ${w.bearingDeg}` : '-'}; isle adds ${world.isleAdds.length}; knots ${world.o?.knots.length ?? 0}; falls ${st.falls?.length ?? 0}`;
  },
  report(world, st, note) {
    init(st);
    note(
      `Falls into the void: ${st.falls.length} (${st.falls.map((f) => `${fmtSec(f.t)} ${f.who}`).join(', ') || 'none'})`,
    );
    note(`Summit Roars: ${st.roars}; circles of calm taken: ${st.anchors}`);
    note(`Isle rounds: ${st.isleRounds}; rides out ${st.ridesOut}, home ${st.ridesHome}`);
    if (st.knots.dropped)
      note(
        `Knotted Gales: ${st.knots.dropped} dropped, ${st.knots.thrown} gone over a lip, ${st.knots.bursts} burst`,
      );
  },
  row(world, st) {
    init(st);
    return [
      ['Falls', String(st.falls.length)],
      ['Knots thrown/burst', st.knots.dropped ? `${st.knots.thrown}/${st.knots.bursts}` : '-'],
    ];
  },
};

function init(st) {
  if (st.falls) return;
  Object.assign(st, {
    falls: [],
    roars: 0,
    anchors: 0,
    isleRounds: 0,
    ridesOut: 0,
    ridesHome: 0,
    knots: { dropped: 0, thrown: 0, bursts: 0, seen: new Set() },
    prevDead: new Map(),
    prevCast: null,
    prevAuras: new Map(),
    roarSpot: new Map(),
    riders: new Map(),
    carrier: new Map(),
    lastPos: new Map(),
  });
}

// ---- reading the fight --------------------------------------------------------------

function isleOf(world, p) {
  const l = L(world, p);
  return isleAt(l.x, l.z);
}

function isleTarget(world, isle, me) {
  const mine = world.isleAdds.filter((m) => isleOf(world, m) === isle);
  const mender = mine.find((m) => m.tid === ISLE_MOBS.mender);
  return mender ?? mine[0] ?? null;
}

function track(world, st) {
  init(st);
  const g = world.mobs.guardian;
  const cur = g?.cast ?? null;
  if (cur !== st.prevCast) {
    if (cur === BREATH_CASTS.inhale) log('INDRAWN BREATH: the raid takes its Roar bearings');
    else if (cur === BREATH_CASTS.gust) {
      st.roars++;
      const where = world
        .living()
        .map((p) => {
          const a = Math.round((Math.atan2(p.x - g.x, p.z - g.z) * 180) / Math.PI + 360) % 360;
          return `${p.name} ${a}deg ${hypot(p, g).toFixed(0)}yd lip${lipOf(world, p).toFixed(0)}${hasAura(p, BREATH_AURAS.anchor) ? ' anchored' : ''}`;
        })
        .join(', ');
      log(`SUMMIT ROAR (facing ${Math.round(((g.f ?? 0) * 180) / Math.PI)}): ${where}`);
    } else if (cur === BREATH_CASTS.storm) log('THE STORM BREAKS');
    else if (cur === BREATH_CASTS.fork)
      log(`LEAPING BOLT at ${world.players.get(g.castTgt)?.name ?? '?'}`);
    else if (cur === BREATH_CASTS.cradle)
      log(`THUNDER'S CRADLE at ${world.players.get(g.castTgt)?.name ?? '?'}`);
    else if (cur === BREATH_CASTS.drawn)
      log(`DRAWN LIGHTNING at ${world.players.get(g.castTgt)?.name ?? '?'}`);
    else if (cur === ISLE_CASTS.bulwark) {
      st.isleRounds++;
      log('GALE BULWARK: the isles wake');
    }
    st.prevCast = cur;
  }
  for (const p of world.players.values()) {
    const was = st.prevDead.get(p.pid);
    if (!p.dead) st.lastPos.set(p.pid, { x: p.x, z: p.z, y: p.y });
    if (p.dead && was === false) {
      const at = st.lastPos.get(p.pid) ?? p;
      const l = L(world, at);
      if (!inBreathArena(l.x, l.z) && isleAt(l.x, l.z) < 0) {
        st.falls.push({ t: fightSec(), who: p.name });
        log(`FALL: ${p.name} went over the rim`);
      }
    }
    st.prevDead.set(p.pid, p.dead);
    const prev = st.prevAuras.get(p.pid) ?? new Set();
    const now = new Set((p.auras ?? []).map((a) => a.id));
    if (now.has(BREATH_AURAS.anchor) && !prev.has(BREATH_AURAS.anchor)) st.anchors++;
    if (now.has(ISLE_AURAS.riding) && !prev.has(ISLE_AURAS.riding)) {
      if (isleOf(world, p) >= 0) st.ridesHome++;
      else st.ridesOut++;
      log(`RIDE: ${p.name} rides the gale`);
    }
    for (const side of ['A', 'B', 'C', 'D'])
      if (now.has(MARK[side]) && !prev.has(MARK[side]))
        log(`KNOTTED GALE: ${p.name} wears Portal ${side}`);
    if (now.has(BREATH_AURAS.laden) && !prev.has(BREATH_AURAS.laden))
      log(`KNOTTED GALE: ${p.name} takes up a ball`);
    st.prevAuras.set(p.pid, now);
  }
  for (const c of world.o.cradles) {
    const under = world.living().filter((p) => hypot(p, c) <= c.r).length;
    st.cradleUnder ??= new Map();
    st.cradleUnder.set(c.id, Math.max(st.cradleUnder.get(c.id) ?? 0, under));
  }
  for (const [id, n] of st.cradleUnder ?? []) {
    if (world.o.cradles.some((c) => c.id === id)) continue;
    log(`THUNDER'S CRADLE discharged with at most ${n} under it`);
    st.cradleUnder.delete(id);
  }
  for (const k of world.o.knots) {
    if (!st.knots.seen.has(k.id)) {
      st.knots.seen.add(k.id);
      st.knots.dropped++;
      k.firstSeen = Date.now();
      st.knots.live ??= new Map();
      st.knots.live.set(k.id, { fuse: k.fuse });
    }
    const rec = st.knots.live?.get(k.id);
    if (rec) rec.fuse = k.fuse;
  }
  for (const [id, rec] of st.knots.live ?? []) {
    if (world.o.knots.some((k) => k.id === id)) continue;
    st.knots.live.delete(id);
    if (rec.fuse <= 0.6) {
      st.knots.bursts++;
      log('KNOTTED GALE BURST');
    } else {
      st.knots.thrown++;
      log(`KNOTTED GALE gone over a lip with ${rec.fuse.toFixed(1)} s left`);
    }
  }
}

// ---- the plan -----------------------------------------------------------------------

function plan(world, st) {
  init(st);
  const o = world.o;
  // The isles: a group per woken isle, the riders kept until home.
  for (const isle of Object.keys(o.paths).map(Number)) {
    if (st.riders.has(isle)) continue;
    const taken = new Set([...st.riders.values()].flat());
    const group = [];
    for (const key of RIDERS[isle % 2]) {
      const b = world.bots.find((x) => x.spec.key === key);
      const p = b && world.players.get(b.pid);
      if (!p || p.dead || taken.has(b.pid) || hasAura(p, ISLE_AURAS.windworn)) continue;
      if (Object.values(MARK).some((m) => hasAura(p, m))) continue;
      group.push(b.pid);
      if (group.length >= 4) break;
    }
    // No healer or too few to kill the adds: the isle is left to burst.
    const healer = group.some((pid) => world.players.get(pid)?.healer);
    // Normal: the raid stays on the Cornice and lets the Bulwark burst (the
    // design's way for a raid that never rides; the bots' isle groups died
    // to the Sentinel more often than not).
    if (DIFF === 'normal' || group.length < 4 || !healer) {
      st.riders.set(isle, []);
      log(`ISLE ${isle}: nobody rides (no healer or too few free)`);
      continue;
    }
    st.riders.set(isle, group);
    log(`ISLE ${isle}: ${group.map((pid) => world.players.get(pid)?.name).join(', ')} ride out`);
  }
  for (const [isle, group] of st.riders) {
    const still = group.some((pid) => {
      const p = world.players.get(pid);
      return p && !p.dead && isleOf(world, p) === isle;
    });
    if (!o.paths[isle] && !o.homes[isle] && !still) st.riders.delete(isle);
  }
  // The Knotted Gale: a carrier per free ball.
  if (IGNORE !== 'knot') {
    for (const k of o.knots) {
      const held = world.living().find((p) => hasAura(p, BREATH_AURAS.laden) && hypot(p, k) < 3);
      if (held) {
        st.carrier.set(k.id, held.pid);
        continue;
      }
      const cur = st.carrier.get(k.id);
      const cp = cur && world.players.get(cur);
      if (cp && !cp.dead) continue;
      const busy = new Set([...st.carrier.values()]);
      const free = world
        .living()
        .filter(
          (p) =>
            p.bot &&
            !p.tank &&
            !busy.has(p.pid) &&
            isleOf(world, p) < 0 &&
            !Object.values(MARK).some((m) => hasAura(p, m)),
        )
        .sort((a, b) => hypot(a, k) - hypot(b, k));
      if (free[0]) {
        st.carrier.set(k.id, free[0].pid);
        log(`KNOTTED GALE: ${free[0].name} goes to carry the ball`);
      }
    }
  }
}

// ---- a bot's duty -------------------------------------------------------------------

function duty(world, st, b, me) {
  init(st);
  const o = world.o;
  if (hasAura(me, ISLE_AURAS.riding) || hasAura(me, BREATH_AURAS.cradled))
    return { goal: me, hold: true, duty: 'carried' };
  const isle = isleOf(world, me);
  if (isle >= 0) return isleDuty(world, st, b, me, isle);
  for (const [i, group] of st.riders) {
    if (group.includes(b.pid) && o.paths[i] && !hasAura(me, ISLE_AURAS.windworn))
      return { goal: o.paths[i], tol: 0.8, duty: 'ride' };
  }
  const knot = knotDuty(world, st, b, me);
  if (knot) return knot;
  const g = world.mobs.guardian;
  // The indrawn breath and the Roar: a bearing whose throw lands on the floor.
  if (
    alive(g) &&
    (g.cast === BREATH_CASTS.inhale || g.cast === BREATH_CASTS.gust) &&
    IGNORE !== 'roar'
  ) {
    if (!hasAura(me, BREATH_AURAS.anchor)) {
      const spot = roarSpot(world, st, b, me, g);
      if (spot) return { goal: spot, tol: 1.2, duty: 'roar' };
    }
  } else st.roarSpot.delete(b.pid);
  // Storm Lance: out of its line (34 yd from the guardian along its facing).
  const lance = lanceLine(world);
  if (lance && !me.tank && segDist(me, lance.from, lance.to) < lance.half) {
    const d = unit(lance.from, lance.to);
    const side = { x: -d.z, z: d.x };
    const along = (me.x - lance.from.x) * d.x + (me.z - lance.from.z) * d.z;
    const foot = add(lance.from, d, along);
    const s = (me.x - foot.x) * side.x + (me.z - foot.z) * side.z >= 0 ? 1 : -1;
    return { goal: add(foot, side, s * (lance.half + 1.5)), tol: 0.6, duty: 'lance' };
  }
  // Phase 2.
  const cradle = cradleDuty(world, st, b, me);
  if (cradle) return cradle;
  if (alive(g) && g.cast === BREATH_CASTS.fork && g.castTgt === b.pid) {
    const spot = spreadSpot(world, me, BREATH_TUNING.forkJump + 2);
    if (spot) return { goal: spot, tol: 1.0, duty: 'spread' };
  }
  if (hasAura(me, BREATH_AURAS.drawn)) return drawnDuty(world, st, b, me);
  // Thessaly's circle: three take it while it holds.
  const c = o.calm;
  if (c && (c.state === 'land' || c.state === 'hold') && !b.spec.role.startsWith('tank')) {
    const takers = calmTakers(world, c);
    if (takers.includes(b.pid) && !hasAura(me, BREATH_AURAS.anchor))
      return { goal: c, tol: 1.0, duty: 'calm' };
  }
  // Too near the rim: back in toward the middle.
  if (!onCornice(world, me, 7))
    return { goal: add(me, unit(me, world.center), 8), tol: 1.0, duty: 'rim' };
  return null;
}

/** The Storm Lance's line while its bar runs, or null. */
function lanceLine(world) {
  const g = world.mobs.guardian;
  if (!alive(g) || g.cast !== BREATH_CASTS.lance) return null;
  // Its aim is locked at the bar's start: the guardian's facing.
  const d = { x: Math.sin(g.f ?? 0), z: Math.cos(g.f ?? 0) };
  return { from: { x: g.x, z: g.z }, to: add(g, d, 36), half: 2.5 + 1.5 };
}

function calmTakers(world, c) {
  return world
    .living()
    .filter(
      (p) =>
        p.bot && !p.tank && !hasAura(p, BREATH_AURAS.spent) && !hasAura(p, BREATH_AURAS.anchor),
    )
    .filter(
      (p) => !Object.values(MARK).some((m) => hasAura(p, m)) && !hasAura(p, BREATH_AURAS.laden),
    )
    .sort((a, b) => hypot(a, c) - hypot(b, c))
    .slice(0, 3)
    .map((p) => p.pid);
}

/** A spot near the guardian whose Roar throw (radius out to radius + the
 *  throw) never leaves the floor over an open lip and stays clear of the
 *  vortex before its mouth. Kept for the whole breath. */
function roarSpot(world, st, b, me, g) {
  const kept = st.roarSpot.get(b.pid);
  if (kept) return kept;
  const r0 = 6;
  const facing = g.f ?? 0;
  let best = null;
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const d = { x: Math.sin(a), z: Math.cos(a) };
    // Clear of the mouth (the vortex lies 7 yd before it).
    let diff = Math.abs(a - facing) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    // Behind and beside it: the pull's line into the maw never crosses the
    // vortex before its mouth.
    if (diff < 1.7) continue;
    let safe = true;
    for (let s = r0; s <= r0 + THROW + 2; s += 1) {
      const pt = L(world, add(g, d, s));
      if (inBreathArena(pt.x, pt.z)) continue;
      // Off the floor: an open lip is a fall; a wall (the climb's head) holds.
      if (openLipAt(pt.x, pt.z) || lipDistance(pt.x, pt.z) <= 1) safe = false;
      break;
    }
    if (!safe) continue;
    const land = L(world, add(g, d, r0 + THROW));
    const margin = inBreathArena(land.x, land.z) ? lipDistance(land.x, land.z) : 2;
    if (margin < 2) continue;
    const at = add(g, d, r0);
    const cost = hypot(me, at) - margin * 0.3;
    if (!best || cost < best.cost) best = { at, cost };
  }
  if (best) st.roarSpot.set(b.pid, best.at);
  return best?.at ?? null;
}

function spreadSpot(world, me, gap) {
  const others = world.living().filter((p) => p.pid !== me.pid);
  for (let r = 0; r <= 18; r += 3) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const at = add(me, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (!onCornice(world, at, 7)) continue;
      if (others.every((p) => hypot(p, at) >= gap)) return at;
    }
  }
  return null;
}

function cradleDuty(world, st, b, me) {
  const cradles = world.o.cradles;
  if (cradles.length === 0 || me.tank) return null;
  const need = DIFF === 'normal' ? 4 : 3;
  const taken = new Set();
  for (const c of cradles) {
    const pool = world
      .living()
      .filter((p) => p.bot && !p.tank && !taken.has(p.pid) && !hasAura(p, BREATH_AURAS.cradled))
      .filter((p) => !hasAura(p, BREATH_AURAS.drawn))
      .sort((a, bb) => hypot(a, c) - hypot(bb, c))
      .slice(0, need);
    for (const p of pool) taken.add(p.pid);
    const i = pool.findIndex((p) => p.pid === b.pid);
    if (i >= 0) {
      const at = add(c, { x: Math.sin(i * 1.9), z: Math.cos(i * 1.9) }, Math.min(2, c.r - 2));
      return { goal: at, tol: 0.8, duty: 'cradle' };
    }
  }
  return null;
}

function drawnDuty(world, st, b, me) {
  // Walk a slow loop away from the raid so the strikes and their charged
  // ground fall where nobody stands.
  const away = unit(world.anchor, world.center);
  const base = add(world.center, away, 14);
  const t = Math.floor(Date.now() / 2000) % 4;
  const goal = add(base, { x: Math.sin(t * 1.57), z: Math.cos(t * 1.57) }, 5);
  return { goal: onCornice(world, goal, 7) ? goal : base, tol: 1.0, duty: 'conductor' };
}

// ---- the isles ----------------------------------------------------------------------

function isleDuty(world, st, b, me, isle) {
  const o = world.o;
  const t = isleTarget(world, isle, me);
  const spots = isleSpots()[isle];
  const land = W(world, spots.land);
  if (!t) {
    if (o.homes[isle]) return { goal: o.homes[isle], tol: 0.8, duty: 'ride home' };
    return { goal: land, tol: 1.0, duty: 'isle wait' };
  }
  if (b.spec.melee || b.spec.role === 'tank') {
    // In reach of the add, never past the isle's own floor.
    const at = add(t, unit(t, me), 2);
    const l = L(world, at);
    return { goal: isleAt(l.x, l.z) === isle ? at : land, tol: 1.2, duty: 'isle fight' };
  }
  return { goal: land, tol: 1.5, duty: 'isle fight' };
}

// ---- the Knotted Gale (Mythic) ------------------------------------------------------

function myMark(me) {
  for (const side of ['A', 'B', 'C', 'D']) if (hasAura(me, MARK[side])) return side;
  return null;
}

/** The ball a pair works: A and B the ball nearest the A mark's player (or
 *  the only one), C and D the other. */
function pairBall(world, side) {
  const knots = world.o.knots;
  if (knots.length === 0) return null;
  if (knots.length === 1) return knots[0];
  const a = world.living().find((p) => hasAura(p, MARK.A)) ?? world.o.portals.A;
  const first = a ? knots.slice().sort((x, y) => hypot(x, a) - hypot(y, a))[0] : knots[0];
  return side === 'A' || side === 'B' ? first : knots.find((k) => k !== first);
}

function lipSpotFor(world, from, avoidSides = []) {
  const l = L(world, from);
  const avoid = avoidSides
    .map((s) => world.o.portals[s])
    .filter(Boolean)
    .map((p) => L(world, p));
  return W(world, nearestLipSpot(l.x, l.z, avoid, 12));
}

function knotDuty(world, st, b, me) {
  const d = knotDutyInner(world, st, b, me);
  const tag = d ? `${d.duty}` : null;
  st.knotTag ??= new Map();
  if (d && st.knotTag.get(b.pid) !== tag) {
    const g = d.goal ? `${hypot(me, d.goal).toFixed(1)} yd away` : '';
    const l = L(world, me);
    log(
      `  knot: ${me.name} ${tag} ${g} (lip ${inBreathArena(l.x, l.z) ? lipDistance(l.x, l.z).toFixed(1) : 'off'})`,
    );
  }
  st.knotTag.set(b.pid, tag);
  return d;
}

function knotDutyInner(world, st, b, me) {
  if (IGNORE === 'knot') return null;
  const o = world.o;
  if (o.knots.length === 0 && !myMark(me)) return null;
  const side = myMark(me);
  if (side) {
    const ball = pairBall(world, side);
    if (!ball) return null;
    if (side === 'A' || side === 'C') {
      // Beside the ball (never on it: the marked never carry).
      return { goal: add(ball, unit(ball, world.center), 3.2), tol: 0.7, duty: `portal ${side}` };
    }
    // B and D: at the lip nearest the ball, past the other pair's mouth.
    st.lipSpot ??= new Map();
    if (!st.lipSpot.has(b.pid))
      st.lipSpot.set(b.pid, lipSpotFor(world, ball, side === 'D' ? ['B'] : ['D']));
    return { goal: st.lipSpot.get(b.pid), tol: 0.5, duty: `portal ${side}` };
  }
  st.lipSpot?.delete(b.pid);
  const laden = hasAura(me, BREATH_AURAS.laden);
  const ballId = [...st.carrier.entries()].find(([, pid]) => pid === b.pid)?.[0];
  const ball = o.knots.find((k) => k.id === ballId);
  if (!ball) return null;
  if (!laden) return { goal: ball, tol: 0.8, duty: 'take the ball' };
  const l = L(world, me);
  const press = (bot) => {
    if (Date.now() - (bot.lastPress ?? 0) < 600) return false;
    bot.lastPress = Date.now();
    bot.cmd({ cmd: 'interact' });
    return true;
  };
  if (inBreathArena(l.x, l.z) && lipDistance(l.x, l.z) <= BREATH_TUNING.heartLipReach - 0.3)
    return { goal: me, hold: true, duty: 'throw', cast: press };
  // Which pair: the portal nearest the ball is the way in, its partner the way out.
  const open = Object.entries(o.portals);
  if (open.length === 0) return { goal: me, hold: true, duty: 'wait for the portals' };
  const [inSide, inP] = open.sort((x, y) => hypot(x[1], ball) - hypot(y[1], ball))[0];
  const out = o.portals[PARTNER[inSide]];
  if (out && hypot(me, out) < 4) {
    // Out at the far mouth: on to the lip right beside it.
    const lip = lipSpotFor(world, me);
    return { goal: lip, tol: 0.4, duty: 'carry to the lip' };
  }
  return { goal: inP, tol: 0.3, duty: 'carry to the portal' };
}

export default breath;
