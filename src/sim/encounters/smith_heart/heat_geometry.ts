// The Guardian of the Heat's geometry (docs/design/raid/smith_heart.md
// section 7.4): PURE over the layout (no SimContext, no rng), so the raid
// bots' tactics and the renderer can reuse it. Instance-local yards.
//
//   the floor     the Hearth's eight-sided hall (`FORGE_POINTS`, the
//                 `smiths_forge` surface): the fight's players stand on it
//   the channel   the seam across the floor's middle (`HEARTH_CHANNEL`): who
//                 stands in it while it flows, and which half a body is on
//   the crystals  which sockets a Shed Heat raises (`pickSockets`: one each
//                 side of the channel, heroic's third on alternating sides),
//                 and who a ray strikes (`nearestInReach`: the nearest living
//                 body within reach, the lower id on a tie)

import {
  FORGE_POINTS,
  HEARTH_CHANNEL,
  HEARTH_CRYSTAL_SOCKETS,
} from '../../content/smith_heart_layout';
import { heatHash } from './heat_ids';

export interface HPoint {
  x: number;
  z: number;
}

export interface HBody extends HPoint {
  id: number;
}

/** Is (x, z) on the Hearth's floor (its eight-sided hall)? */
export function inHearthFloor(x: number, z: number): boolean {
  let inside = false;
  const pts = FORGE_POINTS;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is (x, z) in the channel's fire (within `half` of its line)? */
export function inChannel(x: number, z: number, half: number): boolean {
  const c = HEARTH_CHANNEL;
  return Math.abs(x - c.x) <= half && z >= c.z0 && z <= c.z1;
}

/** Which half of the floor (x, z) is on: -1 the Hearth's (west), +1 the
 *  door's (east). */
export function channelSide(x: number): -1 | 1 {
  return x < HEARTH_CHANNEL.x ? -1 : 1;
}

/** The nearest body to `from` within `range` (the lower id on a tie), or
 *  null when nobody is that near. */
export function nearestInReach(
  from: HPoint,
  bodies: readonly HBody[],
  range: number,
): HBody | null {
  let best: HBody | null = null;
  let bestD = range + 1e-9;
  for (const b of bodies) {
    const d = Math.hypot(b.x - from.x, b.z - from.z);
    if (d < bestD - 1e-9 || (best && Math.abs(d - bestD) <= 1e-9 && b.id < best.id)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** The sockets (HEARTH_CRYSTAL_SOCKETS indices) the `wave`th Shed Heat
 *  raises, `count` of them: one each side of the channel, then (heroic) a
 *  third on the side that alternates wave by wave, never a socket twice. */
export function pickSockets(wave: number, count: number): number[] {
  const east = HEARTH_CRYSTAL_SOCKETS.flatMap((s, i) => (s.side === 1 ? [i] : []));
  const west = HEARTH_CRYSTAL_SOCKETS.flatMap((s, i) => (s.side === -1 ? [i] : []));
  const out: number[] = [];
  const e = heatHash(wave, 11) % east.length;
  const w = heatHash(wave, 23) % west.length;
  if (count >= 1) out.push(east[e]);
  if (count >= 2) out.push(west[w]);
  if (count >= 3 && Math.min(east.length, west.length) > 1) {
    const sideEast = wave % 2 === 0;
    const pool = sideEast ? east : west;
    const taken = sideEast ? e : w;
    const step = 1 + (heatHash(wave, 37) % (pool.length - 1));
    out.push(pool[(taken + step) % pool.length]);
  }
  return out;
}
