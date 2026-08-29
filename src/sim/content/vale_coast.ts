// Eastbrook Vale's coast tables: the metaball land lobes and carved bays
// world.ts's vale coast applier builds its landness fields from (see the
// banner comment above applyValeCoast there). Data-as-code, extracted from
// world.ts under the monolith ratchet; edit values here, the field math
// stays in world.ts.
export const VALE_LAND_LOBES = [
  { x: 0, z: 30, r: 128 }, // the heartland: the town, the roads, the fields
  { x: 0, z: 155, r: 100 }, // the north reach to the Mirefen border
  { x: -95, z: 170, r: 52 }, // ...its northwest fill (the border stays land)
  { x: 95, z: 170, r: 52 }, // ...and northeast fill
  { x: -168, z: 172, r: 42 }, // the northwest border corner
  { x: 168, z: 172, r: 42 }, // the northeast border corner
  { x: -100, z: 85, r: 70 }, // the western downs and Mirror Lake's shore
  { x: -95, z: -55, r: 70 }, // the southwest pastures (Grix's tunnel)
  { x: -18, z: -106, r: 59 }, // the harbor basin: New Eastbrook's reserved plat (south half; trimmed twice so the sea meets the town, owner refinements)
  { x: -52, z: -96, r: 53 }, // the harbor basin's east reach (closes the old lagoon)
  { x: 45, z: -85, r: 84 }, // the south fields (the bandit camp)
  { x: 108, z: -52, r: 60 }, // the southwest rise (mogger's hollow)
  { x: 100, z: 70, r: 62 }, // the west meadows
  { x: 60, z: 138, r: 55 }, // Brightwood Glade's north wood
  { x: 150, z: -46, r: 44 }, // the west point: the causeway's mainland root
] as const;
export const VALE_BAYS = [
  { x: -112, z: -52, r: 40 }, // New Eastbrook's harbor cove: carves the sea into the freed dig flank for the quay and ferry berth (site-plan.md section 3)
  { x: -192, z: 25, r: 60 }, // the west bay
  { x: 30, z: -196, r: 66 }, // the south bay
  { x: 196, z: 104, r: 56 }, // the east bay, north of the causeway
  { x: -142, z: -152, r: 48 }, // the southwest cove
  { x: -42, z: -180, r: 60 }, // the town-front shallows: pulls the strand up to New Eastbrook's doorstep (owner refinement round 3)
  { x: 178, z: -128, r: 42 }, // the south cove, east of the point
] as const;
