// The Mirefen tavern's chimney smoke, the pure half (the painter is mirefen_tavern_smoke.ts): where
// each puff of the two plumes is at a given moment (the river-stone chimney over the wall fire,
// and the hearth's copper flue under its cap on the ridge), how big and how opaque. Three-, DOM-
// and i18n-free, allocation-free, deterministic (no rng: a puff's wander comes from a stable hash
// of its slot and its cycle).
//
// Stateless by design: a fixed pool of puffs per plume, each at its own phase of one shared
// life, so puff i's age is ((t + i * life / n) mod life) and the plume streams without ever
// spawning or freeing anything. Each cycle a slot is born again at the mouth with a new wander.
// Cosmetic only (graphics-settings fairness: the low tier draws none, and nothing a player acts
// on is behind it).

import { TAVERN_HALL, TAVERN_HOOD, TAVERN_PIT, TAVERN_PROPS } from '../sim/content/mirefen_tavern';

/** One plume: its mouth (tavern-local yards over the ground floor), how many puffs, their life,
 *  how fast they rise and how big they start and end. */
export interface TavernSmokeSource {
  x: number;
  y: number;
  z: number;
  puffs: number;
  life: number;
  rise: number;
  size0: number;
  size1: number;
  /** The plume's peak opacity (the hearth's flue smokes thinner than the wall fire's chimney). */
  alpha: number;
}

const fire = TAVERN_PROPS.find((p) => p.kind === 'fireplace');

/** The two plumes (build: tavern_shell.py's chimney pots, tavern_frame.py's flue cap). */
export const TAVERN_SMOKE_SOURCES: readonly TavernSmokeSource[] = [
  {
    x: TAVERN_HALL.x1 + 0.7,
    y: TAVERN_HALL.eave + 5.3,
    z: fire?.z ?? 2.5,
    puffs: 22,
    life: 8,
    rise: 1.1,
    size0: 1.7,
    size1: 6.2,
    alpha: 0.46,
  },
  {
    x: TAVERN_PIT.x,
    y: TAVERN_HOOD.flueTop + 0.35,
    z: TAVERN_PIT.z,
    puffs: 12,
    life: 6.5,
    rise: 1.0,
    size0: 1.4,
    size1: 5.0,
    alpha: 0.34,
  },
];

/** The marsh's steady breeze: the plumes lean this way (local x, z yards per second). */
export const TAVERN_SMOKE_WIND = { x: -0.45, z: 0.3 } as const;

/** Total puffs across every plume (the painter's buffer size). */
export const TAVERN_SMOKE_PUFFS = TAVERN_SMOKE_SOURCES.reduce((n, s) => n + s.puffs, 0);

function hash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** One puff this moment (local frame): its middle, its size (the quad's side, yards) and its
 *  opacity (0 while unborn). */
export interface TavernSmokePuff {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
}

/** Fill `out` with puff `i` (0 to TAVERN_SMOKE_PUFFS - 1) at clock `t` (seconds). */
export function tavernSmokePuffInto(i: number, t: number, out: TavernSmokePuff): TavernSmokePuff {
  let k = i;
  let src = TAVERN_SMOKE_SOURCES[0];
  let slot = 0;
  for (let s = 0; s < TAVERN_SMOKE_SOURCES.length; s++) {
    src = TAVERN_SMOKE_SOURCES[s];
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
  const wander = 0.5 + 1.8 * u;
  out.x = src.x + TAVERN_SMOKE_WIND.x * drift + (wa - 0.5) * wander;
  out.y = src.y + up;
  out.z = src.z + TAVERN_SMOKE_WIND.z * drift + (wb - 0.5) * wander;
  out.size = src.size0 + (src.size1 - src.size0) * Math.sqrt(u) * (0.8 + 0.4 * wb);
  // in quickly at the mouth, a long thinning out
  const fadeIn = Math.min(1, u / 0.08);
  const fadeOut = (1 - u) ** 0.75;
  out.alpha = Math.min(1, src.alpha * fadeIn * fadeOut * (0.8 + 0.4 * wa));
  return out;
}
