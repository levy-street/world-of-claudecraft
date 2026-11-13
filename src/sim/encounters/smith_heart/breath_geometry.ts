// The Storm Cornice's geometry for the Guardian of the Breath (design doc
// section 7.2), pure over the layout and the authored field: who stands in
// the fight, where the wind pins a body to the rim's wall, where the gaps
// open, where Captain Thessaly's circle lands, the loose gales' paths and the
// strikes' spots. Instance-local yards throughout. No SimContext, no rng (the
// picks are hashed), so the raid bots' tactics (scripts/lib) can reuse it.

import {
  BREATH,
  CORNICE_GAPS,
  CORNICE_OPEN_RIM,
  SMITH_HEART_FIELD,
} from '../../content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../instances/authored_field';
import { BREATH_TUNING as T } from './breath_ids';

const F = SMITH_HEART_FIELD;
const C = BREATH.cornice;

/** The Cornice's floor id, and its climb's (whose top lies inside the
 *  fight: the gate seals it a little west, `cornice_mouth`). */
const CORNICE_FLOOR = 'storm_cornice';
const CORNICE_CLIMB = 'cornice_climb';
/** The climb counts as the arena east of this (inside the Cornice Mouth). */
const CLIMB_ARENA_X = -66;

/** Captain Thessaly's post: at the head of the climb, inside the gate, just
 *  off the Cornice's floor (the wind never reaches an NPC). */
export const THESSALY_POST = { x: -56, z: 194.4 } as const;

/** Is instance-local (x, z) on the Cornice's fighting floor (its plateau, or
 *  the climb's top inside the gate)? */
export function inBreathArena(x: number, z: number): boolean {
  const s = authoredFieldSurfaceAt(F, x, z);
  if (!s) return false;
  if (s.id === CORNICE_FLOOR) return true;
  return s.id === CORNICE_CLIMB && x > CLIMB_ARENA_X;
}

/** Is (x, z) on the way up to the fight (the Cornice's floor, or anywhere on
 *  its climb): where a target the guardian may keep stands. */
export function onCorniceApproach(x: number, z: number): boolean {
  if (inBreathArena(x, z)) return true;
  return authoredFieldSurfaceAt(F, x, z)?.id === CORNICE_CLIMB;
}

/** Half a claim's slot band in z (slots are 500 yd apart): a local z past
 *  it is the next claim's ground, never this one's. */
export const CLAIM_HALF_Z = 250;

/** Is local z inside this claim's own band (not the next slot's south end,
 *  which lies within the Cornice's reach)? */
export function inClaimBand(z: number): boolean {
  return Math.abs(z) < CLAIM_HALF_Z;
}

/** Where a body that fell from (x, z) is laid back on the Cornice: the first
 *  spot of its floor clear of every gap, walking in from (x, z) toward the
 *  Cornice's middle (so a corpse is never left in the void, where a
 *  resurrection would drop it straight back into it). */
export function voidCorpseSpot(x: number, z: number, inset = 3): { x: number; z: number } {
  const dx = C.x - x;
  const dz = C.z - z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: C.x, z: C.z };
  for (let t = 0; t <= d; t += 1) {
    const px = x + (dx / d) * t;
    const pz = z + (dz / d) * t;
    // A little in from the open lip, so a body raised there stands on rock.
    if (inBreathArena(px, pz) && !gapAt(px, pz) && lipDistance(px, pz) >= inset)
      return { x: px, z: pz };
  }
  return { x: C.x, z: C.z };
}

/** Is (x, z) near the Cornice at all (its floor, its gaps, the void past
 *  its rim as far as a fall's momentum carries a body): where a body that
 *  fell is the fight's to count. */
export function nearCornice(x: number, z: number): boolean {
  return Math.hypot((x - C.x) / (C.rx + 30), (z - C.z) / (C.rz + 30)) <= 1;
}

/** Is (x, z) inside one of the field's breaks in the wall (the open rim, a
 *  channel's throat): a lip a body falls off? */
export function openLipAt(x: number, z: number): boolean {
  for (const o of F.lipOpenings ?? [])
    if ((x - o.x) ** 2 + (z - o.z) ** 2 <= o.r * o.r) return true;
  return false;
}

/** About how far (x, z) lies in from the Cornice's nearest open lip (yards;
 *  0 at it): the rim's openings stand on its edge (CORNICE_OPEN_RIM, a disc
 *  every 5 degrees), the channels' throats inside their notches. Within a
 *  couple of yards: cheap enough for every tick. */
export function lipDistance(x: number, z: number): number {
  let d = Number.POSITIVE_INFINITY;
  for (const o of CORNICE_OPEN_RIM) d = Math.min(d, Math.hypot(x - o.x, z - o.z) - 1);
  for (const g of CORNICE_GAPS) d = Math.min(d, Math.hypot(x - g.x, z - g.z) - g.r);
  return Math.max(0, d);
}

/** The gap whose throat (x, z) lies in, or null. */
export function gapAt(x: number, z: number): (typeof CORNICE_GAPS)[number] | null {
  for (const g of CORNICE_GAPS) if (Math.hypot(x - g.x, z - g.z) <= g.r) return g;
  return null;
}

/** Is a body at (x, z), the wind blowing toward `heading` (radians), pressed
 *  against the rim's wall? The floor ends within `pinReach` downwind of it,
 *  and that lip is walled (no gap there: a gap is a fall, not a pin). */
export function pinnedAgainstRim(x: number, z: number, heading: number): boolean {
  if (!inBreathArena(x, z)) return false;
  const px = x + Math.sin(heading) * T.pinReach;
  const pz = z + Math.cos(heading) * T.pinReach;
  if (authoredFieldSurfaceAt(F, px, pz)) return false;
  // Since the open rim (2026-11-03) only the climb's head keeps a wall.
  return !openLipAt(px, pz) && !openLipAt(x, z);
}

/** Has a body at (x, z, local height y) gone over the Cornice's lip and come
 *  to rest in the void (a fall lands on the void's floor; a throw over a gap
 *  can seat a body there outright)? Either way it is dead. The void's floor
 *  lies under every walk of the raid, so a body down there is the void's
 *  wherever it walked to once it landed. */
export function fellFromCornice(x: number, z: number, y: number, onGround: boolean): boolean {
  if (y < F.voidHeight + 3) return true;
  // Landed short of the void, but far below the Cornice: only in this
  // claim's own band (the next slot's floors lie within this reach).
  return inClaimBand(z) && nearCornice(x, z) && onGround && y < C.h - T.voidDepth;
}

/** Where Thessaly's circle lands: on the guardian's upwind side (the wind
 *  blowing toward `bearingDeg`), at one of a few hashed reaches and sideways
 *  offsets, so the raid cannot learn one spot (Jose's playtest: it always fell
 *  in the same place). The whole circle stands on the Cornice's floor clear of
 *  every gap, and `T.circleApart` from `last` (the circle before it) when the
 *  floor allows; failing every candidate it is drawn in toward the guardian. */
export function calmCircleSpot(
  guardian: { x: number; z: number },
  bearingDeg: number,
  salt = 0,
  last: { x: number; z: number } | null = null,
): { x: number; z: number } {
  const up = ((bearingDeg + 180) * Math.PI) / 180;
  const ux = Math.sin(up);
  const uz = Math.cos(up);
  const reaches = T.circleReaches;
  const sides = T.circleSides;
  const n = reaches.length * sides.length;
  const start = breathHash(salt, 17) % n;
  let fallback: { x: number; z: number } | null = null;
  // Upwind first; a floor too cramped there for a new spot tries crosswind.
  for (const turn of [0, Math.PI / 2, -Math.PI / 2]) {
    const dx = ux * Math.cos(turn) + uz * Math.sin(turn);
    const dz = uz * Math.cos(turn) - ux * Math.sin(turn);
    for (let i = 0; i < n; i++) {
      const k = (start + i) % n;
      const d = reaches[k % reaches.length];
      const side = sides[Math.floor(k / reaches.length)];
      // Sideways is the reach's direction turned a quarter.
      const x = guardian.x + dx * d + dz * side;
      const z = guardian.z + dz * d - dx * side;
      if (!circleClear(x, z, T.circleR)) continue;
      if (last === null || Math.hypot(x - last.x, z - last.z) >= T.circleApart) return { x, z };
      fallback = fallback ?? { x, z };
    }
  }
  if (fallback) return fallback;
  for (let d = T.circleReach; d >= 0; d -= 1) {
    const x = guardian.x + ux * d;
    const z = guardian.z + uz * d;
    if (circleClear(x, z, T.circleR)) return { x, z };
  }
  return { x: guardian.x, z: guardian.z };
}

/** Does a disc of radius `r` at (x, z) stand wholly on the Cornice's floor,
 *  clear of the gaps? */
export function circleClear(x: number, z: number, r: number): boolean {
  if (!inBreathArena(x, z)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const px = x + Math.sin(a) * r;
    const pz = z + Math.cos(a) * r;
    if (!inBreathArena(px, pz)) return false;
  }
  for (const g of CORNICE_GAPS) if (Math.hypot(x - g.x, z - g.z) < g.r + r + 2) return false;
  return lipDistance(x, z) >= r + 2;
}

/** How far (x, z) lies from the nearest open lip (yards; 0 at it): since the
 *  open rim the whole edge is a gap (lipDistance). */
export function gapDistance(x: number, z: number): number {
  return lipDistance(x, z);
}

/** Is (x, z) on the floor at an open lip (the Knotted Gale's throw)? */
export function atGapLip(x: number, z: number): boolean {
  return inBreathArena(x, z) && gapDistance(x, z) <= T.heartLipReach;
}

/** The Cornice's floor on a coarse grid, each spot's distance from the gaps
 *  (built once: a fixed list of the layout's, in a fixed order). */
let floorGrid: { x: number; z: number; far: number }[] | null = null;
export function knotGrid(): readonly { x: number; z: number; far: number }[] {
  if (floorGrid) return floorGrid;
  const out: { x: number; z: number; far: number }[] = [];
  for (let x = C.x - C.rx - 20; x <= C.x + C.rx + 20; x += 2)
    for (let z = C.z - C.rz - 4; z <= C.z + C.rz + 4; z += 2)
      if (circleClear(x, z, T.heartPickR)) out.push({ x, z, far: gapDistance(x, z) });
  floorGrid = out;
  return out;
}

/** The Cornice's floor on a 1 yd grid for the walk to the edge (built once):
 *  each cell's index by its rounded spot, and whether it lies at a lip well
 *  inside the throw's reach (`T.heartLipReach`). */
let edgeCells: Map<string, { x: number; z: number; lip: boolean }> | null = null;
/** The floor a cell on the way keeps all round it (yards). */
const EDGE_BODY = 1.5;
/** Floor all round (x, z) at `r` yards, eight ways (an open lip counts: the
 *  walk may run beside one). */
function floorAround(x: number, z: number, r: number): boolean {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const px = x + Math.sin(a) * r;
    const pz = z + Math.cos(a) * r;
    if (!inBreathArena(px, pz) && !openLipAt(px, pz)) return false;
  }
  return true;
}
function edgeGrid(): Map<string, { x: number; z: number; lip: boolean }> {
  if (edgeCells) return edgeCells;
  const out = new Map<string, { x: number; z: number; lip: boolean }>();
  for (let x = Math.floor(C.x - C.rx - 20); x <= C.x + C.rx + 20; x += 1)
    for (let z = Math.floor(C.z - C.rz - 4); z <= C.z + C.rz + 4; z += 1) {
      if (!inBreathArena(x, z)) continue;
      const lip = atGapLip(x, z) && gapDistance(x, z) <= T.heartLipReach - 0.6;
      // A cell on the way keeps a body's width of floor all round (the
      // walled edge's wall stands on it); a lip cell is the goal, at the edge.
      if (lip || floorAround(x, z, EDGE_BODY)) out.set(`${x},${z}`, { x, z, lip });
    }
  edgeCells = out;
  return out;
}

/** The Knotted Gale's walk to the edge from (x, z): the shortest way over the
 *  floor (a breadth-first search on its 1 yd grid, eight ways round, never off
 *  it: the climb's head is walled) to the nearest spot a carrier can throw
 *  from. The waypoints, first step to last, or empty off the floor. Pure: the
 *  tests and the raid bots walk it. */
export function edgeWalk(x: number, z: number): { x: number; z: number }[] {
  const grid = edgeGrid();
  const sx = Math.round(x);
  const sz = Math.round(z);
  const start = `${sx},${sz}`;
  if (!grid.has(start)) return [];
  const from = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i];
    const cell = grid.get(key) as { x: number; z: number; lip: boolean };
    if (cell.lip) {
      const path: { x: number; z: number }[] = [];
      for (let k: string | null = key; k !== null; k = from.get(k) ?? null) {
        const c = grid.get(k) as { x: number; z: number };
        path.push({ x: c.x, z: c.z });
      }
      return path.reverse();
    }
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const next = `${cell.x + dx},${cell.z + dz}`;
        if (from.has(next) || !grid.has(next)) continue;
        // A diagonal step only between two floor cells (no corner cut).
        if (
          dx !== 0 &&
          dz !== 0 &&
          (!grid.has(`${cell.x + dx},${cell.z}`) || !grid.has(`${cell.x},${cell.z + dz}`))
        )
          continue;
        from.set(next, key);
        queue.push(next);
      }
  }
  return [];
}

/** Where a Knotted Gale drops: hashed over the floor at least `T.heartFar`
 *  from every gap (a carry, never a throw where it lands) and `T.heartApart`
 *  from every spot in `avoid` (Thessaly's post and circle, this round's other
 *  ball, the last round's balls), so no two drops share a place (Jose's
 *  playtest: every ball fell beside Thessaly, the one patch the old far-from-
 *  the-gaps bar left). Each bar drops a little at a time if the floor cannot
 *  meet it. */
export function knotSpot(
  salt: number,
  avoid: readonly { x: number; z: number }[] = [],
): { x: number; z: number } {
  const grid = knotGrid();
  for (let relax = 0; relax <= 12; relax += 2) {
    const far = T.heartFar - relax / 2;
    const apart = T.heartApart - relax;
    const fits = grid.filter(
      (g) => g.far >= far && avoid.every((o) => Math.hypot(g.x - o.x, g.z - o.z) >= apart),
    );
    if (fits.length > 0) return fits[breathHash(salt, 41) % fits.length];
  }
  return { x: C.x, z: C.z };
}

/** The lip nearest (x, z): the floor just inside a gap's reach. A lip within
 *  `clear` yards of any spot in `avoid` is passed over for the next nearest
 *  (the Knotted Gale's second pair never opens on the first pair's mouth);
 *  with every lip taken, the nearest whatever. */
export function nearestLipSpot(
  x: number,
  z: number,
  avoid: readonly { x: number; z: number }[] = [],
  clear = 0,
): { x: number; z: number } {
  // Nearest first; a tie keeps the layout's order (a stable sort).
  const lips = CORNICE_GAPS.map((g) => ({ d: Math.hypot(x - g.x, z - g.z), g })).sort(
    (a, b) => a.d - b.d,
  );
  for (const { g } of lips) {
    const spot = voidCorpseSpot(g.x, g.z, 1);
    if (avoid.every((o) => Math.hypot(spot.x - o.x, spot.z - o.z) >= clear)) return spot;
  }
  return voidCorpseSpot(lips[0].g.x, lips[0].g.z, 1);
}

/** Loose gale `k`'s place `t` seconds into its run (heroic): a slow, wide,
 *  deterministic wander over the Cornice (an ellipse on two incommensurate
 *  beats), never out to the rim. */
export function looseGalePos(k: number, t: number): { x: number; z: number } {
  const rx = [26, 18, 32][k % 3];
  const rz = [16, 22, 12][k % 3];
  const wa = [0.23, -0.31, 0.19][k % 3];
  const wb = [0.37, 0.29, -0.41][k % 3];
  const pa = (k * 2.1) % (Math.PI * 2);
  const pb = (k * 1.3 + 0.7) % (Math.PI * 2);
  return { x: C.x + Math.sin(wa * t + pa) * rx, z: C.z + 2 + Math.sin(wb * t + pb) * rz };
}

/** A small integer hash (no rng in a pick). */
export function breathHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A barrage strike's spot (the storm breaking): the `n`-th spot of a pull
 *  salted by `salt`, hashed over the Cornice's floor (clear of the gaps, so
 *  every strike is dodged by stepping, never by a fall). */
export function barrageSpot(salt: number, n: number): { x: number; z: number } {
  for (let tries = 0; tries < 24; tries++) {
    const h = breathHash(salt, n * 31 + tries);
    const a = ((h & 0xffff) / 0x10000) * Math.PI * 2;
    const r = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * 0.82;
    const x = C.x + Math.sin(a) * C.rx * r;
    const z = C.z + Math.cos(a) * C.rz * r;
    if (circleClear(x, z, T.strikeR * 0.5)) return { x, z };
  }
  return { x: C.x, z: C.z };
}
