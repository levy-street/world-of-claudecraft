// The Quartered Isle's coast tables: the metaball land lobes and carved bays
// world.ts's quartered coast applier builds its landness field from (the
// ember_coast.ts pattern). Data-as-code; edit values here, the field math
// stays in world.ts. The sample point is domain-warped by up to ~23yd before
// it meets these discs, so a shore lands within that of the lobe's edge.
//
// The landmass: the Hoarbridge fused onto the Frostveil's north crown, the
// Hoarshelf's broad glacier shelf, Rivalmoot's hill at the heart, the
// Cinderscar and the Heavestone Wilds reaching out to their column crossings,
// and the Gyre's shoulders, which the world's north edge sea trims.
export const QUARTERED_LAND_LOBES = [
  { x: 22, z: 1952, r: 34 }, // the Hoarbridge's south footing, on the Reach's crown
  { x: 22, z: 1986, r: 36 }, // ...its north end, landing on the Hoarshelf
  { x: 0, z: 2034, r: 80 }, // the Hoarshelf
  { x: -72, z: 2042, r: 58 }, // ...its west shelf
  { x: 84, z: 2040, r: 58 }, // ...its east shelf
  { x: 22, z: 2096, r: 70 }, // the hill road's foot
  { x: -44, z: 2098, r: 74 }, // the Challengers' Ring's ground
  { x: 0, z: 2200, r: 92 }, // Rivalmoot's hill
  { x: 0, z: 2262, r: 82 }, // ...its north flank
  { x: -68, z: 2212, r: 52 }, // ...its west flank, toward the Wilds
  { x: 68, z: 2212, r: 52 }, // ...its east flank, toward the Cinderscar
  { x: 92, z: 2084, r: 50 }, // the burn's foot, joining the Hoarshelf
  { x: 108, z: 2148, r: 70 }, // the Cinderscar's south burn
  { x: 128, z: 2226, r: 66 }, // ...its heart
  { x: 92, z: 2290, r: 58 }, // ...its north glass fields
  { x: 162, z: 2086, r: 42 }, // ...the shoulder down to the Drakelands crossing
  { x: -108, z: 2148, r: 70 }, // the Heavestone Wilds' south slabs
  { x: -128, z: 2232, r: 66 }, // ...their canyon heart
  { x: -92, z: 2290, r: 58 }, // ...their north crags
  { x: -162, z: 2272, r: 42 }, // ...the shelf down to the Amberfall crossing
  { x: 0, z: 2322, r: 70 }, // the Gyre's foot
  { x: -48, z: 2334, r: 44 }, // ...its west shoulder
  { x: 48, z: 2334, r: 44 }, // ...its east shoulder
] as const;

export const QUARTERED_BAYS = [
  { x: -150, z: 2004, r: 46 }, // the Hoarshelf's west cove
  { x: 156, z: 2010, r: 46 }, // ...and its east cove
  { x: -164, z: 2330, r: 38 }, // a cove under the Heavestone's north crags
  { x: 166, z: 2330, r: 38 }, // a cove under the Cinderscar's glass fields
] as const;
