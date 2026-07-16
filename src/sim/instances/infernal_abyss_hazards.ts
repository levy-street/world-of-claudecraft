import { INFERNAL_ABYSS_LAYOUT } from '../dungeon_layout';
import type { SimContext } from '../sim_context';

const LAVA_POOL_RADIUS = 5;
const LAVA_FISSURE_HALF_WIDTH = 1.1;
const LAVA_FISSURE_HALF_LENGTH = 5;
const LAVA_DAMAGE_PCT = 0.08;

// Covers lava_moat, lava_pool, and lava_fissure. The two Maw lava_chasm decor
// pieces are DELIBERATELY not hazards: the maw_bridge walls keep players off
// them entirely, so they are scenery. If collision ever starts honouring
// visualOpenings across the Maw, add lava_chasm here in the same change.
export function infernalLavaAt(x: number, z: number): boolean {
  for (const decor of INFERNAL_ABYSS_LAYOUT.decor ?? []) {
    const scale = decor.scale ?? 1;
    const dx = x - decor.x;
    const dz = z - decor.z;
    if (decor.key === 'lava_moat') {
      const c = Math.cos(decor.yaw);
      const s = Math.sin(decor.yaw);
      const localX = dx * c - dz * s;
      const localZ = dx * s + dz * c;
      const rx = (decor.scaleX ?? 12) / 2;
      const rz = (decor.scaleZ ?? 12) / 2;
      const outer = (localX * localX) / (rx * rx) + (localZ * localZ) / (rz * rz);
      const innerScale = decor.innerScale ?? 0.68;
      const innerRx = rx * innerScale;
      const innerRz = rz * innerScale;
      const inner =
        (localX * localX) / (innerRx * innerRx) + (localZ * localZ) / (innerRz * innerRz);
      if (outer <= 1 && inner >= 1) return true;
      continue;
    }
    if (decor.key === 'lava_pool') {
      const radius = LAVA_POOL_RADIUS * scale;
      if (dx * dx + dz * dz <= radius * radius) return true;
      continue;
    }
    if (decor.key !== 'lava_fissure') continue;
    const c = Math.cos(decor.yaw);
    const s = Math.sin(decor.yaw);
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;
    if (
      Math.abs(localX) <= LAVA_FISSURE_HALF_WIDTH * (decor.scaleX ?? scale) &&
      Math.abs(localZ) <= LAVA_FISSURE_HALF_LENGTH * (decor.scaleZ ?? scale)
    ) {
      return true;
    }
  }
  return false;
}

export function tickInfernalAbyssLava(
  ctx: SimContext,
  origin: { x: number; z: number },
  // The instance-footprint envelope from the call site (updateInstances'
  // instanceContains): a player outside THIS instance can never be hit, even
  // if a future layout or slot-spacing change made a foreign player's local
  // coordinates land inside a lava footprint. Optional so the geometry tests
  // can drive the footprints directly.
  contains?: (pos: { x: number; z: number }) => boolean,
): void {
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (!player || player.dead) continue;
    if (contains && !contains(player.pos)) continue;
    const localX = player.pos.x - origin.x;
    const localZ = player.pos.z - origin.z;
    if (!infernalLavaAt(localX, localZ)) continue;
    const damage = Math.max(1, Math.round(player.maxHp * LAVA_DAMAGE_PCT));
    ctx.dealDamage(null, player, damage, false, 'fire', 'Abyssal Lava', 'hit', true);
  }
}
