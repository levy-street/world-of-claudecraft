// The Guardian of the Heat's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=heat; the plumbing is scripts/lib/heart_raid_bots.mjs). The guardian
// never leaves its wellspring: the tanks hold it from the lip and swap on
// Cinder Grip, the raid stands within Hearth Flare's reach on the shore, out of
// Basalt Fist's spot and its Molten Swells' lanes, out of the overflow's rivers
// and Falling Cinders, drops the Hearthseeds together and runs, steps into the
// Wakefire band that has just burned, crosses to the Wheel of the Hearth's dark
// slice (Mythic), kites a Rolling Cinder while two strikers knock it back, and
// burns the adds (Wellspawn first). Reads only what the server sends; the
// geometry is the sim's own pure module (claim-local).
//
// IGNORE=wakefire  nobody leaves a Wakefire band (the key mechanic)

import { HEARTH_WELL } from '../../src/sim/content/smith_heart_layout';
import {
  inHearthFloor,
  wellDistance,
  wheelSliceAt,
} from '../../src/sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_MOBS,
  HEAT_OBJECTS,
  HEAT_TUNING,
  riverOf,
  swellLaneOf,
  WHEEL_ARCS_DEG,
  wheelOf,
  zoneOf,
} from '../../src/sim/encounters/smith_heart/heat_ids';
import {
  add,
  alive,
  auraOf,
  fightSec,
  fmtSec,
  hasAura,
  hypot,
  IGNORE,
  log,
  segDist,
  unit,
} from './heart_raid_bots.mjs';

const T = HEAT_TUNING;
/** Wakefire's bands round the wellspring (inner, outer), the last open. */
const BANDS = [
  [8, 19],
  [19, 31],
  [31, 60],
];
const STRIKERS = ['rogue', 'arms'];

const L = (world, p) => ({ x: p.x - world.origin.x, z: p.z - world.origin.z });
const W = (world, p) => ({ x: p.x + world.origin.x, z: p.z + world.origin.z });

export const heat = {
  key: 'heat',
  title: 'Guardian of the Heat',
  tids: { guardian: 'heart_heat_guardian' },
  tp: '/dev heart tp heatboss',
  swapAura: 'stackpoison_heart_heat_guardian',
  swapStacks: 5,
  // The giant's girth: a taunt reaches it from the lip.
  tauntPad: 5,
  resetGrace: 30000,
  setup(diff) {
    const out = [
      '/dev heart kill hammer',
      '/dev heart kill trash',
      '/dev heart gates',
      '/dev heart heat reset',
    ];
    if (diff === 'mythic') out.push('/dev heart heat mythic on');
    else if (diff === 'heroic') out.push('/dev heart heat heroic on');
    else out.push('/dev heart heat heroic off', '/dev heart heat mythic off');
    return out;
  },

  locate(world) {
    const well = [...world.obs.ents.values()].find(
      (e) =>
        e.k === 'object' && typeof e.tid === 'string' && e.tid.startsWith(HEAT_OBJECTS.wellPrefix),
    );
    if (!well) return false;
    world.origin = { x: well.x - HEARTH_WELL.x, z: well.z - HEARTH_WELL.z };
    world.center = { x: well.x, z: well.z };
    world.home = unit(world.center, world.obs.self);
    world.tankSpot = add(world.center, world.home, HEARTH_WELL.r + 1.5);
    world.anchor = add(world.center, world.home, HEARTH_WELL.r + 2);
    // Ranged at 13 to 17 yd from the well's middle: inside Hearth Flare's 20.
    world.rangeScale = 0.62;
    world.arcSpan = 1.5;
    world.prepull = add(world.center, world.home, 26);
    world.reach = 45;
    return true;
  },

  read(world) {
    const o = {
      fist: [],
      lanes: [],
      waves: [],
      rivers: [],
      spots: [],
      seeds: [],
      zones: [],
      wheel: [],
    };
    for (const e of world.obs.ents.values()) {
      if (e.k !== 'object' || typeof e.tid !== 'string') continue;
      const t = e.tid;
      const at = { x: e.x, z: e.z, r: e.sc ?? 3, f: e.f ?? 0, id: e.id };
      if (t.startsWith(HEAT_OBJECTS.fistPrefix)) o.fist.push({ ...at, r: T.fistR + 1.5 });
      else if (swellLaneOf(t)) o.lanes.push(lane(at, T.laneLength, T.laneHalf + 1));
      else if (t === HEAT_OBJECTS.wave) o.waves.push({ ...at, r: T.laneHalf + 2.5 });
      else if (riverOf(t)) o.rivers.push(lane(at, T.riverLength, (e.sc ?? T.riverHalf) + 1));
      else if (
        t.startsWith(HEAT_OBJECTS.fallPrefix) ||
        t.startsWith(HEAT_OBJECTS.scorchPrefix) ||
        t.startsWith(HEAT_OBJECTS.trailPrefix)
      )
        o.spots.push({ ...at, r: at.r + 1.2 });
      else if (t.startsWith(HEAT_OBJECTS.seedPrefix)) o.seeds.push(at);
      else if (zoneOf(t)) {
        // The template's seconds are its whole warning, not what is left: the
        // raid counts it down from when it first saw the band.
        const z = zoneOf(t);
        world.zoneSeen ??= new Map();
        const key = `${e.id}:${z.state}`;
        if (!world.zoneSeen.has(key)) world.zoneSeen.set(key, Date.now());
        const left = z.seconds - (Date.now() - world.zoneSeen.get(key)) / 1000;
        o.zones.push({ ...z, seconds: left });
      } else if (wheelOf(t)) o.wheel.push(wheelOf(t));
    }
    world.o = o;
  },

  onFloor(world, at) {
    const l = L(world, at);
    return inHearthFloor(l.x, l.z) && wellDistance(l.x, l.z) > HEARTH_WELL.r + 1;
  },
  tankSpot(world) {
    return world.tankSpot;
  },
  // Melee reaches the giant's body from the wellspring's lip.
  meleeReach(t) {
    return t?.tid === heat.tids.guardian ? HEARTH_WELL.r + 2.5 : 5.5;
  },
  // The melee stand on the lip beside the tank (never in the burning well).
  roleSpot(world, st, b) {
    if (b.spec.role !== 'dps' || !b.spec.melee) return null;
    const a = Math.atan2(world.home.x, world.home.z) + (b.spec.key === 'rogue' ? 0.4 : -0.4);
    return add(world.center, { x: Math.sin(a), z: Math.cos(a) }, HEARTH_WELL.r + 1.8);
  },
  targets(world, st, b) {
    const me = world.players.get(b.pid);
    const cinder = strikeTarget(world, st, b, me);
    if (cinder) return cinder;
    // The adds first: the Wellspawn before they reach the lip, then the
    // Seedflames; the Wellkeepers are the off-tank's.
    const adds = world.adds.filter(
      (a) => a.tid === HEAT_MOBS.spawn || a.tid === HEAT_MOBS.seedflame,
    );
    if (adds.length) {
      // The Wellspawn slow with their health (fully at half): the damage
      // dealers split over the ones still walking fast, nearest the wellspring
      // first, and finish the slowed ones together once none walks fast.
      const byGap = adds.sort((x, y) => wellGap(world, x) - wellGap(world, y));
      const fast = byGap.filter(
        (a) => a.tid === HEAT_MOBS.spawn && a.hp / Math.max(1, a.mhp) > HEAT_TUNING.spawnSlowAt,
      );
      if (fast.length > 1) {
        const dps = world.bots.filter((x) => x.spec.role === 'dps');
        return fast[Math.max(0, dps.indexOf(b)) % fast.length];
      }
      return byGap[0];
    }
    const g = world.mobs.guardian;
    return g?.hostile === false ? null : g;
  },
  // A Wellspawn still walking fast is worth a slow or a control.
  wantSlow(world, t) {
    return t.tid === HEAT_MOBS.spawn && t.hp / Math.max(1, t.mhp) > HEAT_TUNING.spawnSlowAt;
  },
  tankAdd(a) {
    return a.tid === HEAT_MOBS.keeper;
  },

  bad(world, st, at) {
    return inDanger(world, at, st);
  },
  hazards(world, st, b, me) {
    const out = [];
    const o = world.o;
    if (!o) return out;
    for (const h of [...o.fist, ...o.waves, ...o.spots]) out.push(h);
    // A kindled or trailing player and a hunted one keep the raid off them.
    for (const p of world.living()) {
      if (p.pid === b.pid) continue;
      if (hasAura(p, HEAT_AURAS.kindling) || hasAura(p, HEAT_AURAS.trail))
        out.push({ x: p.x, z: p.z, r: 6 });
    }
    for (const c of cinders(world)) out.push({ x: c.x, z: c.z, r: 5 });
    return out;
  },

  track(world, st) {
    track(world, st);
  },
  duty(world, st, b, me) {
    return duty(world, st, b, me);
  },

  statusLine(world) {
    const g = world.mobs.guardian;
    const sa = g ? auraOf(g, HEAT_AURAS.state) : null;
    return `phase ${sa?.value ?? '?'} stage ${sa?.value2 ?? '?'}; adds ${world.adds.length}`;
  },
  report(world, st, note) {
    init(st);
    note(
      `Wellspawn fed the guardian: ${st.feeds}; seeds ${st.seedRounds}; Wakefire runs ${st.zoneRuns}; wheels ${st.wheels}; cinders ${st.cinders}`,
    );
    note(`Phases: ${st.phases.map((p) => `${fmtSec(p.t)} ${p.what}`).join(', ') || '-'}`);
  },
  row(world, st) {
    init(st);
    return [['Fed', String(st.feeds)]];
  },
};

function lane(at, length, half) {
  const d = { x: Math.sin(at.f), z: Math.cos(at.f) };
  return { from: { x: at.x, z: at.z }, to: add(at, d, length), half };
}

function wellGap(world, p) {
  const l = L(world, p);
  return wellDistance(l.x, l.z);
}

function cinders(world) {
  return [...world.obs.ents.values()].filter(
    (e) => e.k === 'mob' && e.tid === HEAT_MOBS.cinder && !e.dead,
  );
}

/** Is a spot in harm's way now: the fist, a lane, a wave, a river, a patch,
 *  a band or a red slice that warns or burns, or past Hearth Flare's reach in
 *  phase 1? */
function inDanger(world, at, st) {
  const o = world.o;
  if (!o) return false;
  const l = L(world, at);
  if (!inHearthFloor(l.x, l.z)) return true;
  const d = wellDistance(l.x, l.z);
  if (d < HEARTH_WELL.r + 1) return true;
  for (const h of [...o.fist, ...o.waves, ...o.spots]) if (hypot(h, at) < h.r) return true;
  for (const ln of [...o.lanes, ...o.rivers])
    if (segDist(at, ln.from, ln.to) < ln.half) return true;
  if (IGNORE !== 'wakefire')
    for (const z of o.zones)
      if (
        // A band burning, or about to ignite, is out; one early in its warning is
        // where the raid waits (the band inside it burns first, then the raid
        // steps into that one as this one ignites).
        (z.state === 'burn' || z.seconds <= 2.2) &&
        d >= BANDS[z.band][0] - 1 &&
        d < BANDS[z.band][1] + 1
      )
        return true;
  for (const w of o.wheel)
    if (w.state !== 'safe' && wheelSliceAt(l.x, l.z) === w.slice && d > HEARTH_WELL.r) return true;
  const g = world.mobs.guardian;
  const phase = g ? (auraOf(g, HEAT_AURAS.state)?.value ?? 1) : 1;
  if (phase <= 1 && d > T.flareReach - 2) return true;
  return false;
}

function init(st) {
  if (st.phases) return;
  Object.assign(st, {
    phases: [],
    feeds: 0,
    seedRounds: 0,
    zoneRuns: 0,
    wheels: 0,
    cinders: 0,
    prevCast: null,
    prevState: null,
    prevSeeds: 0,
    prevZones: 0,
    prevWheel: 0,
    prevCinders: 0,
    seedRun: new Map(),
  });
}

function track(world, st) {
  init(st);
  const g = world.mobs.guardian;
  const sa = g ? auraOf(g, HEAT_AURAS.state) : null;
  const key = sa ? `${sa.value}/${sa.value2}` : null;
  if (key && key !== st.prevState) {
    st.phases.push({ t: fightSec(), what: `phase ${sa.value} stage ${sa.value2}` });
    log(`HEAT: phase ${sa.value}, stage ${sa.value2}`);
    st.prevState = key;
  }
  const cur = g?.cast ?? null;
  if (cur !== st.prevCast) {
    if (cur === HEAT_CASTS.fist) log('BASALT FIST');
    st.prevCast = cur;
  }
  const o = world.o;
  if (o.seeds.length && !st.prevSeeds) {
    st.seedRounds++;
    log(`HEARTHSEEDS: ${o.seeds.length} fall`);
  }
  st.prevSeeds = o.seeds.length;
  if (o.zones.length && !st.prevZones) {
    st.zoneRuns++;
    log(`WAKEFIRE: ${o.zones.map((z) => `${z.band}:${z.state}`).join(' ')}`);
    setTimeout(() => {
      const rows = world.bots
        .filter((b) => b.self && !b.self.dead)
        .map((b) => `${b.name} ${wellGap(world, b.self).toFixed(0)}yd ${b.duty}`);
      log(
        `  wakefire +2.5 s: ${world.o.zones.map((z) => `${z.band}:${z.state}`).join(' ')}; ${rows.join(', ')}`,
      );
    }, 2500);
  }
  st.prevZones = o.zones.length;
  if (o.wheel.length && !st.prevWheel) {
    st.wheels++;
    log('WHEEL OF THE HEARTH');
  }
  st.prevWheel = o.wheel.length;
  const nc = cinders(world).length;
  if (nc > st.prevCinders) {
    st.cinders += nc - st.prevCinders;
    log('ROLLING CINDER');
  }
  st.prevCinders = nc;
  st.spawnSeen ??= new Map();
  for (const a of world.adds) if (a.tid === HEAT_MOBS.spawn) st.spawnSeen.set(a.id, a);
  for (const [id, a] of st.spawnSeen) {
    if (world.adds.some((x) => x.id === id)) continue;
    st.spawnSeen.delete(id);
    if (wellGap(world, a) < HEARTH_WELL.r + 2.5) {
      st.feeds++;
      log('WELLSPAWN reached the wellspring');
    }
  }
}

/** A striker's cinder: the one nearest its quarry, while it is close and
 *  not crusted (a strike then knocks it back). */
function strikeTarget(world, st, b, me) {
  if (!STRIKERS.includes(b.spec.key) || !me) return null;
  const hunted = world.living().find((p) => hasAura(p, HEAT_AURAS.hunted));
  for (const c of cinders(world)) {
    if (hasAura(c, HEAT_AURAS.crust)) continue;
    if (hunted && hypot(c, hunted) > 9) continue;
    return c;
  }
  return null;
}

function duty(world, st, b, me) {
  init(st);
  const o = world.o;
  // A cinder's quarry runs round the shore, away from it.
  if (hasAura(me, HEAT_AURAS.hunted)) {
    const c = cinders(world).sort((x, y) => hypot(x, me) - hypot(y, me))[0];
    if (c) {
      const away = unit(c, me);
      const spot = safeNear(world, st, add(me, away, 8), me);
      if (spot) return { goal: spot, tol: 1, duty: 'kite' };
    }
  }
  // A striker walks into reach of the cinder it is to knock back.
  const c = strikeTarget(world, st, b, me);
  if (c) return { goal: add(c, unit(c, me), 2.5), tol: 1.2, duty: 'strike the cinder' };
  // Kindled or trailing fire: away from the raid until it ends.
  if (hasAura(me, HEAT_AURAS.kindling) || hasAura(me, HEAT_AURAS.trail)) {
    const far = add(world.center, unit(world.anchor, world.center), -24);
    const spot = safeNear(
      world,
      st,
      add(far, { x: Math.sin(Date.now() / 3000), z: Math.cos(Date.now() / 3000) }, 4),
      me,
    );
    if (spot) return { goal: spot, tol: 1.2, duty: 'trail fire away' };
  }
  // Hearthseeds: away from every seed until they burst.
  if (o.seeds.length) {
    const seedOk = (at) => o.seeds.every((s) => hypot(s, at) >= 18);
    if (!seedOk(me)) {
      const spot = safeNear(world, st, me, me, seedOk, 30);
      if (spot) return { goal: spot, tol: 1.2, duty: 'run from the seeds' };
    }
  }
  if (inDanger(world, me, st)) {
    const spot = safeNear(world, st, me, me);
    if (spot) return { goal: spot, tol: 0.8, duty: 'dodge' };
  }
  return null;
}

/** The nearest safe floor spot to `from` (within `max`), passing `extra`. */
function safeNear(world, st, from, me, extra = () => true, max = 22) {
  for (let r = 0; r <= max; r += 1.5) {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const at = add(from, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (inDanger(world, at, st) || !extra(at)) continue;
      const d = hypot(at, me);
      if (!best || d < best.d) best = { at, d };
    }
    if (best) return best.at;
  }
  return null;
}

export default heat;
