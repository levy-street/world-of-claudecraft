// A shared floor-telegraph fan (../floor_telegraph) draped on the Rite Ring's
// crag top ONLY: the kit drapes every vertex on the floor under it, so a fan
// whose reach runs past the rim drapes down the cliff and paints the Choir Loft
// far below (the Burning Knell's half, a Shadow Pulse or a Reap at the rim).
// Here each vertex past the rim is pulled back onto it along its own spoke
// (morthen_rite_fx_core.ts cragRimRadius, the sim's own band), and so is the
// edge curtain, so the shape ends where the crag does. The draped geometry is
// rewritten only when the fan moves (a planted cast or a static half writes it
// once).

import { TELEGRAPH_CURTAIN_HEIGHT, type TelegraphFan, type TelegraphKit } from '../floor_telegraph';
import { CRAG_FLOOR_BAND, cragRimRadius } from './morthen_rite_fx_core';

/** The last placement a fan was draped for (rewritten when it changes). */
export interface CragDrapeMemo {
  x: number;
  y: number;
  z: number;
  yaw: number;
  range: number;
}

export function cragDrapeMemo(): CragDrapeMemo {
  return { x: Number.NaN, y: 0, z: 0, yaw: 0, range: 0 };
}

/** Forget the memo (the fan's slot was handed to another shape). */
export function resetCragDrape(m: CragDrapeMemo): void {
  m.x = Number.NaN;
}

/**
 * Drape fan `f` at (x, z) on the floor `y` under it, turned `yaw`, `range`
 * yards, cut back to the crag top whose floor is `y`. A no-op while the
 * placement is unchanged.
 */
export function drapeFanOnCrag(
  kit: TelegraphKit,
  f: TelegraphFan,
  groundY: (x: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  range: number,
  memo: CragDrapeMemo,
  band = CRAG_FLOOR_BAND,
): void {
  if (memo.x === x && memo.y === y && memo.z === z && memo.yaw === yaw && memo.range === range)
    return;
  memo.x = x;
  memo.y = y;
  memo.z = z;
  memo.yaw = yaw;
  memo.range = range;
  kit.drapeFan(f, groundY, x, y, z, yaw, range);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // One rim per spoke (the fan's vertices share their spokes' angles).
  const rims = new Map<number, number>();
  const rimAt = (ux: number, uz: number): number => {
    const key = Math.round(Math.atan2(ux, uz) * 1e4);
    let rim = rims.get(key);
    if (rim === undefined) {
      const len = Math.hypot(ux, uz) || 1;
      const lx = ux / len;
      const lz = uz / len;
      rim = cragRimRadius(groundY, x, z, lx * c + lz * s, -lx * s + lz * c, y, range, band);
      rims.set(key, rim);
    }
    return rim;
  };
  const pull = (ux: number, uz: number): number => {
    const r = Math.hypot(ux, uz) * range;
    if (r < 1e-6) return 1;
    const rim = rimAt(ux, uz);
    return r > rim ? rim / r : 1;
  };
  const pos = f.floor.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const ux = f.unitFloor[i * 2];
    const uz = f.unitFloor[i * 2 + 1];
    const k = pull(ux, uz);
    const lx = ux * k * range;
    const lz = uz * k * range;
    pos.setXYZ(i, ux * k, groundY(x + lx * c + lz * s, z - lx * s + lz * c) - y, uz * k);
  }
  pos.needsUpdate = true;
  if (f.curtain) {
    const cp = f.curtain.geometry.getAttribute('position');
    for (let i = 0; i < f.stations; i++) {
      const ux = f.unitStations[i * 2];
      const uz = f.unitStations[i * 2 + 1];
      const k = pull(ux, uz);
      const lx = ux * k * range;
      const lz = uz * k * range;
      const g = groundY(x + lx * c + lz * s, z - lx * s + lz * c) - y;
      cp.setXYZ(i * 2, ux * k, g, uz * k);
      cp.setXYZ(i * 2 + 1, ux * k, g + TELEGRAPH_CURTAIN_HEIGHT, uz * k);
    }
    cp.needsUpdate = true;
  }
}
