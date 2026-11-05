// The Masterless Strength's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=final; the plumbing is scripts/lib/heart_raid_bots.mjs). The tanks drag
// the boss round the Anvil's four quarters by their Overload bars (it roots 10 s
// in each new quarter; it is moved on once its bar fills past two thirds,
// toward the emptier neighbour, never parked in the ring), the raid follows it
// and plays each quarter's kit: out of Basalt Fist's spot and lanes, the Fire
// Whirls, the pools and the cracks, huddled in the Quench quarter, spread for
// the Leaping Bolt, one player on each Storm Orb, everyone under Weight of the
// Anvil (the Crushed aside on Heroic). In the intermissions the damage dealers
// burn the Splinters (Rime Toll kicked); in the final phase everyone stays in
// the ring; on Mythic's hidden phase nobody stands on a fallen or falling
// quarter. Reads only what the server sends; the geometry is the sim's own
// pure module (claim-local).
//
// IGNORE=drag  the tanks never move the boss on (the key mechanic: Overload)

import { HEART_ROOM } from '../../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterAt,
  heartQuarterSpot,
} from '../../src/sim/content/smith_heart_quarters';
import {
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_OBJECTS,
  FINAL_TUNING,
  finalZoneOf,
  overloadAuraId,
} from '../../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_ADD_MOBS,
  FINAL_PHASE_AURAS,
  FINAL_PHASE_CASTS,
  hiddenFallenAt,
} from '../../src/sim/encounters/smith_heart/final_phase_ids';
import {
  HEAT_OBJECTS,
  HEAT_TUNING,
  swellLaneOf,
} from '../../src/sim/encounters/smith_heart/heat_ids';
import {
  add,
  alive,
  auraOf,
  DIFF,
  fightSec,
  fmtSec,
  HEROIC_PLUS,
  hasAura,
  hypot,
  IGNORE,
  log,
  segDist,
  tankAssign,
  unit,
} from './heart_raid_bots.mjs';

const T = FINAL_TUNING;
const SPLINTERS = new Set(Object.values(FINAL_ADD_MOBS));
const L = (world, p) => ({ x: p.x - world.origin.x, z: p.z - world.origin.z });
const W = (world, p) => ({ x: p.x + world.origin.x, z: p.z + world.origin.z });
/** Move the boss on once its quarter's bar passes this. */
const MOVE_AT = 45;

export const final = {
  key: 'final',
  title: 'Masterless Strength',
  tids: { boss: 'heart_masterless_strength' },
  tp: '/dev heart tp final',
  // The paladin pulls with its 29 yd taunt from a quarter, so the boss walks
  // straight out of the ring (Heart Unbound stacks every second it stays).
  opener: 'ot',
  resetGrace: 50000,
  setup(diff) {
    const out = ['/dev heart kill guardians', '/dev heart portal', '/dev heart final reset'];
    out.push(`/dev heart final ${diff}`);
    return out;
  },

  locate(world) {
    const b = world.mobs.boss;
    if (!b) return false;
    world.origin = { x: b.x - HEART_ROOM.x, z: b.z - HEART_ROOM.z };
    world.center = { x: b.x, z: b.z };
    world.home = unit(world.center, world.obs.self);
    world.anchor = world.center;
    world.prepull = add(world.center, world.home, 26);
    world.rangeScale = 0.7;
    world.arcSpan = 1.2;
    world.reach = 70;
    return true;
  },

  read(world) {
    const o = { danger: [], lanes: [], orbs: [], anvils: [], ice: [] };
    for (const e of world.obs.ents.values()) {
      if (e.k !== 'object' || typeof e.tid !== 'string') continue;
      const t = e.tid;
      const at = { x: e.x, z: e.z, r: e.sc ?? 3, f: e.f ?? 0, id: e.id };
      if (t.startsWith(FINAL_OBJECTS.orbPrefix)) o.orbs.push(at);
      else if (t.startsWith(FINAL_OBJECTS.anvilPrefix))
        o.anvils.push({ ...at, r: at.r || T.anvilR });
      else if (t.startsWith(FINAL_OBJECTS.crackPrefix)) o.ice.push({ ...at, r: at.r + 1.2 });
      else if (
        t.startsWith(FINAL_OBJECTS.whirlPrefix) ||
        t.startsWith(FINAL_OBJECTS.poolPrefix) ||
        t.startsWith(FINAL_OBJECTS.tremorPrefix) ||
        t.startsWith(HEAT_OBJECTS.fistPrefix) ||
        t === HEAT_OBJECTS.wave
      )
        o.danger.push({ ...at, r: at.r + (t.startsWith(FINAL_OBJECTS.whirlPrefix) ? 2 : 1.3) });
      else if (swellLaneOf(t)) {
        const d = { x: Math.sin(at.f), z: Math.cos(at.f) };
        o.lanes.push({
          from: { x: at.x, z: at.z },
          to: add(at, d, HEAT_TUNING.laneLength),
          half: HEAT_TUNING.laneHalf + 1,
        });
      }
    }
    world.o = o;
    const b = world.mobs.boss;
    world.anchor = alive(b) ? b : world.center;
    world.splinters = world.adds.filter((a) => SPLINTERS.has(a.tid));
  },

  onFloor(world, at) {
    const l = L(world, at);
    const r = Math.hypot(l.x - HEART_ROOM.x, l.z - HEART_ROOM.z);
    return r < HEART_QUARTERS.rimR - 4;
  },
  tankSpot(world, st, b, t) {
    // A Splinter is held where it rose (its signature is its quarter's).
    if (t && SPLINTERS.has(t.tid)) return t;
    return dragSpot(world, st);
  },
  // An intermission's Splinters are split between the tanks in turn (the
  // shielded boss needs none): each takes back its own when one turns away.
  tankAssign(world, st, b, me) {
    const s = world.splinters ?? [];
    if (!s.length) return tankAssign(world, st, b, me);
    const tanks = world
      .living()
      .filter((p) => p.tank)
      .sort((x, y) => x.pid - y.pid);
    const mine = s
      .slice()
      .sort((x, y) => x.id - y.id)
      .filter((_, i) => tanks[i % tanks.length]?.pid === b.pid);
    const loose = mine.find((m) => m.aggro !== b.pid);
    b.tankTarget = (loose ?? mine[0])?.id ?? null;
    b.loose = loose
      ? { r: loose.id, m: loose, onTank: !!world.players.get(loose.aggro)?.tank }
      : null;
  },
  meleeReach() {
    return 7;
  },
  // The healers stand between the ring and the boss's quarter (14 yd out on
  // its bearing, a little apart): every tank and the raid round the boss in
  // reach, and only a step when the boss changes quarter.
  roleSpot(world, st, b) {
    if (b.spec.role !== 'healer') return null;
    const boss = world.mobs.boss;
    if (!alive(boss) || hypot(boss, world.center) < 4) return null;
    const u = unit(world.center, boss);
    const side = b.spec.key === 'h1' ? 1 : -1;
    return add(add(world.center, u, 14), { x: -u.z, z: u.x }, side * 4);
  },
  targets(world) {
    const s = world.splinters;
    if (s.length) return s.slice().sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
    const b = world.mobs.boss;
    return b && !hasAura(b, FINAL_PHASE_AURAS.shield) ? b : null;
  },
  kickables(world) {
    return world.splinters
      .filter((m) => m.cast === FINAL_PHASE_CASTS.toll)
      .map((m) => ({ mob: m, cast: m.cast }));
  },

  bad(world, st, at) {
    const o = world.o;
    if (!o) return false;
    if (!final.onFloor(world, at)) return true;
    for (const h of [...o.danger, ...o.ice]) if (hypot(h, at) < h.r) return true;
    for (const ln of o.lanes) if (segDist(at, ln.from, ln.to) < ln.half) return true;
    const b = world.mobs.boss;
    const hid = b ? auraOf(b, FINAL_PHASE_AURAS.hidden) : null;
    if (hid) {
      const next = Math.round(hid.value2 ?? -1);
      const mask = Math.round(hid.value ?? 0) | (next >= 0 && next < 4 ? 1 << next : 0);
      const l = L(world, at);
      if (hiddenFallenAt(mask, l.x, l.z)) return true;
    }
    return false;
  },
  hazards(world, st, b, me) {
    const out = [];
    const o = world.o;
    if (!o) return out;
    for (const h of [...o.danger, ...o.ice]) out.push(h);
    // The Leaping Bolt and Drawn Lightning: spread from the marked.
    const boss = world.mobs.boss;
    if (boss?.cast === FINAL_CASTS.bolt && boss.castTgt !== b.pid) {
      const t = world.players.get(boss.castTgt);
      if (t) out.push({ x: t.x, z: t.z, r: T.boltLeap ?? 7.5 });
    }
    for (const p of world.living()) {
      if (p.pid === b.pid) continue;
      if (hasAura(p, FINAL_AURAS.drawn)) out.push({ x: p.x, z: p.z, r: (T.drawnReach ?? 8) + 1.5 });
      if (hasAura(p, FINAL_PHASE_AURAS.coal)) out.push({ x: p.x, z: p.z, r: 9.5 });
    }
    // A Splinter's Shearing Blow cone: only its target stands in front.
    for (const s of world.splinters) {
      if (s.cast !== FINAL_PHASE_CASTS.shear || s.castTgt === b.pid) continue;
      const f = { x: Math.sin(s.f ?? 0), z: Math.cos(s.f ?? 0) };
      for (const k of [3, 6, 9]) out.push({ ...add(s, f, k), r: k * 0.8 + 1 });
    }
    return out;
  },

  track(world, st) {
    track(world, st);
  },
  duty(world, st, b, me) {
    return duty(world, st, b, me);
  },

  statusLine(world) {
    const b = world.mobs.boss;
    if (!b) return '-';
    const z = zoneCode(b);
    const bars = HEART_QUARTER_ORDER.map(
      (v) => `${v[0]}${Math.round(auraOf(b, overloadAuraId(v))?.value ?? 0)}`,
    ).join(' ');
    return `zone ${z}; bars ${bars}; splinters ${world.splinters.length}`;
  },
  report(world, st, note) {
    init(st);
    note(`Quarter changes: ${st.zones.map((z) => `${fmtSec(z.t)} ${z.zone}`).join(', ')}`);
    note(
      `Overload bursts: ${st.bursts}; stages: ${st.stages.map((s) => `${fmtSec(s.t)} ${s.what}`).join(', ') || '-'}`,
    );
    note(`Anvils: ${st.anvils ?? 0} (under each: ${(st.anvilUnder ?? []).join(', ') || '-'})`);
  },
  row(world, st) {
    init(st);
    return [
      ['Quarters', String(st.zones.length)],
      ['Bursts', String(st.bursts)],
    ];
  },
};

/** The zone on the boss's state aura (a value of 0, the first quarter, rides
 *  the wire as an absent value). */
function zoneCode(b) {
  const a = auraOf(b, FINAL_AURAS.state);
  return a ? finalZoneOf(a.value ?? 0) : 'ring';
}

function init(st) {
  if (st.zones) return;
  Object.assign(st, {
    zones: [],
    bursts: 0,
    stages: [],
    prevZone: null,
    prevBars: {},
    prevStage: null,
    next: null,
  });
}

function zoneOfBoss(world) {
  const b = world.mobs.boss;
  return b ? zoneCode(b) : 'ring';
}
function bar(world, vein) {
  const b = world.mobs.boss;
  return auraOf(b, overloadAuraId(vein))?.value ?? 0;
}

/** Where the boss's tank stands: in the quarter it drinks until its bar is
 *  two thirds full (the root held), then the emptier neighbour quarter. */
function dragSpot(world, st) {
  init(st);
  const b = world.mobs.boss;
  if (!alive(b)) return world.center;
  if (hasAura(b, FINAL_PHASE_AURAS.shield) || final.isFinalPhase(world)) return b;
  const z = zoneOfBoss(world);
  const rooted = hasAura(b, FINAL_AURAS.root);
  let target = st.next ?? (z === 'ring' ? lowest(world, null) : z);
  // Heroic: a change while the raid is still Vein-Shaken hits three times
  // as hard, so the tanks wait the mark out unless the bar runs high.
  const shaken = world.living().some((p) => hasAura(p, FINAL_AURAS.shaken));
  // Heroic's Hammer: the Anvil's soakers stay Crushed 30 s and the next
  // Anvil falls 25 s later, so the boss leaves the Hammer once one has fallen.
  const hammerDone =
    z === 'hammer' && HEROIC_PLUS && (st.anvilFellAt ?? 0) > (st.zoneAt ?? Date.now());
  if (
    IGNORE !== 'drag' &&
    z !== 'ring' &&
    !rooted &&
    (bar(world, z) >= MOVE_AT || hammerDone) &&
    (!shaken || bar(world, z) >= 75) &&
    (!st.next || st.next === z)
  ) {
    const i = HEART_QUARTER_ORDER.indexOf(z);
    const n = HEART_QUARTER_ORDER.length;
    const a = HEART_QUARTER_ORDER[(i + 1) % n];
    const c = HEART_QUARTER_ORDER[(i + n - 1) % n];
    target = bar(world, a) <= bar(world, c) ? a : c;
    st.next = target;
    log(`DRAG: ${z} bar at ${Math.round(bar(world, z))}, on to ${target}`);
  }
  if (st.next && z === st.next) st.next = null;
  const spot = W(world, heartQuarterSpot(target));
  // Never through the ring: a straight line from quarter to quarter can
  // brush it, so the tank walks round by the rim side of the ridge.
  const tank = world.players.get(b.aggro);
  const from = tank ?? b;
  const R = HEART_QUARTERS.ringR + 4;
  if (segDist(world.center, from, spot) < R && hypot(from, world.center) > R) {
    const mid = { x: (from.x + spot.x) / 2, z: (from.z + spot.z) / 2 };
    const out = unit(world.center, mid);
    return add(world.center, out, Math.max(R + 8, hypot(world.center, from)));
  }
  return spot;
}
final.isFinalPhase = (world) => {
  const b = world.mobs.boss;
  return !!b && b.mhp > 0 && b.hp / b.mhp <= 0.15 && !hasAura(b, FINAL_PHASE_AURAS.hidden);
};

function lowest(world, not) {
  return HEART_QUARTER_ORDER.filter((v) => v !== not).sort(
    (x, y) => bar(world, x) - bar(world, y),
  )[0];
}

function track(world, st) {
  init(st);
  // Weight of the Anvil: how many stood under it as it fell (its mark gone).
  const anvil = world.o?.anvils[0] ?? null;
  if (st.anvilSeen && !anvil) {
    const a = st.anvilSeen;
    const under = world.living().filter((p) => hypot(p, a) <= T.anvilR);
    const crushed = under.filter((p) => hasAura(p, FINAL_AURAS.crushed)).length;
    log(`ANVIL fell: ${under.length} under (${crushed} already Crushed)`);
    st.anvils = (st.anvils ?? 0) + 1;
    st.anvilFellAt = Date.now();
    st.anvilUnder = [...(st.anvilUnder ?? []), under.length];
  }
  st.anvilSeen = anvil ? { x: anvil.x, z: anvil.z } : null;
  const z = zoneOfBoss(world);
  if (z !== st.prevZone && world.mobs.boss?.aggro != null) {
    st.zones.push({ t: fightSec(), zone: z });
    st.zoneAt = Date.now();
    log(`QUARTER: the boss drinks ${z}`);
    st.prevZone = z;
  }
  for (const v of HEART_QUARTER_ORDER) {
    const now = bar(world, v);
    if ((st.prevBars[v] ?? 0) > 90 && now < 20) {
      st.bursts++;
      log(`OVERLOAD BURST: ${v}`);
    }
    st.prevBars[v] = now;
  }
  const b = world.mobs.boss;
  const ph = b ? auraOf(b, FINAL_PHASE_AURAS.phase) : null;
  const key = ph ? `${ph.value}` : null;
  if (key !== st.prevStage) {
    if (key) {
      st.stages.push({ t: fightSec(), what: `stage ${key}` });
      log(`PHASE: stage ${key}`);
    }
    st.prevStage = key;
  }
}

function duty(world, st, b, me) {
  init(st);
  const o = world.o;
  const boss = world.mobs.boss;
  // Weight of the Anvil: everyone under it (the Crushed, on Heroic, aside).
  const anvil = o.anvils[0];
  if (anvil && !me.tank && !hasAura(me, FINAL_AURAS.crushed)) {
    const i = world.bots.indexOf(b);
    return {
      goal: add(anvil, { x: Math.sin(i * 1.3), z: Math.cos(i * 1.3) }, Math.min(3, anvil.r - 2)),
      tol: 0.8,
      duty: 'anvil',
    };
  }
  // A Storm Orb each: the nearest free bot steps on it.
  if (o.orbs.length && !me.tank) {
    const taken = new Set();
    for (const orb of o.orbs) {
      const p = world
        .living()
        .filter((q) => q.bot && !q.tank && !taken.has(q.pid))
        .sort((x, y) => hypot(x, orb) - hypot(y, orb))[0];
      if (!p) continue;
      taken.add(p.pid);
      if (p.pid === b.pid) return { goal: orb, tol: 0.6, duty: 'orb' };
    }
  }
  // The Leaping Bolt's target, a Bursting Coal, Drawn Lightning: away.
  if (
    (boss?.cast === FINAL_CASTS.bolt && boss.castTgt === b.pid) ||
    hasAura(me, FINAL_AURAS.drawn) ||
    hasAura(me, FINAL_PHASE_AURAS.coal)
  ) {
    const spot = spread(world, st, me, 10);
    if (spot) return { goal: spot, tol: 1, duty: 'spread' };
  }
  // Ember Mark (Heroic): the marked gather at one far spot.
  if (hasAura(me, FINAL_AURAS.ember)) {
    const far = add(
      world.center,
      unit(world.center, boss ?? world.center),
      HEART_QUARTERS.rimR - 8,
    );
    return { goal: far, tol: 1.5, duty: 'ember' };
  }
  // In the Quench quarter the ranged huddle tight round the boss's back.
  if (zoneOfBoss(world) === 'quench' && !me.tank && b.spec.role !== 'tank' && alive(boss)) {
    const back = add(boss, unit(world.center, boss), 7);
    const i = world.bots.indexOf(b);
    const at = add(back, { x: Math.sin(i), z: Math.cos(i) }, 2.5);
    if (!final.bad(world, st, at)) return { goal: at, tol: 1.5, duty: 'huddle' };
  }
  if (final.bad(world, st, me)) {
    const spot = spread(world, st, me, 0);
    if (spot) return { goal: spot, tol: 0.8, duty: 'dodge' };
  }
  return null;
}

/** The nearest safe spot at least `gap` from every other player. */
function spread(world, st, me, gap) {
  const others = world.living().filter((p) => p.pid !== me.pid);
  for (let r = 0; r <= 24; r += 2) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const at = add(me, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (final.bad(world, st, at)) continue;
      if (gap && others.some((p) => hypot(p, at) < gap)) continue;
      return at;
    }
  }
  return null;
}

export default final;
