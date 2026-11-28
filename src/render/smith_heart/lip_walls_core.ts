// Pure plan of a vein's low walls over the void (phase 2G's Breath walls,
// shared with phase 2H's Quench): modules a few yards long walked along
// every lip of a vein's walks that drops to the void, each set on its chord
// and pushed out past the lip's own bow (never over a walk), following a
// stair's slope, none where the lip bends onto another floor. The kit piece
// is an edge module in the edge planner's frame (along local X, origin on
// the lip at the walk's height, the drop toward local +Z here: the piece's
// front). Three-free, DOM-free, deterministic (a hash, never rng).

import { SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  authoredFieldSurfaceAt,
} from '../../sim/instances/authored_field';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash } from './heart_plan_core';

const F = SMITH_HEART_FIELD;

/** One vein's walls: whose lips, which pieces, the module's measures. */
export interface LipWallSpec {
  /** The walked floors whose lips over the void take the walls. */
  surfaces: ReadonlySet<string>;
  /** The module and its variant (drawn where the hash falls under `bShare`). */
  pieceA: string;
  pieceB: string;
  bShare: number;
  /** A module's length along a lip (yards). */
  module: number;
  /** The piece's half length at stretch 1, and its reach out past the lip. */
  half: number;
  far: number;
}

/** A vein's lips over the void, chained end to end per surface: each chain
 *  a polyline along the lip with the outward normal at each run. */
export function lipChains(
  surfaces: ReadonlySet<string>,
): { x: number; z: number; nx: number; nz: number }[][] {
  const runs = authoredFieldCliffRuns(F).filter(
    (r) =>
      surfaces.has(r.surface) &&
      // A break in the wall (the field's lipOpenings: the Cornice's gaps)
      // stands bare; its broken coping is the Breath fight's own dressing.
      !r.open &&
      r.low <= F.voidHeight + 1 &&
      r.high - r.low >= 4 &&
      Math.hypot(r.bx - r.ax, r.bz - r.az) > 1e-3,
  );
  const chains: { x: number; z: number; nx: number; nz: number }[][] = [];
  let last: (typeof runs)[number] | null = null;
  for (const r of runs) {
    const joined =
      last && last.surface === r.surface && Math.hypot(last.bx - r.ax, last.bz - r.az) < 0.05;
    if (!joined) chains.push([{ x: r.ax, z: r.az, nx: r.nx, nz: r.nz }]);
    chains[chains.length - 1].push({ x: r.bx, z: r.bz, nx: r.nx, nz: r.nz });
    last = r;
  }
  return chains;
}

/** Does a wall module at (x, z) turned by `rot` stand wholly over the drop
 *  (none where the lip bends onto another floor)? */
export function lipWallClear(
  x: number,
  z: number,
  rot: number,
  stretch: number,
  half: number,
  far: number,
): boolean {
  const ux = Math.cos(rot);
  const uz = -Math.sin(rot);
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);
  const h = half * stretch;
  for (let k = -6; k <= 6; k++) {
    const a = (k / 6) * h;
    for (const w of [0.2, 0.55, far]) {
      if (authoredFieldSurfaceAt(F, x + ux * a + nx * w, z + uz * a + nz * w)) return false;
    }
  }
  return true;
}

/** The walls along every lip of `spec.surfaces` over the void. */
export function planLipWalls(spec: LipWallSpec): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const ground = (x: number, z: number) => authoredFieldHeight(F, x, z);
  for (const chain of lipChains(spec.surfaces)) {
    const cum = [0];
    for (let i = 1; i < chain.length; i++)
      cum.push(cum[i - 1] + Math.hypot(chain[i].x - chain[i - 1].x, chain[i].z - chain[i - 1].z));
    const total = cum[cum.length - 1];
    if (total < spec.module * 0.6) continue;
    const pieces = Math.max(1, Math.round(total / spec.module));
    const len = total / pieces;
    const at = (s: number) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      const a = chain[i - 1];
      const b = chain[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, i };
    };
    for (let k = 0; k < pieces; k++) {
      const p0 = at(k * len);
      const p1 = at((k + 1) * len);
      const cx = (p0.x + p1.x) / 2;
      const cz = (p0.z + p1.z) / 2;
      let ux = p1.x - p0.x;
      let uz = p1.z - p0.z;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      // The outward normal: the chord's perpendicular on the runs' side.
      let nx = uz;
      let nz = -ux;
      const run = chain[Math.min(chain.length - 1, p0.i)];
      if (nx * run.nx + nz * run.nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      // Out past the lip's own bow between the chord's ends.
      let bow = 0;
      for (let i = p0.i; i < p1.i; i++)
        bow = Math.max(bow, (chain[i].x - cx) * nx + (chain[i].z - cz) * nz);
      const x = cx + nx * (bow + 0.02);
      const z = cz + nz * (bow + 0.02);
      const rot = Math.atan2(nx, nz);
      const stretch = ul / (spec.half * 2);
      if (stretch < 0.35 || !lipWallClear(x, z, rot, stretch, spec.half, spec.far)) continue;
      // Local +X is (cos rot, -sin rot): the slope along it.
      const lx = Math.cos(rot);
      const lz = -Math.sin(rot);
      const y0 = ground(x - lx * ul * 0.45 - nx * 0.4, z - lz * ul * 0.45 - nz * 0.4);
      const y1 = ground(x + lx * ul * 0.45 - nx * 0.4, z + lz * ul * 0.45 - nz * 0.4);
      const y = ground(x - nx * 0.4, z - nz * 0.4);
      const shear = Math.abs(y1 - y0) < ul ? (y1 - y0) / (ul * 0.9) : 0;
      const h = heartHash(Math.round(x * 3), Math.round(z * 3));
      out.push({
        piece: h < spec.bShare ? spec.pieceB : spec.pieceA,
        x,
        y,
        z,
        rot,
        stretch,
        shear,
        noShadow: true,
      });
    }
  }
  return out;
}
