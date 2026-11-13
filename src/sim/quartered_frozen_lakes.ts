// The Hoarshelf's frozen lakes (quartered_landmarks.ts QUARTERED_FROZEN_LAKES)
// are slick: a player standing on one slides. The slide itself is the shared
// slippery-ground kernel (slippery_ground.ts): this module only decides who is
// on the ice and keeps the SLIPPERY_GROUND_AURA on them while they are, the
// same top-up pattern the Bonechill crypt's ice uses (encounters/hollow_crypt/
// lady_ice.ts stepSlick). The aura rides the wire with every other aura, so
// the server's movement override (server/movement_override_epoch.ts) treats
// the lake exactly like the crypt's ice online.
//
// Called once per player per tick from the environment step
// (environment_damage.ts). Draws no rng and reads no clock; a player nowhere
// near the isle costs one bounds check.

import { frozenLakeAt, QUARTERED_FROZEN_LAKES } from './quartered_landmarks';
import { SLIPPERY_GROUND_AURA } from './slippery_ground';
import type { Entity } from './types';

/** The lake ice's grip (yd/s per second): half the crypt's rime, so a stop
 *  slides a good way on and a turn swings wide. */
export const FROZEN_LAKE_GRIP = 4;
/** The aura's player-visible name (re-localized by the client matcher,
 *  ui/sim_i18n.ts). */
export const FROZEN_LAKE_AURA_NAME = 'Slick Ice';
/** How far above the ice a player still counts as on it: a hop keeps the
 *  slide's momentum, a flight over the lake does not. */
const ON_ICE_HEIGHT = 2.5;

const LAKE_BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const l of QUARTERED_FROZEN_LAKES) {
    minX = Math.min(minX, l.x - l.r);
    maxX = Math.max(maxX, l.x + l.r);
    minZ = Math.min(minZ, l.z - l.r);
    maxZ = Math.max(maxZ, l.z + l.r);
  }
  return { minX, maxX, minZ, maxZ };
})();

/** True when (x, y, z) stands on (or just over) a frozen lake's ice. */
export function onFrozenLake(x: number, y: number, z: number): boolean {
  const b = LAKE_BOUNDS;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  const lake = frozenLakeAt(x, z);
  return lake !== null && y <= lake.y + ON_ICE_HEIGHT;
}

/** Put the slick on a player standing on a frozen lake; take OUR slick off
 *  one who left it (an aura some other source put on is never touched). */
export function updateFrozenLakeSlick(p: Entity): void {
  const idx = p.auras.findIndex((a) => a.id === SLIPPERY_GROUND_AURA);
  const ours = idx >= 0 && p.auras[idx].name === FROZEN_LAKE_AURA_NAME;
  const on = !p.dead && p.carriedBy === undefined && onFrozenLake(p.pos.x, p.pos.y, p.pos.z);
  if (!on) {
    if (ours) p.auras = p.auras.filter((_, i) => i !== idx);
    return;
  }
  if (idx >= 0) {
    // Topped up only now and then (each top-up moves the deadline on the
    // wire): the removal above is immediate anyway.
    if (ours && p.auras[idx].remaining < 0.5) p.auras[idx].remaining = 1.5;
    return;
  }
  p.auras.push({
    id: SLIPPERY_GROUND_AURA,
    name: FROZEN_LAKE_AURA_NAME,
    kind: 'slow',
    remaining: 1.5,
    duration: 1.5,
    value: 1,
    value2: FROZEN_LAKE_GRIP,
    sourceId: p.id,
    school: 'frost',
    undispellable: true,
  });
}
