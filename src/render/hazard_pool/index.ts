// Hazard pools: dense, glossy tar on the floor that a player must keep out of.
// Static dressing (a room's authored pools) and boss-dropped pools share one
// look and one shader program. See ./CLAUDE.md.

export {
  DYNAMIC_HAZARD_POOL_SLOTS,
  DynamicHazardPools,
  type HazardPoolCompileGate,
  type HazardPoolGroundSample,
} from './dynamic_pools';
export {
  HAZARD_POOL_DRAIN_SEC,
  HAZARD_POOL_ISLAND_TOP,
  HAZARD_POOL_LOOKS,
  type HazardPoolLook,
  type HazardPoolPhase,
  hazardPoolEdgeMargin,
  hazardPoolPeak,
  hazardPoolPhase,
  litanyHazardStyle,
} from './hazard_pool_core';
export type { HazardPoolShape } from './hazard_pool_mesh';
export { placeHazardPools, type StaticHazardPool } from './static_pools';
