// The Highwatch manor's chimney smoke, the pure half (the painter is highwatch_manor_smoke.ts):
// where each puff of the kitchen chimney's two plumes is at a given moment, how big and how
// opaque. The Mirefen tavern's method (a fixed pool of puffs per plume, each at its own phase of
// one shared life, so the plume streams without spawning or freeing anything). Three-, DOM- and
// i18n-free, allocation-free, deterministic (a puff's wander is a stable hash of its slot and
// its cycle, never an rng). Cosmetic only: the low effects tier draws none.

/** One plume: its mouth in the manor's model frame (yards over its ground line, as
 *  manor_plan.py: +x west, +z north), its puffs, their life, rise and size. */
export interface ManorSmokeSource {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly puffs: number;
  readonly life: number;
  readonly rise: number;
  readonly size0: number;
  readonly size1: number;
  readonly alpha: number;
}

// the kitchen chimney (manor_shell.py chimney(): x 20.3, z 15.9, its cap at 15.5 and two clay
// pots 0.84 either side of its middle, their mouths at 16.3)
const POT_Y = 16.4;
export const MANOR_SMOKE_SOURCES: readonly ManorSmokeSource[] = [
  {
    x: 20.3 - 0.84,
    y: POT_Y,
    z: 15.9,
    puffs: 16,
    life: 7.5,
    rise: 1.0,
    size0: 1.2,
    size1: 5.2,
    alpha: 0.55,
  },
  {
    x: 20.3 + 0.84,
    y: POT_Y,
    z: 15.9,
    puffs: 12,
    life: 6.5,
    rise: 0.95,
    size0: 1.0,
    size1: 4.4,
    alpha: 0.42,
  },
];

/** The heights' breeze off the mountains: the plumes lean this way (model x, z yards a second). */
export const MANOR_SMOKE_WIND = { x: 0.35, z: -0.25 } as const;

export const MANOR_SMOKE_PUFFS = MANOR_SMOKE_SOURCES.reduce((n, s) => n + s.puffs, 0);

function hash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** One puff this moment (model frame): its middle, its size (the quad's side) and opacity. */
export interface ManorSmokePuff {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
}

/** Fill `out` with puff `i` (0 to MANOR_SMOKE_PUFFS - 1) at clock `t` (seconds). */
export function manorSmokePuffInto(i: number, t: number, out: ManorSmokePuff): ManorSmokePuff {
  let k = i;
  let slot = 0;
  let src = MANOR_SMOKE_SOURCES[0];
  for (let s = 0; s < MANOR_SMOKE_SOURCES.length; s++) {
    src = MANOR_SMOKE_SOURCES[s];
    if (k < src.puffs) {
      slot = s;
      break;
    }
    k -= src.puffs;
  }
  const clock = t + (k * src.life) / src.puffs;
  const cycle = Math.floor(clock / src.life);
  const age = clock - cycle * src.life;
  const u = age / src.life;
  const seed = slot * 1000 + k;
  const wa = hash(seed, cycle);
  const wb = hash(cycle, seed + 0.5);
  // rising, slowing as it cools, carried off by the breeze, wandering as it goes
  const up = src.rise * src.life * (u - 0.35 * u * u);
  const drift = age ** 1.25;
  const wander = 0.4 + 1.6 * u;
  out.x = src.x + MANOR_SMOKE_WIND.x * drift + (wa - 0.5) * wander;
  out.y = src.y + up;
  out.z = src.z + MANOR_SMOKE_WIND.z * drift + (wb - 0.5) * wander;
  out.size = src.size0 + (src.size1 - src.size0) * Math.sqrt(u) * (0.8 + 0.4 * wb);
  const fadeIn = Math.min(1, u / 0.08);
  const fadeOut = (1 - u) ** 0.75;
  out.alpha = Math.min(1, src.alpha * fadeIn * fadeOut * (0.8 + 0.4 * wa));
  return out;
}
