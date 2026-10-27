// Pure positioning for the Hammer Council raid bots
// (scripts/heart_council_raid.mjs): where a bot hides from Mountain's Wrath
// (and the Mythic Echo), where a Falling Rock is shared, where a Wake the
// Stone mark is carried, and how a bot walks round a pillar. It reads only
// what the snapshot carries (the pillars' template ids and positions, the
// council's bodies) and mirrors the server's own geometry
// (src/sim/encounters/smith_heart/council_pillars.ts pillarBetween, the
// COUNCIL_TUNING reaches), pinned against it by
// tests/smith_heart_council_bot_tactics.test.ts. No sockets, no clocks, no randomness.

/** The council's reaches the bots plan around (COUNCIL_TUNING, council_ids.ts). */
export const COUNCIL_REACH = {
  columnR: 2.6,
  risenR: 2.2,
  /** Falling Rock: soakers within this of the mark; a pillar within this of
   *  the mark's position (face distance) loses a piece. */
  rock: 6,
  /** A soul pillar loses a pip to a rock landing within this of its face. */
  soulRock: 6,
  /** Resonance cracks the pillar a carrier stands within this of (face). */
  resonance: 3.5,
  /** Heroic: a pillar pulses on whoever stands within this of its face. */
  pulse: 3,
  /** Wake the Stone: a rise keeps this far from another pillar and from a
   *  council body, and throws whoever stands within the knock radius. */
  riseGap: 6.5,
  riseClearOfBodies: 4.5,
  riseKnock: 3,
  /** The Walking Slab crushes within this of its face and grinds within the
   *  second. */
  slabCrush: 1.5,
  slabGrind: 4,
  /** The Wrath and the Echo reach. */
  wrath: 45,
};

const PILLAR = 'sh_council_pillar_';
const RISEN = 'sh_council_risen_';
const SOUL = 'sh_council_soul_';
const ROLES = ['guardian', 'slabwright', 'singer'];

/** A pillar's state from its template id (council_ids.ts councilPillarOf and
 *  councilSoulOf), or null when the id is no pillar. `integrity` is a soul
 *  pillar's pips. */
export function parsePillar(tid) {
  if (typeof tid !== 'string') return null;
  if (tid.startsWith(SOUL)) {
    const [role, kind, n] = tid.slice(SOUL.length).split('_');
    const pips = Number(n);
    if (!ROLES.includes(role) || (kind !== 'c' && kind !== 'r') || !Number.isInteger(pips))
      return null;
    const risen = kind === 'r';
    return {
      integrity: pips,
      risen,
      soul: role,
      r: risen ? COUNCIL_REACH.risenR : COUNCIL_REACH.columnR,
    };
  }
  const risen = tid.startsWith(RISEN);
  if (!risen && !tid.startsWith(PILLAR)) return null;
  const n = Number(tid.slice((risen ? RISEN : PILLAR).length));
  if (!Number.isInteger(n) || n < 1 || n > 3) return null;
  return {
    integrity: n,
    risen,
    soul: null,
    r: risen ? COUNCIL_REACH.risenR : COUNCIL_REACH.columnR,
  };
}

/**
 * The pillar standing between `from` and `to`: of the pillars whose footprint
 * the segment crosses (widened by `pad`), the one nearest `from`; null when
 * none. The server's own rule (council_pillars.ts pillarBetween) at the
 * default pad; a negative pad asks for a margin inside the footprint.
 */
export function pillarBetween(pillars, from, to, pad = 0.35) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return null;
  let best = null;
  let bestT = Number.POSITIVE_INFINITY;
  for (const p of pillars) {
    const px = p.x - from.x;
    const pz = p.z - from.z;
    const t = (px * dx + pz * dz) / len2;
    if (t <= 0 || t >= 1) continue;
    const cx = px - dx * t;
    const cz = pz - dz * t;
    const reach = p.r + pad;
    if (reach <= 0 || cx * cx + cz * cz > reach * reach) continue;
    if (t < bestT) {
      bestT = t;
      best = p;
    }
  }
  return best;
}

/** True when every source has a cover pillar between it and `spot`, with
 *  `margin` yards inside the footprint to spare. */
export function hiddenFrom(cover, sources, spot, margin = 0.5) {
  for (const s of sources) if (!pillarBetween(cover, s, spot, -margin)) return false;
  return true;
}

/** Distance from a point to a pillar's face (negative inside it). */
export function faceDistance(p, at) {
  return Math.hypot(at.x - p.x, at.z - p.z) - p.r;
}

/** Inside the Quarry's floor ellipse (instance-local yards round `center`),
 *  shrunk by `margin`. */
export function onFloor(at, floor, margin = 0) {
  const rx = floor.rx - margin;
  const rz = floor.rz - margin;
  if (rx <= 0 || rz <= 0) return false;
  const dx = (at.x - floor.x) / rx;
  const dz = (at.z - floor.z) / rz;
  return dx * dx + dz * dz <= 1;
}

/**
 * The spots behind `pillar` hidden from every source by the cover set, at
 * face distances from `minFace` to `minFace + depth`, nearest-to-the-line
 * first. Each spot carries the pillar it hides behind.
 */
export function coverSpots(pillar, cover, sources, minFace, depth = 2.5) {
  const out = [];
  if (sources.length === 0) return out;
  // The shadow's axis: away from the sources' mean.
  let sx = 0;
  let sz = 0;
  for (const s of sources) {
    sx += s.x;
    sz += s.z;
  }
  sx /= sources.length;
  sz /= sources.length;
  const base = Math.atan2(pillar.x - sx, pillar.z - sz);
  for (let ring = 0; ring <= 2; ring++) {
    const d = pillar.r + minFace + (depth * ring) / 2;
    for (const off of [
      0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1, 1.5, -1.5, 2, -2, 2.6, -2.6,
    ]) {
      const a = base + off;
      const spot = { x: pillar.x + Math.sin(a) * d, z: pillar.z + Math.cos(a) * d, pillar };
      if (hiddenFrom(cover, sources, spot)) out.push(spot);
    }
  }
  return out;
}

/** A waypoint that walks round the first pillar in the way (radius plus
 *  `clear`), or the goal itself when the line is free. */
export function steer(from, goal, circles, clear = 0.9) {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return goal;
  let hit = null;
  let hitT = Number.POSITIVE_INFINITY;
  for (const c of circles) {
    const R = c.r + clear;
    if (Math.hypot(from.x - c.x, from.z - c.z) < R) continue; // already brushing it
    if (Math.hypot(goal.x - c.x, goal.z - c.z) < R) continue; // the goal is at its face
    const px = c.x - from.x;
    const pz = c.z - from.z;
    const t = (px * dx + pz * dz) / len2;
    if (t <= 0 || t >= 1) continue;
    const ox = px - dx * t;
    const oz = pz - dz * t;
    if (ox * ox + oz * oz >= R * R) continue;
    if (t < hitT) {
      hitT = t;
      hit = { c, ox, oz, R };
    }
  }
  if (!hit) return goal;
  // Pass on the side the line already leans to (away from the centre).
  const len = Math.sqrt(len2);
  let nx = -dz / len;
  let nz = dx / len;
  if (nx * -hit.ox + nz * -hit.oz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { x: hit.c.x + nx * (hit.R + 0.6), z: hit.c.z + nz * (hit.R + 0.6) };
}

/**
 * Where to share a Falling Rock: a spot near `from` with every cover pillar's
 * face more than the rock's reach (plus `margin`) away, off the hazards, on
 * the floor; with `soul` (Mythic) inside the soul pillar's pip reach instead
 * (and outside the Walking Slab's grind when it is the slab). Null when no
 * spot within `range` qualifies.
 */
export function rockSpot({
  from,
  cover,
  soul = null,
  hazards = [],
  floor,
  home,
  homeWeight = 0.25,
  range = 24,
  margin = 1.2,
}) {
  let best = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= range; r += 2) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / 2.5));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const at = { x: from.x + Math.sin(a) * r, z: from.z + Math.cos(a) * r };
      if (!onFloor(at, floor, 4)) continue;
      if (cover.some((p) => faceDistance(p, at) <= COUNCIL_REACH.rock + margin)) continue;
      if (hazards.some((h) => Math.hypot(at.x - h.x, at.z - h.z) < h.r)) continue;
      if (soul) {
        const f = faceDistance(soul, at);
        const inner = soul.soul === 'slabwright' ? COUNCIL_REACH.slabGrind + 0.6 : 1.2;
        if (f > COUNCIL_REACH.soulRock - margin || f < inner) continue;
      }
      const cost = r + (home ? homeWeight * Math.hypot(at.x - home.x, at.z - home.z) : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = at;
      }
    }
    if (best && r > 8) break;
  }
  return best;
}

/** May a pillar rise at `at` (council_pillars.ts riseSpotClear, with a
 *  margin): on the floor, clear of every pillar and every council body. */
export function riseClear(at, pillars, bodies, floor, margin = 0.6) {
  if (!onFloor(at, floor, 4)) return false;
  for (const p of pillars)
    if (Math.hypot(p.x - at.x, p.z - at.z) < COUNCIL_REACH.riseGap + margin) return false;
  for (const b of bodies)
    if (Math.hypot(b.x - at.x, b.z - at.z) < COUNCIL_REACH.riseClearOfBodies + margin) return false;
  return true;
}

/**
 * Where a Wake the Stone mark should stand: on the line from the Wrath's
 * holder toward the raid, `near` to `far` yards out from it (so the new
 * pillar is cover the raid can step behind), shifted sideways by `lane`
 * yards for a second mark, clear for a rise, and away from `others` (the
 * rest of the raid, not to be thrown). Null when no spot qualifies.
 */
export function wakeSpot({
  holder,
  raid,
  pillars,
  bodies,
  floor,
  others = [],
  lane = 0,
  near = 9,
  far = 16,
}) {
  const ax = raid.x - holder.x;
  const az = raid.z - holder.z;
  const len = Math.hypot(ax, az) || 1;
  const ux = ax / len;
  const uz = az / len;
  const vx = -uz;
  const vz = ux;
  for (let d = near; d <= far; d += 1) {
    for (const side of [0, 2.5, -2.5, 5, -5]) {
      const at = {
        x: holder.x + ux * d + vx * (lane + side),
        z: holder.z + uz * d + vz * (lane + side),
      };
      if (!riseClear(at, pillars, bodies, floor)) continue;
      if (others.some((o) => Math.hypot(o.x - at.x, o.z - at.z) < COUNCIL_REACH.riseKnock + 1))
        continue;
      return at;
    }
  }
  return null;
}
