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
  { x: 0, z: 2346, r: 70 }, // the Gyre's foot
  { x: -48, z: 2358, r: 44 }, // ...its west shoulder
  { x: 48, z: 2358, r: 44 }, // ...its east shoulder
  { x: 0, z: 2382, r: 42 }, // ...and its north face, kept off the sea
  // the flanks the isle claims from the columns (x 180..250 each side), so
  // the Cinderscar and the Wilds run on over open land into their mainlands
  { x: 204, z: 2128, r: 52 }, // the Cinderscar's rift end
  { x: 212, z: 2196, r: 56 }, // ...its burnways' heads
  { x: 206, z: 2262, r: 54 }, // ...the north burnway
  { x: 176, z: 2324, r: 42 }, // ...the glass crags
  { x: -204, z: 2128, r: 52 }, // the Wilds' canyon mouth
  { x: -212, z: 2196, r: 56 }, // ...the heaved slabs
  { x: -206, z: 2262, r: 54 }, // ...the crossing shelf
  { x: -176, z: 2324, r: 42 }, // ...the north crags
  { x: 166, z: 2166, r: 42 }, // the burnways' middle ground (a low gap filled)
  { x: 172, z: 2276, r: 38 }, // ...and the north burnway's
  { x: -118, z: 2300, r: 32 }, // the Fallen Giant's crag
  { x: -150, z: 2176, r: 52 }, // the Hammer's Cut's ground (the old inlet filled)
  { x: -176, z: 2120, r: 46 }, // ...its south rim
  { x: -112, z: 2016, r: 36 }, // the west shelf's south edge
  { x: -170, z: 2036, r: 40 }, // the Hoarshelf's west shoulder (its frozen lake)
  { x: -140, z: 2070, r: 34 }, // ...joined north to the Wilds' south slabs
  { x: 172, z: 2030, r: 38 }, // the Hoarshelf's east shoulder (its frozen lake)
  { x: 150, z: 2062, r: 32 }, // ...joined north to the rift's shoulder
] as const;

export const QUARTERED_BAYS = [
  { x: -218, z: 1990, r: 30 }, // the Hoarshelf's west cove, past its shoulder
  { x: 106, z: 1990, r: 26 }, // ...and its east cove, under the rift's head
  { x: -164, z: 2330, r: 38 }, // a cove under the Heavestone's north crags
  { x: 166, z: 2330, r: 38 }, // a cove under the Cinderscar's glass fields
] as const;
