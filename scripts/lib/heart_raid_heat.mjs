// The Guardian of the Heat's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=heat; the plumbing is scripts/lib/heart_raid_bots.mjs). The guardian
// never leaves its wellspring: the tanks hold it from the lip and swap on
// Cinder Grip, the raid stands within Hearth Flare's reach on the shore, out of
// Basalt Fist's spot and its Molten Swells' lanes, walks the overflows' lava
// waves' corridors (the corridor of the next wall to reach it, close to the
// wellspring once a wall has passed), heals through the Falling Cinders, drops the
// Hearthseeds together and runs, steps into the Wakefire band that has just
// burned, crosses to the Wheel of the Hearth's dark slice (every tier), kites a Rolling Cinder while two strikers knock it back, and
// burns the adds (Wellspawn first), and keeps a Heroic Live Coal's bearer apart
// while the healers break it (heart_raid_heat_coal.mjs). The overflow's corridors
// are planned against the clock with the Wellspawn in reach (heart_raid_heat_waves.mjs).
// Reads only what the server sends; the geometry is the sim's own pure module
// (claim-local).
//
// IGNORE=wakefire  nobody leaves a Wakefire band (the key mechanic)
// IGNORE=coal      a Live Coal's bearer stands where it is

import { HEARTH_WELL } from '../../src/sim/content/smith_heart_layout';
import {
  inHearthFloor,
  inRingCorridor,
  wellDistance,
  wheelSliceAt,
} from '../../src/sim/encounters/smith_heart/heat_geometry';
import {
  gapOf,
  HEAT_AURAS,
  HEAT_BODY_R,
  HEAT_CASTS,
  HEAT_LIP_WALL,
  HEAT_MOBS,
  HEAT_OBJECTS,
  HEAT_TUNING,
  ringOf,
  swellLaneOf,
  WHEEL_ARCS_DEG,
  wheelOf,
  ZONE_BANDS,
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
  tankAssign,
  unit,
} from './heart_raid_bots.mjs';
import {
  coalDuty,
  coalHazards,
  coalObstacles,
  coalUrgency,
  initCoalTally,
  trackCoals,
} from './heart_raid_heat_coal.mjs';
import {
  hitReach,
  spawnTarget,
  waveSpot,
  waveStill,
  wavesOn,
  wellspawn,
} from './heart_raid_heat_waves.mjs';

/** The lip wall's outer face (yards from the well's middle): nobody stands inside it. */
const LIP = HEAT_LIP_WALL.outer;

const T = HEAT_TUNING;
/** Wakefire's bands round the wellspring (inner, outer), the last open: the
 *  sim's own (they follow the well's lip). */
const BANDS = ZONE_BANDS;
const STRIKERS = ['rogue', 'arms'];
/** Yards a bot keeps off a red Wheel slice's edge. */
const WHEEL_EDGE_PAD = 1.5;

const L = (world, p) => ({ x: p.x - world.origin.x, z: p.z - world.origin.z });
const W = (world, p) => ({ x: p.x + world.origin.x, z: p.z + world.origin.z });

export const heat = {
  key: 'heat',
  title: 'Guardian of the Heat',
  tids: { guardian: 'heart_heat_guardian' },
  tp: '/dev heart tp heatboss',
  swapAura: 'stackpoison_heart_heat_guardian',
  swapStacks: 5,
  // The giant's girth: the sim measures a short taunt (the warrior's) to its
  // body's edge (player_attack_reach.ts), so it reaches from past the lip wall.
  // Only the guardian's: its adds are body-less (the sim measures them from the pivot).
  tauntPad: (m) => (m?.tid === 'heart_heat_guardian' ? HEAT_BODY_R - 1 : 0),
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
    world.tankSpot = add(world.center, world.home, LIP + 1.5);
    world.anchor = add(world.center, world.home, LIP + 2);
    // Ranged about 7 yd past the lip wall (the bots' 20 yd ring scaled): out
    // of the melee's band, inside Hearth Flare's reach (12 past the lip).
    world.rangeScale = (LIP + 7) / 20;
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
      spots: [],
      seeds: [],
      zones: [],
      wheel: [],
      rings: [],
      gaps: [],
    };
    for (const e of world.obs.ents.values()) {
      if (e.k !== 'object' || typeof e.tid !== 'string') continue;
      const t = e.tid;
      const at = { x: e.x, z: e.z, r: e.sc ?? 3, f: e.f ?? 0, id: e.id };
      if (t.startsWith(HEAT_OBJECTS.fistPrefix)) o.fist.push({ ...at, r: T.fistR + 1.5 });
      else if (swellLaneOf(t)) o.lanes.push(lane(at, T.laneLength, T.laneHalf + 1));
      else if (t === HEAT_OBJECTS.wave) o.waves.push({ ...at, r: T.laneHalf + 2.5 });
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
      } else if (wheelOf(t)) {
        // As Wakefire's: the template's seconds are the whole warning; the raid
        // counts it down from when it first saw the slice in that state.
        const w = wheelOf(t);
        world.wheelSeen ??= new Map();
        const key = `${e.id}:${w.state}`;
        if (!world.wheelSeen.has(key)) world.wheelSeen.set(key, Date.now());
        const left = w.seconds - (Date.now() - world.wheelSeen.get(key)) / 1000;
        o.wheel.push({ ...w, seconds: left });
      } else if (ringOf(t)) {
        const l = L(world, at);
        o.rings.push({
          front: wellDistance(l.x, l.z),
          gaps: ringOf(t).gaps,
          half: e.sc ?? 3,
        });
      } else if (gapOf(t) !== null) {
        // As Wakefire's: the template's seconds are the whole countdown to the
        // ring's launch, counted down from when the raid first saw it.
        world.gapSeen ??= new Map();
        if (!world.gapSeen.has(e.id)) world.gapSeen.set(e.id, Date.now());
        const left = gapOf(t) - (Date.now() - world.gapSeen.get(e.id)) / 1000;
        o.gaps.push({ g: e.f ?? 0, half: e.sc ?? 3, left });
      }
    }
    world.o = o;
  },

  // The lip wall's colliders (smith_heart_layout.ts HEARTH_LIP_WALLS): a bot
  // crossing the shore walks round them, never into them (a straight line
  // between two Wheel slices near the wall clips it).
  // A Live Coal's bearer, and everyone else round one, steer clear too.
  obstacles(world, b) {
    if (!world.center) return [];
    return [{ x: world.center.x, z: world.center.z, r: LIP + 0.2 }, ...coalObstacles(world, b)];
  },

  onFloor(world, at) {
    const l = L(world, at);
    return inHearthFloor(l.x, l.z) && wellDistance(l.x, l.z) > LIP + 0.5;
  },
  tankSpot(world) {
    return world.tankSpot;
  },
  // Melee reaches the giant's body from outside its lip wall.
  meleeReach(t) {
    return t?.tid === heat.tids.guardian ? HEAT_BODY_R + 2.5 : 5.5;
  },
  // The melee stand at the lip wall beside the tank (never in the burning well).
  roleSpot(world, st, b) {
    if (b.spec.role !== 'dps' || !b.spec.melee) return null;
    const a = Math.atan2(world.home.x, world.home.z) + (b.spec.key === 'rogue' ? 0.4 : -0.4);
    return add(world.center, { x: Math.sin(a), z: Math.cos(a) }, LIP + 1.8);
  },
  targets(world, st, b) {
    const me = world.players.get(b.pid);
    const cinder = strikeTarget(world, st, b, me);
    if (cinder) return cinder;
    // The Wellspawn: split over the hitters, each one it can reach from a corridor.
    if (me && wellspawn(world).length) return spawnTarget(world, b, me);
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
  // While the guardian is under, a tank with nothing to hold burns the
  // Wellspawn with the damage dealers (no taunt: they never swing).
  tankAssign(world, st, b, me) {
    tankAssign(world, st, b, me);
    const g = world.mobs.guardian;
    // Under: its state aura's stage is not the fight's (the snapshot carries
    // no `hostile` flag on it).
    const under = !!g && (auraOf(g, HEAT_AURAS.state)?.value2 ?? 0) !== 0;
    const held = typeof b.tankTarget === 'number' ? world.obs.ents.get(b.tankTarget) : null;
    if (!under || (held && held.tid === HEAT_MOBS.keeper && alive(held))) return;
    const t = wellspawn(world).length ? spawnTarget(world, b, me) : null;
    if (!t) return;
    b.tankTarget = t.id;
    b.loose = null;
  },
  // A caster begins a bar only if it can finish it before the next corridor.
  stillFor(world, st, b) {
    const me = world.players.get(b.pid);
    return me ? waveStill(world, me) : undefined;
  },
  // A Wellspawn about to feed the guardian blasts the whole raid: the healers
  // top everyone up first (the bot pass of 2026-11-24: two feeds at once with
  // the raid half down wiped it).
  topUp(world) {
    return wellspawn(world).some((a) => wellGap(world, a) < HEAT_TUNING.spawnReach + 6);
  },
  // A Live Coal's bearer is healed first (the kits' heal-absorb rule, lifted).
  healUrgency(world, p) {
    return coalUrgency(p);
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
    out.push(...coalHazards(world, b));
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
      `Wellspawn fed the guardian: ${st.feeds}; seeds ${st.seedRounds}; Wakefire runs ${st.zoneRuns}; wheels ${st.wheels}; lava waves ${st.waveRings ?? 0}; cinders ${st.cinders}`,
    );
    note(`Phases: ${st.phases.map((p) => `${fmtSec(p.t)} ${p.what}`).join(', ') || '-'}`);
    const c = initCoalTally(st);
    note(
      `Live Coals: ${c.set} set, ${c.out} healed out, ${c.leaps} leapt, ${c.bursts} burst, ${c.doused ?? 0} doused by an overflow, ${c.died} gone with a death (${c.log.join(', ') || 'none'})`,
    );
  },
  row(world, st) {
    init(st);
    const c = initCoalTally(st);
    return [
      ['Fed', String(st.feeds)],
      ['Coals (set/out/leap/burst)', `${c.set}/${c.out}/${c.leaps}/${c.bursts}`],
    ];
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
  if (d < LIP + 0.5) return true;
  for (const h of [...o.fist, ...o.waves, ...o.spots]) if (hypot(h, at) < h.r) return true;
  for (const ln of o.lanes) if (segDist(at, ln.from, ln.to) < ln.half) return true;
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
  // A red slice warning or burning, and its edge's last yard and a half (a bot
  // stops within its tolerance of a goal: never on the line). Since Jose's
  // playtest of 2026-11-24 the sim puts out the way to the next safe slice at
  // once (heat_wheel.ts wheelCrossing), so the raid crosses the moment the next
  // round shows, with its whole warning, instead of waiting out the fire.
  if (o.wheel.length && d > HEARTH_WELL.r) {
    const red = new Set(o.wheel.filter((w) => w.state !== 'safe').map((w) => w.slice));
    const a = Math.atan2(l.x - HEARTH_WELL.x, l.z - HEARTH_WELL.z);
    const pad = WHEEL_EDGE_PAD / d;
    for (const da of [0, -pad, pad]) {
      const b = a + da;
      const at = { x: HEARTH_WELL.x + Math.sin(b) * d, z: HEARTH_WELL.z + Math.cos(b) * d };
      if (red.has(wheelSliceAt(at.x, at.z))) return true;
    }
  }
  // A lava wave's wall on it now or about to be, outside its corridors.
  for (const r of o.rings)
    if (
      d <= r.front + 3 &&
      d >= r.front - T.ringDepth - 0.5 &&
      !inRingCorridor(r.gaps, r.half - 0.8, l.x, l.z)
    )
      return true;
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
  {
    const g = world.mobs.guardian;
    const stage = g ? (auraOf(g, HEAT_AURAS.state)?.value2 ?? 0) : 0;
    trackCoals(world, st, stage !== 0);
  }
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
  if (o.rings.length > (st.prevRings ?? 0)) {
    st.waveRings = (st.waveRings ?? 0) + 1;
    log(
      `LAVA WAVE ${st.waveRings}: corridors ${o.rings[o.rings.length - 1].gaps.map((g) => Math.round((g * 180) / Math.PI)).join(', ')} deg`,
    );
  }
  st.prevRings = o.rings.length;
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
  // Through an overflow with Wellspawn walking: every 2 s where they are and
  // what each hitter does (the bot pass of 2026-11-24 found them unhit).
  const spawns = wellspawn(world);
  if (spawns.length && Date.now() - (st.spawnLogAt ?? 0) > 2000) {
    st.spawnLogAt = Date.now();
    const rows = world.bots
      .filter((b) => b.self && !b.self.dead && b.spec.role !== 'healer')
      .map((b) => {
        const t = b.self.target ? world.obs.ents.get(b.self.target) : null;
        const d = t ? Math.round(hypot(t, b.self)) : '-';
        return `${b.spec.key} ${b.duty}${b.moving ? '*' : ''} ${d}yd`;
      });
    log(
      `  wellspawn ${spawns.map((a) => `${Math.round((a.hp / Math.max(1, a.mhp)) * 100)}%@${wellGap(world, a).toFixed(0)}`).join(' ')}; ${rows.join(', ')}`,
    );
  }
  st.spawnSeen ??= new Map();
  for (const a of world.adds) if (a.tid === HEAT_MOBS.spawn) st.spawnSeen.set(a.id, a);
  for (const [id, a] of st.spawnSeen) {
    if (world.adds.some((x) => x.id === id)) continue;
    st.spawnSeen.delete(id);
    if (wellGap(world, a) < HEAT_TUNING.spawnReach + 1) {
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

/** The lava waves: the corridor of the next wall to reach the bot (the
 *  rolling ring just inside it, else the next ring's warning), on its line at
 *  the bot's own distance, never moving in through a wall that has not passed.
 *  Once a wall has passed, it walks in close to the wellspring, where the next
 *  ring's corridors are only a few yards round. */
function waveGoal(world, me) {
  const o = world.o;
  if (!o || (!o.rings.length && !o.gaps.length)) return null;
  const l = L(world, me);
  const d = wellDistance(l.x, l.z);
  const inner = o.rings
    .filter((r) => r.front - T.ringDepth - 0.6 < d)
    .sort((a, b) => b.front - a.front);
  // The ring still to pass over the bot: its front inside the bot's distance.
  const coming = inner.find((r) => r.front < d + 0.3);
  let gaps;
  let half;
  let radius;
  if (coming) {
    gaps = coming.gaps;
    half = coming.half;
    radius = Math.max(d, coming.front + 1.5);
  } else if (o.gaps.length) {
    gaps = o.gaps.map((g) => g.g);
    half = o.gaps[0].half;
    // Close in toward the wellspring (the next ring's corridors are only a
    // few yards round there), never in through a wall still rolling over the
    // way in.
    radius = Math.max(LIP + 2, Math.min(d, 18));
    const youngest = o.rings.reduce((m, r) => Math.min(m, r.front), Number.POSITIVE_INFINITY);
    if (Number.isFinite(youngest) && youngest < d && youngest > radius - 1) radius = d;
  } else return null;
  // The nearest corridor along the bot's ring of the floor.
  const a = Math.atan2(l.x - HEARTH_WELL.x, l.z - HEARTH_WELL.z);
  let best = null;
  for (const g of gaps) {
    const da = Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (!best || da < best.da) best = { g, da };
  }
  if (!best) return null;
  const at = {
    x: HEARTH_WELL.x + Math.sin(best.g) * radius,
    z: HEARTH_WELL.z + Math.cos(best.g) * radius,
  };
  if (!inHearthFloor(at.x, at.z)) return null;
  const inside = inRingCorridor([best.g], Math.max(0.5, half - 1), l.x, l.z);
  return { goal: W(world, at), tol: inside ? Math.max(1, half - 1.5) : 0.8 };
}

function duty(world, st, b, me) {
  init(st);
  const o = world.o;
  // The lava waves first: a wall outside a corridor is a heavy blow. The
  // corridor spot is planned against the clock with the hitter's Wellspawn in
  // reach (heart_raid_heat_waves.mjs); the old nearest-corridor walk is the
  // fallback when no spot can be reached in time.
  if (wavesOn(world)) {
    const hitter = b.spec.role === 'dps' || b.spec.role === 'tank';
    const t = hitter ? spawnTarget(world, b, me) : null;
    const spot = waveSpot(world, me, t, t ? hitReach(b) : 0);
    if (spot) return { goal: spot.goal, tol: spot.tol, duty: 'lava waves', ownThreat: true };
  }
  const wave = waveGoal(world, me);
  if (wave) return { goal: wave.goal, tol: wave.tol, duty: 'lava waves', ownThreat: true };
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
  // A Live Coal: its bearer apart from everyone (out of the seeds' reach too),
  // everyone else off its bearer.
  {
    const seedOk = (at) => o.seeds.every((s) => hypot(s, at) >= 18);
    const c = coalDuty(
      world,
      st,
      b,
      me,
      (from, extra, max) => safeNear(world, st, from, me, (at) => extra(at) && seedOk(at), max),
      (at) => !inDanger(world, at, st) && seedOk(at),
    );
    if (c) return c;
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
