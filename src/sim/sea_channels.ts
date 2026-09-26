// Sea-channel carves: small bowls cut into the sea bed where a scheduled
// ship's lane (content/transport_ships.ts) squeezes through a neck narrower
// than its hull. The carve has a declared lake's basin shape (world.ts: full
// depth inside 0.55 R, easing to the natural height at 1.6 R, no shore
// wobble), but it is NOT a lake: the water over it is the open sea (the
// carved bed sits below the waterline, so isOpenSeaAt reads it as sea), so it
// adds no fishing water, no lilies or reeds, and no lake shore grading.
// world.ts terrain generation applies it right after the lake basins.
//
// Pure leaf: deterministic, no SimContext; the water level is passed in.

export interface SeaChannelCarve {
  x: number;
  z: number;
  radius: number;
}

export const SEA_CHANNEL_CARVES: readonly SeaChannelCarve[] = [
  // The Drakelands ferry's passage (route B): the east bank of the neck where
  // the deep Thornpeak water narrows into the Evergarden shallows, widened
  // about three yards so the hull clears both banks (owner-approved). Nothing
  // stood on the bank.
  { x: 542, z: 768.5, radius: 4.5 },
];

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The height `h` at (x, z) with every channel carve applied. */
export function carveSeaChannels(x: number, z: number, h: number, waterLevel: number): number {
  for (let i = 0; i < SEA_CHANNEL_CARVES.length; i++) {
    const c = SEA_CHANNEL_CARVES[i];
    const reach = c.radius * 1.6;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz >= reach * reach) continue;
    const blend = smoothstep(c.radius * 0.55, reach, Math.sqrt(dx * dx + dz * dz));
    h = h * blend + (waterLevel - 4) * (1 - blend);
  }
  return h;
}
