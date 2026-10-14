// Deepglass currents: three toroidal bands that push the ball and the players.
//
// DETERMINISTIC BY CONSTRUCTION. The match clock is the only input, no rng, no
// wall clock, so the offline Sim, the online server and a replay all compute
// byte-identical currents. This is the same discipline the Vale Cup ball keeps
// (zero shared-rng draws on the tick path).
//
// Each band swirls around the bell's vertical axis at its own height, with a
// Gaussian falloff so a band's influence fades away from that height, and a
// slow sinusoidal strength so the bell never feels static.

import { DEEPGLASS_CENTER, DEEPGLASS_RADIUS, type Vec3 } from './layout';

interface CurrentBand {
  /** Height above the bell's centre this band swirls at. */
  dy: number;
  /** Peak tangential acceleration, yd/s^2. Sign picks the swirl direction. */
  strength: number;
  /** How fast the strength oscillates, radians per second. */
  rate: number;
  /** Phase offset so the three bands never peak together. */
  phase: number;
}

/** Vertical reach of a band, in yards. */
const BAND_SIGMA = 11;

const BANDS: readonly CurrentBand[] = [
  { dy: 18, strength: 2.4, rate: 0.21, phase: 0 },
  { dy: 0, strength: -1.8, rate: 0.17, phase: 2.1 },
  { dy: -18, strength: 2.1, rate: 0.13, phase: 4.2 },
];

/**
 * Current acceleration at a point, written into `out` to stay allocation-free
 * on the tick path. `clock` is the match's elapsed play time in seconds.
 *
 * The swirl is tangential in the xz plane (perpendicular to the radial
 * direction), so a band spins the water around the bell's axis rather than
 * shoving everything one way. Strength fades to nothing at the glass so a body
 * pinned against the wall is never scraped along it.
 */
export function currentAt(x: number, y: number, z: number, clock: number, out: Vec3): void {
  out.x = 0;
  out.y = 0;
  out.z = 0;

  const rx = x - DEEPGLASS_CENTER.x;
  const rz = z - DEEPGLASS_CENTER.z;
  const r = Math.hypot(rx, rz);
  if (r < 1e-3) return; // dead on the axis: no tangent to push along

  // Tangent (counter-clockwise seen from above) is (-rz, rx) normalised.
  const tx = -rz / r;
  const tz = rx / r;

  // Fade out toward the glass so nothing gets dragged along the wall.
  const edge = 1 - Math.min(1, r / DEEPGLASS_RADIUS) ** 2;

  const dyFromCentre = y - DEEPGLASS_CENTER.y;
  for (const band of BANDS) {
    const d = (dyFromCentre - band.dy) / BAND_SIGMA;
    const reach = Math.exp(-d * d);
    if (reach < 0.01) continue;
    const pulse = 0.6 + 0.4 * Math.sin(clock * band.rate + band.phase);
    const a = band.strength * reach * edge * pulse;
    out.x += tx * a;
    out.z += tz * a;
  }
}

/** Zero current, for callers that want the bands off (tests, kickoff freeze). */
export const NO_CURRENT: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 }) as Vec3;
