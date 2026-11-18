// The Guardian of the Breath's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=breath; the plumbing is scripts/lib/heart_raid_bots.mjs). The raid holds
// the guardian in the Cornice's middle and stands on its walled west side,
// walks against the blows and off the open rim, takes Thessaly's circle,
// faces the Summit Roar on a bearing whose throw lands on the floor; at half
// health (the Islands of the Wind, 2026-11-18) splits in two (one side east,
// one west), rides Thessaly's Updrafts isle to isle, kills each isle's adds
// (kicks the Mender, steps out of the Herald's gale, strikes the
// Shieldbearer's back, out of Sky's Reckoning's strikes) and channels the
// Stillstone at the end of each chain; then in the storm
// spreads for the Leaping Bolt, gathers under Thunder's Cradle, leads Drawn
// Lightning away and dodges the strikes. Heroic and Mythic: the Knotted Gale's
// portal marks stand by the ball and at a lip, a third player carries it to the
// nearest lip and throws it (through the portals only when that way is
// shorter: no portal is needed since 2026-11-08). Reads only what the server sends; the geometry is the sim's own
// pure module (claim-local, so every spot is shifted by the claim's origin).
//
// IGNORE=roar   the raid stands anywhere for the Summit Roar (the key mechanic)
// IGNORE=knot   heroic and mythic: nobody carries the Knotted Gale
// BREATH_AT=isles  the leader starts the Islands of the Wind 8 s after the pull

import { BODY_EDGE_MELEE_REACH } from '../../src/sim/combat/player_attack_reach';
import { BREATH } from '../../src/sim/content/smith_heart_layout';
import {
  edgeWalk,
  inBreathArena,
  lipDistance,
  nearestLipSpot,
  openLipAt,
  THESSALY_POST,
} from '../../src/sim/encounters/smith_heart/breath_geometry';
import {
  BREATH_AURAS,
  BREATH_BODY_RADIUS,
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_OBJECTS,
  BREATH_TUNING,
  breathWindOf,
  calmOf,
  knotOf,
} from '../../src/sim/encounters/smith_heart/breath_ids';
import { inShoveLine } from '../../src/sim/encounters/smith_heart/breath_isle_adds';
import { isleAt, isleSpots } from '../../src/sim/encounters/smith_heart/breath_isle_geometry';
import {
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_MOBS,
  padOf,
} from '../../src/sim/encounters/smith_heart/breath_isle_ids';
import { BLAST_FALLOFF, WIND_BLAST_AURA } from '../../src/sim/wind_drift';
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
  tankAssign,
  unit,
} from './heart_raid_bots.mjs';

const RULES = BREATH_DIFFICULTY[DIFF];
const BREATH_AT = (process.env.BREATH_AT ?? '').toLowerCase();
// How far out the Roar leaves a body that runs straight back against its
// blast at once (its throw, 0 since 2026-11-17, and where the blast falls
// to a run: wind_drift.ts), plus a margin for the bots' late start.
const THROW = RULES.gustThrow + (RULES.blastSpeed - 7) / BLAST_FALLOFF + 3;
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
/** The raid's split at half health: a tank, a healer, a melee and two ranged
 *  a side (0 east, 1 west). A player not listed (a human) takes the side with
 *  fewer. */
const SIDES = {
  mt: 0,
  h1: 0,
  rogue: 0,
  mage: 0,
  hunter: 0,
  ot: 1,
  h2: 1,
  arms: 1,
  lock: 1,
  ele: 1,
};
/** The isles' adds (living ones are the isle fights). */
const ISLE_ADD_TIDS = new Set([
  ISLE_MOBS.sentinel,
  ISLE_MOBS.mender,
  ISLE_MOBS.herald,
  ISLE_MOBS.squall,
  ISLE_MOBS.fragment,
  ISLE_MOBS.shieldbearer,
]);
/** Which add the damage dealers burn first on an isle. */
const KILL_ORDER = [
  ISLE_MOBS.mender,
  ISLE_MOBS.herald,
  ISLE_MOBS.fragment,
  ISLE_MOBS.squall,
  ISLE_MOBS.sentinel,
  ISLE_MOBS.shieldbearer,
];
/** What the tank holds first on an isle (the melee hitters). */
const TANK_ORDER = [
  ISLE_MOBS.shieldbearer,
  ISLE_MOBS.sentinel,
  ISLE_MOBS.squall,
  ISLE_MOBS.fragment,
  ISLE_MOBS.herald,
  ISLE_MOBS.mender,
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
  // The tank swap (breath_blow.ts): Wind-Battered in the Wind, Thunder-Laden
  // in the Storm, each at the tier's count (the aura's value3).
  swapAura: [BREATH_AURAS.battered, BREATH_AURAS.thunderLaden],
  swapStacks: 3,
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
      pads: [],
    };
    // Every bot's view merged (the leader's first): split over the isles the
    // raid is wider than one player's interest radius, so the far side's pads,
    // adds and stones are only seen by the bots out there.
    const all = new Map();
    for (const b of world.bots) for (const [id, e] of b.ents ?? []) all.set(id, e);
    for (const [id, e] of world.obs.ents) all.set(id, e);
    world.allEnts = all;
    for (const e of all.values()) {
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
        const pad = padOf(t);
        if (pad) o.pads.push({ ...at, ...pad });
      }
    }
    world.o = o;
    world.isleAdds = [...all.values()].filter(
      (e) => e.k === 'mob' && ISLE_ADD_TIDS.has(e.tid) && alive(e),
    );
    world.stones = [...all.values()].filter(
      (e) => e.k === 'mob' && e.tid === ISLE_MOBS.stillstone && !e.dead,
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
    return !ISLE_ADD_TIDS.has(a.tid);
  },
  // On an isle the tank holds that isle's melee hitters; elsewhere the raid's own.
  tankAssign(world, st, b, me) {
    const isle = isleOf(world, me);
    if (isle >= 0) {
      const mine = world.isleAdds.filter((m) => isleOf(world, m) === isle);
      if (mine.length > 0) {
        const loose = mine.filter((m) => m.aggro !== b.pid);
        const pick = (loose.length > 0 ? loose : mine)
          .slice()
          .sort((x, y) => TANK_ORDER.indexOf(x.tid) - TANK_ORDER.indexOf(y.tid))[0];
        b.tankTarget = pick.id;
        b.loose = null;
        return;
      }
    }
    return tankAssign(world, st, b, me);
  },
  // Melee reaches the guardian's body from its edge (its template's
  // bodyRadius plus a melee reach, as the sim measures it).
  meleeReach() {
    return BREATH_BODY_RADIUS + BODY_EDGE_MELEE_REACH;
  },
  targets(world, st, b) {
    const me = world.players.get(b.pid);
    const isle = me ? isleOf(world, me) : -1;
    if (isle >= 0) return isleTarget(world, isle, me);
    const g = world.mobs.guardian;
    // Inside its cocoon it cannot be harmed: nobody wastes a cast on it.
    if (g && hasAura(g, ISLE_AURAS.cocoon)) return null;
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
    note(
      `Islands of the Wind: ${st.isleRounds ? 'reached' : 'not reached'}; rides out ${st.ridesOut}, home ${st.ridesHome}; stones stilled ${st.stilled}${st.phaseSec ? `; phase ${st.phaseSec.toFixed(0)} s` : ''}`,
    );
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
    stilled: 0,
    phaseAt: 0,
    phaseSec: 0,
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
  mine.sort((x, y) => KILL_ORDER.indexOf(x.tid) - KILL_ORDER.indexOf(y.tid) || x.hp - y.hp);
  return mine[0] ?? null;
}

/** A bot's side of the split (0 east, 1 west). */
function sideOf(st, b) {
  st.side ??= new Map();
  if (st.side.has(b.pid)) return st.side.get(b.pid);
  let side = SIDES[b.spec?.key];
  if (side === undefined) {
    const n = [0, 0];
    for (const v of st.side.values()) n[v]++;
    side = n[0] <= n[1] ? 0 : 1;
  }
  st.side.set(b.pid, side);
  return side;
}

/** The phase is on: the guardian channels Skyrend Nova in its cocoon. */
function islesOn(world) {
  const g = world.mobs.guardian;
  return !!g && (g.cast === ISLE_CASTS.nova || hasAura(g, ISLE_AURAS.cocoon));
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
    else if (cur === ISLE_CASTS.nova) {
      st.isleRounds++;
      st.phaseAt = fightSec();
      log('GALE COCOON: Skyrend Nova gathers; the raid splits to the isles');
    }
    if (st.prevCast === ISLE_CASTS.nova && cur !== ISLE_CASTS.nova) {
      st.phaseSec = fightSec() - st.phaseAt;
      log(`ISLANDS OF THE WIND over after ${st.phaseSec.toFixed(0)} s`);
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
  st.stillSeen ??= new Set();
  for (const e of world.stones ?? [])
    if (hasAura(e, ISLE_AURAS.cocoon) && !st.stillSeen.has(e.id)) {
      st.stillSeen.add(e.id);
      st.stilled++;
      log(`STILLSTONE stilled (${st.stilled} of 2)`);
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
  // BREATH_AT=isles: the leader starts the Islands of the Wind 8 s after the
  // pull (`/dev heart breath isles`), so a run tests the phase on its own
  // (Heroic's Knotted Gale wipes a bot raid in phase 1 more often than not).
  if (BREATH_AT === 'isles' && st.engagedAt && !st.skipSent && Date.now() - st.engagedAt > 8000) {
    st.skipSent = true;
    world.leader.chat('/dev heart breath isles');
    log('BREATH_AT=isles: the leader starts the Islands of the Wind');
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
      // A carrier who made no headway toward it in 4 s (lifted by the Cradle,
      // stunned, held up) hands it to the nearest free bot: the fuse does not wait.
      st.carrierSince ??= new Map();
      if (cp && !cp.dead) {
        const since = st.carrierSince.get(k.id);
        const now = { t: fightSec(), d: hypot(cp, k) };
        if (!since) {
          st.carrierSince.set(k.id, now);
          continue;
        }
        if (now.t - since.t < 4) continue;
        if (since.d - now.d >= 4) {
          st.carrierSince.set(k.id, now);
          continue;
        }
        log(`KNOTTED GALE: ${cp.name} is held up; the ball goes to another`);
      }
      const busy = new Set([...st.carrier.values()].filter((pid) => pid !== cur));
      if (cp && !cp.dead) busy.add(cur);
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
        st.carrierSince.set(k.id, { t: fightSec(), d: hypot(free[0], k) });
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
  if (islesOn(world)) {
    // On the Cornice: into the side's Updraft (the whole raid goes).
    const side = sideOf(st, b);
    const pad = o.pads.find((p) => p.from < 0 && p.to === side * 3);
    if (pad) return { goal: pad, tol: 0.8, duty: 'ride' };
  }
  const knot = knotDuty(world, st, b, me);
  if (knot) return knot;
  const g = world.mobs.guardian;
  // The Roar's blast: run straight back against it at once (the owner's call
  // of 2026-11-17: whoever stands is carried off the Cornice).
  if (alive(g) && hasAura(me, WIND_BLAST_AURA) && IGNORE !== 'roar')
    return { goal: { x: g.x, z: g.z }, tol: 4, duty: 'blast' };
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
    const margin = inBreathArena(land.x, land.z) ? lipDistance(land.x, land.z) : 0;
    // Five yards of floor past the landing: the wind and the slide carry a
    // thrown body a little further than the throw itself.
    if (margin < 5) continue;
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
  const spots = isleSpots()[isle];
  const land = W(world, spots.land);
  const onIsle = (at) => {
    const l = L(world, at);
    return isleAt(l.x, l.z) === isle;
  };
  // Channeling the Stillstone: hold still (no strike is laid under the
  // channeler; a step would break it).
  if (b.self?.cast === ISLE_CASTS.still) return { goal: me, hold: true, duty: 'stone' };
  // Sky's Reckoning: out of any strike laid on the isle.
  for (const k of o.strikes) {
    if (hypot(k, me) > k.r + 1) continue;
    const away = unit(k, me);
    for (const d of [4.5, 3, 6]) {
      const at = add(k, hypot(k, me) < 0.3 ? unit(me, land) : away, k.r + d - 2);
      if (onIsle(at)) return { goal: at, tol: 0.6, duty: 'isle dodge' };
    }
    return { goal: land, tol: 0.8, duty: 'isle dodge' };
  }
  const mine = world.isleAdds.filter((m) => isleOf(world, m) === isle);
  // The Herald's gale: out of its line, sideways, and held there while its
  // bar runs (back to the fight only once it has landed: never a step back
  // into the line).
  st.galeDodge ??= new Map();
  const kept = st.galeDodge.get(b.pid);
  if (kept) {
    const h = mine.find((m) => m.id === kept.herald);
    if (h && h.cast === ISLE_CASTS.shove) return { goal: kept.at, tol: 0.5, duty: 'isle gale' };
    st.galeDodge.delete(b.pid);
  }
  for (const h of mine) {
    if (h.tid !== ISLE_MOBS.herald || h.cast !== ISLE_CASTS.shove) continue;
    const dir = { ux: Math.sin(h.f ?? 0), uz: Math.cos(h.f ?? 0) };
    if (!inShoveLine({ x: h.x, z: h.z }, dir, me.x, me.z)) continue;
    // The nearest spot on the isle clear of the line (with a yard to spare).
    const mid = W(world, spots);
    let best = null;
    for (const r of [0, 2, 4, 6, 8])
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const at = { x: mid.x + Math.sin(a) * r, z: mid.z + Math.cos(a) * r };
        if (!onIsle(at)) continue;
        const clear = [-1.5, 0, 1.5].every(
          (o) => !inShoveLine({ x: h.x, z: h.z }, dir, at.x - dir.uz * o, at.z + dir.ux * o),
        );
        if (!clear) continue;
        if (!best || hypot(me, at) < hypot(me, best)) best = at;
      }
    if (best) {
      st.galeDodge.set(b.pid, { herald: h.id, at: best });
      return { goal: best, tol: 0.5, duty: 'isle gale' };
    }
  }
  if (mine.length > 0) {
    if (me.tank) {
      const t = world.allEnts?.get(b.tankTarget) ?? mine[0];
      const at = add(t, unit(t, me), 2.2);
      return { goal: onIsle(at) ? at : land, tol: 1.2, duty: 'isle tank' };
    }
    const t = isleTarget(world, isle, me);
    if (!t) return { goal: land, tol: 1.5, duty: 'isle wait' };
    // The Shieldbearer: strike its back (its ward turns aside the front).
    if (t.tid === ISLE_MOBS.shieldbearer) {
      const back = { x: -Math.sin(t.f ?? 0), z: -Math.cos(t.f ?? 0) };
      const r = b.spec.melee ? 2.5 : 8;
      for (const turn of [0, 0.5, -0.5, 0.9, -0.9]) {
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const d = { x: back.x * c - back.z * sn, z: back.x * sn + back.z * c };
        const at = add(t, d, r);
        if (onIsle(at)) return { goal: at, tol: 1.0, duty: 'isle back' };
      }
    }
    if (b.spec.melee) {
      const at = add(t, unit(t, me), 2);
      return { goal: onIsle(at) ? at : land, tol: 1.2, duty: 'isle fight' };
    }
    return { goal: land, tol: 2.0, duty: 'isle fight' };
  }
  // Cleared: on to the next isle.
  const pad = o.pads.find((p) => p.from === isle);
  if (pad) return { goal: pad, tol: 0.8, duty: 'ride on' };
  // The chain's end: the stone, channeled by one damage dealer (the rest
  // stand clear of it so no hit lands on the channeler).
  const stone = world.stones.find((e) => isleOf(world, e) === isle);
  if (stone && islesOn(world)) {
    const team = world
      .living()
      .filter((p) => p.bot && isleOf(world, p) === isle && !p.tank && !p.healer)
      .sort((x, y) => x.pid - y.pid);
    const who = team[0] ?? world.living().find((p) => p.bot && isleOf(world, p) === isle);
    if (who?.pid === b.pid) {
      if (hypot(me, stone) > 3.2)
        return { goal: add(stone, unit(stone, me), 2), tol: 0.6, duty: 'stone' };
      const press = (bot) => {
        if (bot.self.cast === ISLE_CASTS.still) return true;
        if (Date.now() - (bot.lastPress ?? 0) < 700) return true;
        bot.lastPress = Date.now();
        if (bot.self.target !== stone.id) bot.cmd({ cmd: 'target', id: stone.id });
        else bot.cmd({ cmd: 'interact' });
        return true;
      };
      return { goal: me, hold: true, duty: 'stone', cast: press };
    }
  }
  return { goal: land, tol: 1.5, duty: 'isle wait' };
}

// ---- the Knotted Gale (Heroic and Mythic) -------------------------------------------

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

/** The walk to the edge from `from`: the sim's own shortest way over the floor
 *  (breath_geometry.ts edgeWalk, claim-local) to the nearest throwable lip, and
 *  its length (Infinity off the floor). */
function edgeRoute(world, from) {
  const l = L(world, from);
  const path = edgeWalk(l.x, l.z);
  let length = path.length > 0 ? Math.hypot(path[0].x - l.x, path[0].z - l.z) : Infinity;
  for (let i = 1; i < path.length; i++)
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return { path, length };
}

/** The next waypoint of a walk (world space), advancing past those reached. */
function walkStep(world, route, me) {
  const l = L(world, me);
  while (
    route.next < route.path.length - 1 &&
    Math.hypot(route.path[route.next].x - l.x, route.path[route.next].z - l.z) < 1
  )
    route.next++;
  return W(world, route.path[route.next]);
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
  // The walk to the edge: the sim's shortest way over the floor to the
  // nearest lip, unless the portals (the one nearest the ball in, its
  // partner out, then its lip) are a clearly shorter way. Chosen once per
  // carry (and once more when the portals open), so the walk never dithers.
  st.knotRoute ??= new Map();
  const open = Object.entries(o.portals);
  let route = st.knotRoute.get(b.pid);
  if (route?.ball !== ball.id) route = undefined;
  if (!route || (route.way === 'walk' && !route.sawPortals && open.length > 0)) {
    const walk = edgeRoute(world, me);
    let way = 'walk';
    if (open.length > 0) {
      const [inSide, inP] = open.sort((x, y) => hypot(x[1], ball) - hypot(y[1], ball))[0];
      const out = o.portals[PARTNER[inSide]];
      if (out) {
        const via = hypot(me, inP) + edgeRoute(world, out).length;
        if (via + 3 < walk.length) way = inSide;
      }
    }
    route = { ball: ball.id, way, sawPortals: open.length > 0, path: walk.path, next: 0 };
    st.knotRoute.set(b.pid, route);
    log(
      `  knot: ${me.name} takes the ${way === 'walk' ? `walk to the edge (${walk.length.toFixed(1)} yd)` : `portal ${way}`}`,
    );
  }
  if (route.way !== 'walk') {
    const inP = o.portals[route.way];
    const out = o.portals[PARTNER[route.way]];
    if (out && hypot(me, out) < 4) {
      // Out at the far mouth: on to the lip beside it.
      route.way = 'walk';
      route.path = edgeRoute(world, me).path;
      route.next = 0;
    } else if (inP) return { goal: inP, tol: 0.3, duty: 'carry to the portal' };
  }
  if (route.path.length === 0)
    return { goal: lipSpotFor(world, me), tol: 0.4, duty: 'walk to the edge' };
  return { goal: walkStep(world, route, me), tol: 0.3, duty: 'walk to the edge' };
}

export default breath;
