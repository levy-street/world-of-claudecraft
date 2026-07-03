// PURE (unit-tested, Three-free): the water shore-depth sample. water.ts bakes
// this per vertex into the aShoreDepth attribute (foam band + shallow tint) at
// build time AND on every editor setLevel() rebuild, so both paths share one
// definition. It reads the ACTIVE water surface (waterLevel(): the custom
// map's override when one is loaded, else the built-in constant) against the
// same deterministic terrainHeight the sim uses. Registered in
// RENDER_PURE_CORES (tests/architecture.test.ts).
import { terrainHeight, waterLevel } from '../sim/world';

// Depth of the ACTIVE water surface above the terrain at (x, z): positive in
// open water, negative on dry land.
export function shoreDepthAt(x: number, z: number, seed: number): number {
  return waterLevel() - terrainHeight(x, z, seed);
}
