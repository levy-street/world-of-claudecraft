// The basin's thorn waves, planned (basin_thorns.ts draws them): a lash that
// slams the ground with its own club (the Gorgebloom's Vine Lash, the
// Snarlvine Lasher's Entangling Lash) tears thorns up out of the loam down the
// rest of its lane, the front racing out from where the club landed to the
// lane's end. The stations along the lane, the delay the front takes to reach
// each, and one thorn's growth: it bursts up, stands, and sinks back.
//
// Three-free, DOM-free, deterministic.

/** One thorn spike: seconds to tear up, stand, and sink back. */
export const THORN_LIFE = { rise: 0.12, hold: 0.55, sink: 0.5 } as const;

/** A thorn's growth: its height share (0..1), how far it has sunk back
 *  (yards), and whether it still stands. */
export interface ThornGrowth {
  grow: number;
  sink: number;
  alive: boolean;
}

/** A thorn's growth `age` seconds after it tore up, written into `out`
 *  (allocation-free: it runs per thorn per frame). */
export function thornGrowthInto(age: number, out: ThornGrowth): ThornGrowth {
  const L = THORN_LIFE;
  out.alive = true;
  out.sink = 0;
  if (age < 0) {
    out.grow = 0;
  } else if (age < L.rise) {
    // Overshoot a touch as it bursts up.
    out.grow = 1.12 * (1 - (1 - age / L.rise) ** 3);
  } else if (age < L.rise + L.hold) {
    out.grow = 1;
  } else {
    const s = (age - L.rise - L.hold) / L.sink;
    if (s >= 1) {
      out.grow = 0;
      out.alive = false;
    } else {
      out.grow = 1 - s * 0.35;
      out.sink = s * s * 1.6;
    }
  }
  return out;
}

/** The wave's stations (yards along the lane) after `from` (where the club
 *  landed, excluded) out to a `length` lane, every `step` yards, the last one
 *  held just inside the lane's end. Writes `out`. */
export function laneWaveStations(
  from: number,
  length: number,
  step: number,
  out: number[],
): number[] {
  out.length = 0;
  if (step <= 0) return out;
  for (let d = from + step; d < length + 1e-6; d += step) out.push(Math.min(d, length - 0.6));
  return out;
}

/** Seconds after the slam the front reaches `reach` yards along the lane,
 *  racing out from `from` at `speed` yd/s. */
export function laneWaveDelay(reach: number, from: number, speed: number): number {
  return speed > 0 ? Math.max(0, reach - from) / speed : 0;
}
