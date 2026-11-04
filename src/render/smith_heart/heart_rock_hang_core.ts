// Pure plan of the great faces hung under the Breath's high walks (the AAA
// pass's third round, 2026-11-04: the audit's point 3, the worst view of the
// main map). From the Ring the Breath's mouth looked onto the Cornice's and
// the landings' sides: forty yards of rock lip (`planHeartLips`) ending in
// mid-air like hanging slabs, and under them the field's own flat face a
// hundred yards tall (no under-wall stands there: the isles' open sky).
//
// Here each such side is dressed from its brink the whole way down into the
// mist with the rock kit's hung faces (`Kit_RockHangA`, `Kit_RockHangB`,
// docs/design/raid/kit/rock_sculpt.py `rock_hang`): one module per stretch
// of the cliff run, its brink under the lowest floor along it (as a lip's),
// its face battered out over the void past the field's own flaring face, its
// height fitted to the drop (`rise`). Where a face hangs, the lip it would
// double is left out (`planHeartRockLips`); where an under-wall already
// stands (the Cornice's flanks) the lip and the wall keep the side.
//
// Rules (pinned by tests/smith_heart_rock_hang.test.ts):
//   - only the Breath's walks seen from the Ring and its mouth
//     (`HEART_HANG_SURFACES`), never a floating isle's nor a bridge's;
//   - nothing above its brink, the brink under every floor it hangs from;
//   - never through another walked floor (its leaning face measured out
//     over every floor near it), never in the open air (the Ring's chasm,
//     the Wind Bridge's gulf); the summit's sky (the isles' and the gulf
//     between them, `HEART_BREATH_GULF`) it may hang into, far under the isles;
//   - drawn on every tier (it replaces lips the low tier draws too).
//
// Three-free, DOM-free, deterministic (no rng, no clock).

import { SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import type { HeartKitPlacement } from './heart_kit_core';
import { chasmChains, planHeartLips, planHeartUnderCliffs } from './heart_rock_plan_core';
import { heartOpenAir } from './heart_walls_core';

/** A hung face's measures (game yards, unscaled; pinned against the GLB):
 *  `half` its true front's half width, `reach` its whole half width, `drop`
 *  its brink to its foot, `depth` how far its body runs back under the walk,
 *  `out` how far its face reaches out over the void at its foot (the batter
 *  and the beds' step-outs), and the plan's own spacing. */
export const HEART_ROCK_HANG = {
  half: 15,
  reach: 17.2,
  drop: 100,
  depth: 10.5,
  out: 36.5,
  /** A module per stretch of about this many yards of the run. */
  segment: 26,
  /** Neighbours cross each other's turned-back ends (no dark seam between). */
  overlap: 8,
  /** Its brink set out past the lip line (as a lip's: the field's face
   *  under the lip jags out up to two yards). */
  push: 1.8,
  /** Only under a walk this high over the void. */
  minDrop: 50,
  /** The steepest slope it follows (a stair's). */
  maxShear: 0.7,
  /** Its height fitted to the drop (down past the mist), within these. */
  rise: [0.7, 1.45] as const,
  /** How far past the mist's floor its foot reaches. */
  below: 12,
  /** An under-wall this near a face's run (across it) is left out: the
   *  face is the side's whole rock, brink to mist. */
  underClear: 18,
} as const;

/** The Breath's walks whose sides are hung: the mouth, the first landing, the
 *  chimney stair and its landing, the Cornice's climb and the Cornice. */
export const HEART_HANG_SURFACES: ReadonlySet<string> = new Set([
  'breath_mouth',
  'breath_b1',
  'breath_chimney',
  'breath_b2',
  'cornice_climb',
  'storm_cornice',
]);

/** Does a face hung at (x, y, z) (along u, leaning out along n, `half` yards
 *  either way, its foot `drop` under its brink) stand through a walked floor?
 *  Conservative: its front may reach `HEART_ROCK_HANG.out` yards out at its
 *  foot and, with the beds' step-outs, ten yards at any height. */
export function hangCrossesFloor(
  x: number,
  y: number,
  z: number,
  ux: number,
  uz: number,
  nx: number,
  nz: number,
  half: number,
  shear: number,
  drop: number,
): boolean {
  const F = SMITH_HEART_FIELD;
  const H = HEART_ROCK_HANG;
  const slope = drop / H.out;
  for (let i = -6; i <= 6; i++) {
    const a = (i / 6) * half;
    const brink = y + shear * a;
    for (let w = 0.5; w <= H.out + 1; w += 1) {
      const px = x + ux * a + nx * w;
      const pz = z + uz * a + nz * w;
      if (!authoredFieldSurfaceAt(F, px, pz)) continue;
      const floor = authoredFieldHeight(F, px, pz);
      const top = brink - Math.max(0, w - 10) * slope + 0.6;
      const foot = brink - drop;
      if (floor + 0.02 < top && floor + 2.6 > foot && floor < brink - 0.3) return true;
    }
  }
  return false;
}

let cached: HeartKitPlacement[] | null = null;

/** Every hung face (built once: the layout is static). */
export function planHeartHangs(): HeartKitPlacement[] {
  if (cached) return cached;
  const F = SMITH_HEART_FIELD;
  const H = HEART_ROCK_HANG;
  const out: HeartKitPlacement[] = [];
  let index = 0;
  for (const chain of chasmChains()) {
    const surface = chain[0].surface;
    if (!HEART_HANG_SURFACES.has(surface)) continue;
    const lens = chain.map((r) => Math.hypot(r.bx - r.ax, r.bz - r.az));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 6) continue;
    const at = (t: number) => {
      let rest = Math.max(0, Math.min(total, t));
      for (let k = 0; k < chain.length; k++) {
        if (rest <= lens[k] || k === chain.length - 1) {
          const r = chain[k];
          const f = Math.min(1, rest / lens[k]);
          return { x: r.ax + (r.bx - r.ax) * f, z: r.az + (r.bz - r.az) * f, nx: r.nx, nz: r.nz };
        }
        rest -= lens[k];
      }
      throw new Error('unreachable');
    };
    const floorAt = (t: number): number => {
      const q = at(t);
      return authoredFieldHeight(F, q.x - q.nx * 0.4, q.z - q.nz * 0.4);
    };
    const n = Math.max(1, Math.round(total / H.segment));
    for (let i = 0; i < n; i++) {
      const s0 = (total * i) / n;
      const s1 = (total * (i + 1)) / n;
      const A = at(s0);
      const B = at(s1);
      const chord = Math.hypot(B.x - A.x, B.z - A.z);
      if (chord < 4) continue;
      const ux = (B.x - A.x) / chord;
      const uz = (B.z - A.z) / chord;
      const M = at((s0 + s1) / 2);
      let nx = uz;
      let nz = -ux;
      if (nx * M.nx + nz * M.nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const ya = floorAt(s0 + 0.2);
      const yb = floorAt(s1 - 0.2);
      const ym = floorAt((s0 + s1) / 2);
      if (Math.min(ya, yb, ym) - F.voidHeight < H.minDrop) continue;
      const shear = (yb - ya) / Math.max(0.5, chord - 0.4);
      if (Math.abs(shear) > H.maxShear) continue;
      const cx = (A.x + B.x) / 2;
      const cz = (A.z + B.z) / 2;
      const bow = (M.x - cx) * nx + (M.z - cz) * nz;
      const ox = cx + nx * (Math.max(0, bow) + H.push);
      const oz = cz + nz * (Math.max(0, bow) + H.push);
      const stretch = (chord + H.overlap) / (H.half * 2);
      const reachX = H.reach * stretch;
      // The brink under the lowest of the floor over its whole body.
      let over = 0;
      for (let k = -6; k <= 6; k++) {
        const a = (k / 6) * reachX;
        for (let w = -H.depth; w <= -0.5; w += 0.5) {
          const px = ox + ux * a + nx * w;
          const pz = oz + uz * a + nz * w;
          if (!authoredFieldSurfaceAt(F, px, pz)) continue;
          over = Math.max(over, ym + shear * a - authoredFieldHeight(F, px, pz) + 0.05);
        }
      }
      const y = ym - over - 0.3;
      const rise = Math.max(H.rise[0], Math.min(H.rise[1], (y - F.voidHeight + H.below) / H.drop));
      const drop = H.drop * rise;
      // Never in the open air: its body out at mid-drop and at its foot.
      const mid = H.push + H.out * 0.5;
      const foot = H.push + H.out * 0.85;
      if (
        heartOpenAir(ox + nx * mid, oz + nz * mid, reachX * 0.5, false) ||
        heartOpenAir(ox + nx * foot, oz + nz * foot, reachX * 0.5, false)
      )
        continue;
      if (hangCrossesFloor(ox, y, oz, ux, uz, nx, nz, reachX, shear, drop)) continue;
      out.push({
        piece: index++ % 2 ? 'Kit_RockHangB' : 'Kit_RockHangA',
        x: ox,
        y,
        z: oz,
        rot: Math.atan2(nx, nz),
        stretch,
        rise,
        shear: Math.abs(shear) < 1e-6 ? 0 : shear,
        noShadow: true,
        cosmetic: false,
      });
    }
  }
  cached = out;
  return out;
}

/** Does a hung face stand where this lip would hang (the same side, along
 *  its run, at its brink)? */
export function heartHangCovers(hang: HeartKitPlacement, lip: HeartKitPlacement): boolean {
  const dx = lip.x - hang.x;
  const dz = lip.z - hang.z;
  const nx = Math.sin(hang.rot);
  const nz = Math.cos(hang.rot);
  const along = Math.abs(dx * nz - dz * nx);
  const across = Math.abs(dx * nx + dz * nz);
  const half = HEART_ROCK_HANG.half * (hang.stretch ?? 1);
  return along <= half + 2 && across <= 6 && Math.abs(lip.y - hang.y) < 4;
}

/** Does a hung face stand in front of this under-wall (its run, out past its
 *  lip by an under-wall's offset)? */
export function heartHangHides(hang: HeartKitPlacement, wall: HeartKitPlacement): boolean {
  const dx = wall.x - hang.x;
  const dz = wall.z - hang.z;
  const nx = Math.sin(hang.rot);
  const nz = Math.cos(hang.rot);
  const along = Math.abs(dx * nz - dz * nx);
  const across = dx * nx + dz * nz;
  const half = HEART_ROCK_HANG.half * (hang.stretch ?? 1);
  return along <= half + 8 && Math.abs(across) <= HEART_ROCK_HANG.underClear && wall.y < hang.y;
}

/** The under-walls the mountain draws: every one but those a face hangs in front of. */
export function planHeartRockUnder(): HeartKitPlacement[] {
  const hangs = planHeartHangs();
  return planHeartUnderCliffs().filter((w) => !hangs.some((h) => heartHangHides(h, w)));
}

/** The lips the mountain draws: every lip but those a hung face replaces. */
export function planHeartRockLips(): HeartKitPlacement[] {
  const hangs = planHeartHangs();
  return planHeartLips().filter((lip) => !hangs.some((h) => heartHangCovers(h, lip)));
}
