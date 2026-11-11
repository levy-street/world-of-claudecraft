// The Guardian of the Quench's mechanic AI for the raid bots (scripts/heart_raid.mjs
// BOSS=quench; the plumbing is scripts/lib/heart_raid_bots.mjs). The raid keeps
// its cold down in three huddles (the tank's by the guardian, two ranged ones
// behind it) that shift a stride every few seconds so the ice never gives
// under them, keeps clear of the holes and the cracks, of a frozen player's
// splash and of the guardian's breath cone, and each slash's marked player
// steps out to aim the line clear of the raid, then off it; everyone steps out
// of a drawn line (and of The Blades Hunt's on Mythic). Living Rime's carrier
// steps out of the group (clear of everyone by its burst's reach, still in the
// healers' reach) and everyone else keeps out of its ring; the healers break
// the crust first (scripts/lib/heart_raid_kits.mjs `crusted`). Reads only what
// the server sends; the geometry is the sim's own pure module (claim-local).
//
// IGNORE=rime    Living Rime's carrier stays where it is (the burst's check)
// RIME=off       the run without Living Rime (the A/B on the same build)
// RIME_PLAY=late the carrier stays warm in its huddle and steps out only for
//                the crust's last RIME_LATE_AT seconds (a comparison run; the
//                default steps out at once)
//
// IGNORE=huddle  nobody huddles (the key mechanic: the cold)

import {
  insideRimewall,
  QUENCH_BLADE_HOMES,
  QUENCH_LAKE_MIDDLE,
} from '../../src/sim/encounters/smith_heart/quench_geometry';
import {
  crackOf,
  laneOf,
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_DIFFICULTY,
  QUENCH_OBJECTS,
  QUENCH_TUNING,
} from '../../src/sim/encounters/smith_heart/quench_ids';
import {
  add,
  alive,
  auraOf,
  DIFF,
  fightSec,
  fmtSec,
  hasAura,
  hypot,
  IGNORE,
  log,
  perp,
  segDist,
  unit,
} from './heart_raid_bots.mjs';

const RULES = QUENCH_DIFFICULTY[DIFF];
const RIME_LATE = process.env.RIME_PLAY === 'late';
const RIME_LATE_AT = 4;
/** Is `p`'s crust one its carrier should be out of the group for now? */
const rimeOut = (p) => {
  const a = auraOf(p, QUENCH_AURAS.rime);
  if (!a) return false;
  return !RIME_LATE || (a.rem ?? 0) <= RIME_LATE_AT;
};
const T = QUENCH_TUNING;
const LINE_HALF = 1.8 + 1.0;
/** The huddles: who stands with whom (the tank's group by the guardian).
 *  The ranged and the healers make one huddle of six: a huddle of three
 *  goes cold for all three the moment one steps out for a slash or a
 *  splash, one of six still warms everyone left. */
const GROUPS = [
  ['mt', 'ot', 'rogue', 'arms'],
  ['mage', 'hunter', 'lock', 'h1', 'h2', 'ele'],
];
/** How long a huddle holds one spot before it shifts (the ice strains 8 s). */
const SHIFT_EVERY = 7000;

const L = (world, p) => ({ x: p.x - world.origin.x, z: p.z - world.origin.z });
const W = (world, p) => ({ x: p.x + world.origin.x, z: p.z + world.origin.z });

export const quench = {
  key: 'quench',
  title: 'Guardian of the Quench',
  tids: { guardian: 'heart_quench_guardian' },
  tp: '/dev heart tp lake',
  resetGrace: 8000,
  // Living Warmth: healing a wounded player lowers their cold, so a healer
  // heals the coldest wounded first (a full-health one gains nothing).
  healUrgency(world, p) {
    if (p.hp >= p.mhp * 0.97) return 0;
    const cold = auraOf(p, QUENCH_AURAS.cold)?.value ?? 0;
    return cold > 50 ? Math.min(0.3, (cold - 50) / 150) : 0;
  },
  // The huddle IS the healer's spot: it moves with the huddle (the ice
  // strains under a group that stands still).
  healerSticky: false,
  setup(diff) {
    const out = [
      '/dev heart kill hammer',
      '/dev heart kill trash',
      '/dev heart gates',
      '/dev heart quench reset',
    ];
    if (diff === 'mythic') out.push('/dev heart quench mythic on');
    else if (diff === 'heroic') out.push('/dev heart quench heroic on');
    else out.push('/dev heart quench heroic off', '/dev heart quench mythic off');
    // RIME=off: a comparison run without Living Rime (same build, same raid).
    out.push(`/dev heart quench rime ${process.env.RIME === 'off' ? 'off' : 'on'}`);
    return out;
  },

  locate(world) {
    const blades = [...world.obs.ents.values()].filter(
      (e) =>
        e.k === 'object' &&
        typeof e.tid === 'string' &&
        e.tid.startsWith(QUENCH_OBJECTS.bladePrefix),
    );
    if (blades.length < 4) return false;
    const mid = (ps) => ({
      x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
      z: ps.reduce((s, p) => s + p.z, 0) / ps.length,
    });
    const w = mid(blades);
    const l = mid(QUENCH_BLADE_HOMES);
    world.origin = { x: w.x - l.x, z: w.z - l.z };
    world.center = W(world, QUENCH_LAKE_MIDDLE);
    world.home = unit(world.center, world.obs.self);
    world.tankSpot = add(world.center, world.home, -2);
    world.anchor = add(world.center, world.home, 4);
    world.prepull = add(world.center, world.home, 22);
    world.reach = 50;
    return true;
  },

  read(world) {
    const o = { holes: [], cracks: [], lanes: [], blades: [] };
    for (const e of world.obs.ents.values()) {
      if (e.k !== 'object' || typeof e.tid !== 'string') continue;
      const t = e.tid;
      if (t === QUENCH_OBJECTS.hole)
        o.holes.push({ x: e.x, z: e.z, r: Math.max(e.sc ?? 0, T.holeR) + 1.2 });
      else if (crackOf(t) !== null)
        o.cracks.push({ x: e.x, z: e.z, r: Math.max(e.sc ?? 0, T.holeR) + 1.5 });
      else if (laneOf(t)) {
        const ln = laneOf(t);
        const f = e.f ?? 0;
        const d = { x: Math.sin(f), z: Math.cos(f) };
        o.lanes.push({
          from: { x: e.x, z: e.z },
          to: add(e, d, ln.length),
          state: ln.state,
          secs: ln.seconds,
          id: e.id,
        });
      } else if (t.startsWith(QUENCH_OBJECTS.bladePrefix))
        o.blades.push({ x: e.x, z: e.z, id: e.id });
    }
    world.o = o;
  },

  // A bot walks round the holes and the groaning cracks, never through.
  obstacles(world) {
    const o = world.o;
    return o ? [...o.holes, ...o.cracks].map((h) => ({ x: h.x, z: h.z, r: h.r })) : [];
  },
  onFloor(world, at) {
    const l = L(world, at);
    return insideRimewall(l.x, l.z, 3);
  },
  tankSpot(world, st) {
    return huddleSpot(world, st, 0);
  },
  stillFor(world, st, b) {
    const me = world.players.get(b.pid);
    if (me && hasAura(me, QUENCH_AURAS.marked)) return 0;
    return 99;
  },

  bad(world, st, at) {
    const o = world.o;
    if (!o) return false;
    if (o.holes.some((h) => hypot(h, at) < h.r) || o.cracks.some((h) => hypot(h, at) < h.r))
      return true;
    if (o.lanes.some((ln) => segDist(at, ln.from, ln.to) < LINE_HALF)) return true;
    return false;
  },
  hazards(world, st, b, me) {
    const out = [];
    const o = world.o;
    if (!o) return out;
    for (const h of [...o.holes, ...o.cracks]) out.push(h);
    // A frozen player's splash.
    for (const p of world.living())
      if (p.pid !== b.pid && hasAura(p, QUENCH_AURAS.frozen))
        out.push({ x: p.x, z: p.z, r: RULES.splashR + 1 });
    // Living Rime's carriers: keep out of their burst's ring (a carrier
    // itself keeps out of the other carriers').
    for (const p of world.living())
      if (p.pid !== b.pid && rimeOut(p)) out.push({ x: p.x, z: p.z, r: T.rimeBurstR + 1.5 });
    // The breath cone: non-tanks keep out of the guardian's front.
    const g = world.mobs.guardian;
    if (alive(g) && !me.tank) {
      const f = { x: Math.sin(g.f ?? 0), z: Math.cos(g.f ?? 0) };
      for (const k of [5, 10, 15, 20]) out.push({ ...add(g, f, k), r: k * 0.55 + 1 });
    }
    return out;
  },

  track(world, st) {
    track(world, st);
  },
  duty(world, st, b, me) {
    return duty(world, st, b, me);
  },
  // Every bot's resting spot is its huddle's.
  roleSpot(world, st, b, me) {
    if (me && rimeOut(me) && IGNORE !== 'rime') return null;
    if (IGNORE === 'huddle') return null;
    const gi = groupOf(b);
    if (gi < 0 || b.spec.key === 'mt') return null;
    if (gi === 0) {
      // The tank's huddle: the others close at the main tank's sides and back.
      const mt = world.bots.find((x) => x.spec.key === 'mt');
      const g = world.mobs.guardian;
      const t = mt?.self && !mt.self.dead ? mt.self : null;
      if (!t || !alive(g)) return null;
      // Beside the guardian on ONE side, 41 to 57 degrees off the tank's
      // line (out of the breath's 70 degree cone), at the tank's own distance
      // from her or a stride nearer (her body radius settles the tank at her
      // gown, 3.5 yards out, the floor here): the main tank keeps two of them within the
      // warmth's 6 yd and each of them two others (on both sides, the main
      // tank's neighbours stood 6 to 7 yd off and he froze).
      const r = Math.max(4, hypot(g, t));
      const f = Math.atan2(t.x - g.x, t.z - g.z);
      const off = { ot: 0.72, rogue: 0.86, arms: 1.0 }[b.spec.key] ?? 0.86;
      return add(g, { x: Math.sin(f + off), z: Math.cos(f + off) }, Math.max(3.5, r - 2));
    }
    const c = huddleSpot(world, st, gi);
    const i = GROUPS[gi].indexOf(b.spec.key);
    const a = (i / GROUPS[gi].length) * Math.PI * 2;
    return add(c, { x: Math.sin(a), z: Math.cos(a) }, 2.2);
  },

  statusLine(world) {
    const colds = world
      .living()
      .map((p) => Math.round(auraOf(p, QUENCH_AURAS.cold)?.value ?? 0))
      .join(' ');
    return `cold ${colds}; holes ${world.o?.holes.length ?? 0}`;
  },
  report(world, st, note) {
    init(st);
    note(
      `Freezes (Encased in Rime): ${st.freezes.length} (${st.freezes.map((f) => `${fmtSec(f.t)} ${f.who}`).join(', ') || 'none'})`,
    );
    note(
      `Under the Ice: ${st.plunges}; slash marks ${st.marks}; holes at the end ${world.o?.holes.length ?? 0}; peak cold ${Math.round(st.peakCold)}`,
    );
    note(
      `Living Rime: ${st.rimes} set, ${st.rimeBreaks} healed through, ${st.rimeFails} burst (${st.rimeFailLog.map((f) => `${fmtSec(f.t)} ${f.who}`).join(', ') || 'none'})`,
    );
  },
  row(world, st) {
    init(st);
    return [
      ['Freezes', String(st.freezes.length)],
      ['Under the Ice', String(st.plunges)],
      ['Living Rime (set / healed / burst)', `${st.rimes} / ${st.rimeBreaks} / ${st.rimeFails}`],
    ];
  },
};

function init(st) {
  if (st.freezes) return;
  Object.assign(st, {
    freezes: [],
    plunges: 0,
    marks: 0,
    peakCold: 0,
    prevAuras: new Map(),
    prevCast: null,
    huddle: [],
    aim: new Map(),
    rimes: 0,
    rimeBreaks: 0,
    rimeFails: 0,
    rimeFailLog: [],
    rimeSpot: new Map(),
  });
}

function groupOf(b) {
  return GROUPS.findIndex((g) => g.includes(b.spec.key));
}

/** A huddle's spot now: the group's base (the tank's under the guardian, the
 *  others behind it on either side) shifted a stride every few seconds to a
 *  spot clear of holes and cracks. */
function huddleSpot(world, st, gi) {
  init(st);
  const now = Date.now();
  const h = st.huddle[gi];
  const ok = (at) =>
    quench.onFloor(world, at) &&
    !world.o.holes.some((q) => hypot(q, at) < q.r + 2.5) &&
    !world.o.cracks.some((q) => hypot(q, at) < q.r + 2);
  if (h && now - h.since < SHIFT_EVERY && ok(h.at)) return h.at;
  const g = world.mobs.guardian;
  const pivot = alive(g) && gi > 0 ? g : world.center;
  const side = 0;
  const base =
    gi === 0 ? world.tankSpot : add(add(pivot, world.home, 13), perp(world.home), side * 8);
  // Each shift jumps across the base (the strain's middle must leave 4 yd).
  const k = (h?.k ?? -3) + 3;
  for (let j = 0; j < 12; j++) {
    const a = ((k + j) % 6) * (Math.PI / 3);
    const at = add(base, { x: Math.sin(a), z: Math.cos(a) }, gi === 0 ? 4.5 : 5);
    if (ok(at) && (!h || hypot(at, h.at) > 6)) {
      st.huddle[gi] = { at, since: now, k: k + j };
      return at;
    }
  }
  // The ice round the base is spent: the nearest sound ice farther out.
  for (const r of [8, 11, 14, 17]) {
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2;
      const at = add(base, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (ok(at) && (!h || hypot(at, h.at) > 6)) {
        st.huddle[gi] = { at, since: now, k };
        return at;
      }
    }
  }
  st.huddle[gi] = { at: h?.at ?? base, since: now, k };
  return st.huddle[gi].at;
}

function track(world, st) {
  init(st);
  for (const p of world.players.values()) {
    const prev = st.prevAuras.get(p.pid) ?? new Set();
    const cur = new Set((p.auras ?? []).map((a) => a.id));
    if (cur.has(QUENCH_AURAS.frozen) && !prev.has(QUENCH_AURAS.frozen)) {
      st.freezes.push({ t: fightSec(), who: p.name });
      log(`FROZEN: ${p.name} is Encased in Rime`);
    }
    if (cur.has(QUENCH_AURAS.trapped) && !prev.has(QUENCH_AURAS.trapped)) {
      st.plunges++;
      log(`UNDER THE ICE: ${p.name}`);
    }
    if (cur.has(QUENCH_AURAS.marked) && !prev.has(QUENCH_AURAS.marked)) {
      st.marks++;
      log(`SLASH MARK on ${p.name}`);
    }
    if (cur.has(QUENCH_AURAS.rime) && !prev.has(QUENCH_AURAS.rime)) {
      st.rimes++;
      log(`LIVING RIME on ${p.name}`);
    } else if (!cur.has(QUENCH_AURAS.rime) && prev.has(QUENCH_AURAS.rime)) {
      // Gone: frozen with it is a burst; alive and free, healed through.
      if (cur.has(QUENCH_AURAS.frozen)) {
        st.rimeFails++;
        st.rimeFailLog.push({ t: fightSec(), who: p.name });
        // Why it was not healed: each healer's distance and state then.
        const hs = [...world.players.values()]
          .filter((q) => q.bot?.spec.role === 'healer')
          .map((q) => {
            const why = q.dead
              ? 'dead'
              : hasAura(q, QUENCH_AURAS.frozen)
                ? 'frozen'
                : hasAura(q, QUENCH_AURAS.trapped)
                  ? 'in the water'
                  : 'free';
            return `${q.name} ${Math.round(hypot(q, p))} yd ${why}`;
          })
          .join(', ');
        log(`LIVING RIME BURST on ${p.name} (healers: ${hs})`);
      } else if (!p.dead) {
        st.rimeBreaks++;
        log(`LIVING RIME healed through on ${p.name}`);
      }
      st.rimeSpot.delete(p.pid);
    }
    st.prevAuras.set(p.pid, cur);
    st.peakCold = Math.max(st.peakCold, auraOf(p, QUENCH_AURAS.cold)?.value ?? 0);
  }
  const g = world.mobs.guardian;
  const cur = g?.cast ?? null;
  if (cur !== st.prevCast) {
    if (cur === QUENCH_CASTS.wake) log('THE BLADES WAKE');
    else if (cur === QUENCH_CASTS.flurry) log('THE BLADES HUNT');
    st.prevCast = cur;
  }
}

function duty(world, st, b, me) {
  init(st);
  if (hasAura(me, QUENCH_AURAS.trapped) || hasAura(me, QUENCH_AURAS.frozen))
    return { goal: me, hold: true, duty: 'held' };
  const o = world.o;
  // Living Rime: out of the group (its burst's reach), within the healers'.
  if (rimeOut(me) && IGNORE !== 'rime') {
    const spot = rimeSpot(world, st, b, me);
    if (spot) return { goal: spot, tol: 1, duty: 'rime: out of the group' };
  }
  // On a groaning crack (or by a hole): off it at once, away from its middle.
  const under = [...o.cracks, ...o.holes].find((h) => hypot(h, me) < h.r);
  if (under)
    return { goal: add(under, unit(under, me), under.r + 1.5), tol: 0.6, duty: 'off the crack' };
  // A slash mark: aim the line clear of the raid, then off it once it locks.
  if (hasAura(me, QUENCH_AURAS.marked)) {
    const lane = o.lanes
      .filter((ln) => ln.state === 'warn')
      .sort((x, y) => segDist(me, x.from, x.to) - segDist(me, y.from, y.to))[0];
    const blade = lane?.from;
    // Locked (its last second): off the line like everyone else.
    if (blade && lane.secs > 1.0) {
      const spot = aimSpot(world, st, b, me, blade);
      return { goal: spot, tol: 0.8, duty: 'aim the slash' };
    }
  }
  st.aim.delete(b.pid);
  // Out of any line drawn on the ice.
  for (const ln of o.lanes) {
    const d = segDist(me, ln.from, ln.to);
    if (d < LINE_HALF + 0.4) {
      const dir = unit(ln.from, ln.to);
      const side = perp(dir);
      const along = (me.x - ln.from.x) * dir.x + (me.z - ln.from.z) * dir.z;
      const foot = add(ln.from, dir, along);
      const s = (me.x - foot.x) * side.x + (me.z - foot.z) * side.z >= 0 ? 1 : -1;
      return { goal: add(foot, side, s * (LINE_HALF + 1.5)), tol: 0.5, duty: 'off the line' };
    }
  }
  if (IGNORE === 'huddle') return null;
  // Cold rising and nobody near: back to the huddle at once.
  const cold = auraOf(me, QUENCH_AURAS.cold)?.value ?? 0;
  if (cold > 55 && groupOf(b) >= 0) {
    const gi = groupOf(b);
    const c =
      gi === 0
        ? alive(world.mobs.guardian)
          ? world.mobs.guardian
          : world.tankSpot
        : huddleSpot(world, st, gi);
    if (hypot(me, c) > 4) return { goal: c, tol: 2.5, duty: 'warm up' };
  }
  return null;
}

/** Where Living Rime's carrier waits: clear of everyone by the burst's reach
 *  and a stride, within both healers' reach, on sound ice, the nearest such
 *  spot (re-chosen once someone walks into it). */
function rimeSpot(world, st, b, me) {
  const clear = T.rimeBurstR + 2;
  const others = world.living().filter((p) => p.pid !== b.pid);
  const healers = others.filter((p) => p.bot?.spec.role === 'healer');
  const ok = (at) =>
    quench.onFloor(world, at) &&
    !quench.bad(world, st, at) &&
    !world.o.holes.some((h) => hypot(h, at) < h.r + 1) &&
    others.every((p) => hypot(p, at) >= clear) &&
    healers.every((h) => hypot(h, at) <= 24);
  const kept = st.rimeSpot.get(b.pid);
  if (kept && ok(kept)) return kept;
  let best = null;
  for (let r = 0; r <= 20; r += 2) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const at = add(me, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (!ok(at)) continue;
      best = at;
      break;
    }
    if (best) break;
  }
  // Nothing clear in reach: the spot farthest from the nearest other body.
  if (!best) {
    let bestD = -1;
    for (let r = 4; r <= 16; r += 4)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const at = add(me, { x: Math.sin(a), z: Math.cos(a) }, r);
        if (!quench.onFloor(world, at) || quench.bad(world, st, at)) continue;
        const d = Math.min(...others.map((p) => hypot(p, at)));
        if (d > bestD) {
          bestD = d;
          best = at;
        }
      }
  }
  if (best) st.rimeSpot.set(b.pid, best);
  return best;
}

/** Where the marked stands so the line from the blade through them misses
 *  everyone else: the nearest such spot within a short walk. Kept per mark. */
function aimSpot(world, st, b, me, blade) {
  const kept = st.aim.get(b.pid);
  if (kept && hypot(kept.blade, blade) < 0.5) return kept.at;
  const others = world.living().filter((p) => p.pid !== b.pid);
  let best = null;
  for (let r = 0; r <= 12; r += 2) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const at = add(me, { x: Math.sin(a), z: Math.cos(a) }, r);
      if (!quench.onFloor(world, at) || quench.bad(world, st, at)) continue;
      const dir = unit(blade, at);
      const end = add(blade, dir, 90);
      const hit = others.filter((p) => segDist(p, blade, end) < LINE_HALF + 1).length;
      const cost = hit * 20 + r;
      if (!best || cost < best.cost) best = { at, cost };
    }
    if (best && best.cost < 20) break;
  }
  const at = best?.at ?? me;
  st.aim.set(b.pid, { blade: { x: blade.x, z: blade.z }, at });
  return at;
}

export default quench;
