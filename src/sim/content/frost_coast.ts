// The Frostveil Reach's coast tables: the metaball land lobes and carved bays
// world.ts's frost coast applier builds its landness field from (the
// ember_coast.ts pattern). Data-as-code, moved verbatim out of world.ts under
// the monolith ratchet; edit values here, the field math stays in world.ts.
export const FROST_LAND_LOBES = [
  { x: 0, z: 1460, r: 95 }, // the south rim: Heartfrost Cavern's shelf
  { x: -120, z: 1475, r: 60 }, // western wall footing
  { x: 120, z: 1475, r: 60 }, // eastern wall footing
  { x: 0, z: 1500, r: 85 }, // the rim benches
  { x: -40, z: 1630, r: 90 }, // the Icemantle massif
  { x: -30, z: 1558, r: 45 }, // the town shelf under Icemantle itself
  { x: 80, z: 1600, r: 75 }, // Glacier Tarn's shoulder
  { x: 30, z: 1670, r: 65 }, // the inner valley joining the tarn to the Steps
  { x: 20, z: 1750, r: 95 }, // the Aurora Steps
  { x: -100, z: 1720, r: 70 }, // the Shiverfen shelf
  { x: -68, z: 1806, r: 46 }, // the Goldmelt road's first shoulder off the Steps
  { x: -120, z: 1820, r: 48 }, // the west shore's rise under the Goldmelt road
  { x: -132, z: 1856, r: 40 }, // ...its mid rise
  { x: -158, z: 1872, r: 44 }, // the Goldmelt's ice-side shoulder
  { x: -162, z: 1930, r: 48 }, // the Palewater's north cap, ice side
  { x: 120, z: 1790, r: 65 }, // the Howling Terraces
  { x: 158, z: 1852, r: 44 }, // the Snowline's ice-side shoulder
  { x: 116, z: 1744, r: 42 }, // the tarn road's eastern shoulder
  { x: 0, z: 1870, r: 80 }, // the north crown
  { x: 10, z: 1945, r: 50 }, // the Goldmelt corridor's south footing
  { x: 146, z: 1700, r: 44 }, // the Snowline crossing's ice-side shoulder
  { x: 108, z: 1700, r: 42 }, // ...rising onto the benches
  { x: 54, z: 1638, r: 42 }, // the crossing road's bench shoulder
  { x: 98, z: 1672, r: 40 }, // ...stepping down toward the border
  { x: 86, z: 1824, r: 42 }, // the terrace road's north shoulder
  { x: 42, z: 1674, r: 40 }, // the tarn road's southern loop
  { x: 78, z: 1694, r: 38 }, // ...meeting the crossing shoulder
  { x: 162, z: 1468, r: 48 }, // the Meltwater's south cap, ice side
  { x: 162, z: 1930, r: 48 }, // the Meltwater's north cap, ice side
  { x: 102, z: 1888, r: 46 }, // the shore between the Terraces and the crown, closing the cap
  { x: -60, z: 1958, r: 40 }, // the north crown's headlands push into the bay...
  { x: 44, z: 1962, r: 36 }, // ...and a second, so the north shore is lobed
  { x: -30, z: 1452, r: 46 }, // the south shore's rise east of the Wyrmgate
  { x: 70, z: 1450, r: 42 }, // ...and its east headland over the sound
  { x: 52, z: 1974, r: 26 }, // a north-center headland east of the new cove
] as const;
export const FROST_BAYS = [
  { x: 165, z: 1660, r: 55 }, // the east sound
  { x: -165, z: 1580, r: 50 }, // the west inlet
  { x: 60, z: 1945, r: 50 }, // the north cove
  { x: -108, z: 1952, r: 40 }, // ...and a second cove, west of the crown
  { x: 8, z: 1470, r: 40 }, // a south cove biting the shore east of the Wyrmgate
  { x: 24, z: 1976, r: 34 }, // a cove splitting the flat north-center headland
] as const;
