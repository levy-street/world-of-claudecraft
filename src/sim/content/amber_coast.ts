// The Amberfall's coast tables: the metaball land lobes and carved bays
// world.ts's amber coast applier builds its landness field from (the
// ember_coast.ts pattern). Data-as-code, moved verbatim out of world.ts under
// the monolith ratchet; edit values here, the field math stays in world.ts.
export const AMBER_LAND_LOBES = [
  { x: -350, z: 1850, r: 60 }, // the Goldmelt pass mouth
  { x: -420, z: 1880, r: 70 }, // the arrival shelf west of the pass
  { x: -340, z: 1910, r: 80 }, // the south weald
  { x: -260, z: 1950, r: 65 }, // Harvest Hollow's shelf
  { x: -305, z: 1985, r: 50 }, // the harvest road's field saddle
  { x: -450, z: 2010, r: 75 }, // the Gilded Orchard
  { x: -400, z: 1950, r: 55 }, // the Rootway road's meadow saddle
  { x: -360, z: 2040, r: 90 }, // Lanternmere's shore
  { x: -360, z: 2130, r: 95 }, // the Great Mere basin
  { x: -440, z: 2210, r: 70 }, // Cindermaple Rise
  { x: -265, z: 2220, r: 70 }, // the Monolith heath
  { x: -360, z: 2300, r: 85 }, // the north crown
  { x: -380, z: 2355, r: 55 }, // the Amberfen Steps' northern footing
  { x: -268, z: 2232, r: 40 }, // the mere lurkers' reeded shore
  { x: -306, z: 2160, r: 44 }, // the east mere road's shoulder
  { x: -490, z: 1852, r: 48 }, // the Goldmelt Water's west cap, amber side
  { x: -230, z: 1852, r: 48 }, // the Goldmelt Water's east cap, amber side
  { x: -210, z: 1896, r: 46 }, // ...joined to Harvest Hollow's shelf
  { x: -492, z: 2344, r: 50 }, // the Amber Broads' west cap, amber side
  { x: -465, z: 2290, r: 46 }, // ...joined to the north crown and Cindermaple Rise
  { x: -198, z: 2352, r: 50 }, // the southeast corner knot, amber quarter
  { x: -225, z: 2280, r: 48 }, // ...joined to the Monolith heath
] as const;
export const AMBER_BAYS = [
  { x: -190, z: 2080, r: 55 }, // the east sound
  { x: -530, z: 2120, r: 55 }, // the west reach
  { x: -320, z: 2375, r: 45 }, // the north cove
] as const;
