// A torched mudfin hut's smoke plume, the pure half (the painter is hut_smoke.ts): where each puff
// of one burning hut's plume is at a moment of its fire, how big, how opaque and how dark.
// Three-, DOM- and i18n-free, allocation-free, deterministic (no rng: a puff's wander comes from a
// stable hash of its slot and its cycle), the mirefen_tavern_smoke_core.ts recipe.
//
// Stateless: a fixed pool of puffs per hut, each at its own phase of one shared life, so a puff is
// born again on the roof every cycle and the plume streams without spawning or freeing anything.
// What a puff carries is decided at its BIRTH, by how much smoke the hut was making then
// (hutSmokeOutput): a grey trail while the thatch catches and burns, a heavy dark plume as the
// flames die, then a thinning smoulder, and a puff born in the thick of it stays thick as it rises.
// The last puff is gone at HUT_SMOKE_END_SECONDS. Cosmetic only (the low effects tier draws none).

import { HUT_FIRE_BURN_SECONDS, type HutFireBody } from './hut_fire_core';

/** Puffs in one hut's plume (the painter's buffer holds this many per burning hut). */
export const HUT_SMOKE_PUFFS = 28;
/** How long one puff lives, roof to gone. */
export const HUT_SMOKE_LIFE_SECONDS = 6;
/** The hut stops making smoke here (the smoulder is out)... */
export const HUT_SMOKE_STOP_SECONDS = HUT_FIRE_BURN_SECONDS + 6;
/** ...and its last puff is gone here. */
export const HUT_SMOKE_END_SECONDS = HUT_SMOKE_STOP_SECONDS + HUT_SMOKE_LIFE_SECONDS;

/** The trail while it burns: up as the thatch catches, a little more as the fire spreads. */
const TRAIL_CATCH_SECONDS = 1.5;
const TRAIL_CATCH = 0.35;
const TRAIL_SPREAD = 0.15;
const TRAIL_SPREAD_SECONDS = 5;
/** The heavy plume swells as the flames die back (hut_fire_core.ts starts that at 6.5 s)... */
const PLUME_FROM = 6.5;
const PLUME_SECONDS = 2.5;
/** ...holds a moment after the last flame, then thins to nothing by HUT_SMOKE_STOP_SECONDS. */
const THIN_FROM = HUT_FIRE_BURN_SECONDS + 1;

/** A puff's peak opacity, at full output. */
const PEAK_ALPHA = 0.72;
/** How fast a fresh puff rises off the roof (yards a second, slowing as it cools). */
const RISE = 1.4;
/** The marsh breeze the plume leans on (world x, z yards a second, building with age). */
export const HUT_SMOKE_WIND = { x: -0.45, z: 0.3 } as const;

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function hash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** How much smoke the hut is making `age` seconds after it caught, 0 to 1. */
export function hutSmokeOutput(age: number): number {
  if (!(age >= 0) || age >= HUT_SMOKE_STOP_SECONDS) return 0;
  const trail =
    TRAIL_CATCH * smoothstep(age / TRAIL_CATCH_SECONDS) +
    TRAIL_SPREAD * smoothstep((age - TRAIL_CATCH_SECONDS) / TRAIL_SPREAD_SECONDS);
  const plume = smoothstep((age - PLUME_FROM) / PLUME_SECONDS);
  const thin = 1 - smoothstep((age - THIN_FROM) / (HUT_SMOKE_STOP_SECONDS - THIN_FROM));
  return Math.max(trail, plume) * thin;
}

/** One puff this moment (world yards): its middle, its size (the quad's side), its opacity (0
 *  while unborn or once the hut makes no more smoke) and its shade, 0 thick and dark to 1 thin
 *  and pale. */
export interface HutSmokePuff {
  x: number;
  y: number;
  z: number;
  size: number;
  alpha: number;
  shade: number;
}

/** Fill `out` with puff `i` (0 to HUT_SMOKE_PUFFS - 1) of `body`'s plume, `age` seconds after the
 *  hut caught. */
export function hutSmokePuffInto(
  i: number,
  age: number,
  body: HutFireBody,
  out: HutSmokePuff,
): HutSmokePuff {
  const life = HUT_SMOKE_LIFE_SECONDS;
  const clock = age + (i * life) / HUT_SMOKE_PUFFS;
  const cycle = Math.floor(clock / life);
  const puffAge = clock - cycle * life;
  const output = hutSmokeOutput(age - puffAge);
  const u = puffAge / life;
  const wa = hash(i, cycle);
  const wb = hash(cycle, i + 0.5);
  const wc = hash(i + 0.25, cycle + 0.75);
  const scale = body.height / 5;
  // born over the top of the thatch, anywhere across the upper roof
  const angle = wa * Math.PI * 2;
  const reach = body.radius * 0.55 * wc;
  // rising, slowing as it cools, carried off by the breeze, wandering as it goes
  const up = RISE * Math.sqrt(scale) * life * (u - 0.3 * u * u);
  const drift = puffAge ** 1.25;
  const wander = 0.4 + 1.6 * u;
  out.x = body.x + Math.sin(angle) * reach + HUT_SMOKE_WIND.x * drift + (wb - 0.5) * wander;
  out.y = body.y + body.height * (0.7 + 0.2 * wb) + up;
  out.z = body.z + Math.cos(angle) * reach + HUT_SMOKE_WIND.z * drift + (wc - 0.5) * wander;
  out.size = (1.4 + 4.6 * Math.sqrt(u) * (0.8 + 0.4 * wb)) * scale;
  // in quickly off the roof, a long thinning out
  const fadeIn = Math.min(1, u / 0.1);
  const fadeOut = (1 - u) ** 0.8;
  out.alpha = Math.min(1, output * PEAK_ALPHA * fadeIn * fadeOut * (0.8 + 0.4 * wa));
  // thick smoke is dark off the roof and greys as it spreads
  out.shade = Math.min(1, (1 - output) * 0.75 + u * 0.4);
  return out;
}
