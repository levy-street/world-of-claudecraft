// Last Bell story-instance areas: the pure geometry contract for every
// private story space the Farshore campaign stamps onto the dungeon
// instance pool ('farshore_story' interiors). One config drives all three
// consumers, so they can never drift:
//   - sim terrain: world.ts groundHeight dispatches per area (a MIRROR area
//     re-samples the island's own terrainHeight at srcX/srcZ + local offset,
//     so a private copy of the Riftfields stands on ground identical to the
//     shared island; an AUTHORED area displaces the flat instance plane)
//   - sim collision: colliders.ts builds per-area walls + prop circles
//   - render: the story interior builder places the same props and displaces
//     its ground mesh with the same heights
// All coordinates are instance-local and stay inside the 500 yd slot
// contract (the instance footprint check is +-120 x / +-250 z).
//
// This is a pure leaf (no SimContext, no world.ts import: world.ts imports
// THIS module, and mirror areas are resolved inside groundHeight where
// terrainHeight is local, so no cycle exists).

export interface StoryAreaWall {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface StoryAreaProp {
  kind:
    | 'lb_mill_stone'
    | 'lb_mill_post'
    | 'lb_vault_pillar'
    | 'lb_vault_bell'
    | 'lb_dream_spire'
    | 'lb_heart_collar'
    | 'lb_watchstone'
    | 'lb_willow'
    | 'lb_name_stone_plot'
    | 'lb_charge_sled'
    | 'lb_ward_anchor';
  x: number;
  z: number;
  r: number; // collider radius (yards)
  h: number; // camera-occlusion top height (yards)
  rot?: number;
  scale?: number;
}

export interface StoryAreaDef {
  dungeonId: string;
  /** Instance-local (0,0) maps to this shared-island point; terrain heights
   * are re-sampled there so the private copy matches the real ground. */
  mirror?: { srcX: number; srcZ: number };
  /** Authored displacement off the flat instance plane (mutually exclusive
   * with mirror). Pure fn of instance-local coords. */
  height?: (lx: number, lz: number) => number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  walls: readonly StoryAreaWall[];
  props: readonly StoryAreaProp[];
  /** Claim per durable character even in a party (Q0's mill, The Last
   * Watch, the Willowfen epilogue: the moment must be earned personally). */
  soloClaim: boolean;
  /** Ambient palette key for the render builder (sky tint, fog). */
  mood: 'day' | 'dusk' | 'night' | 'vault' | 'dream';
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function perimeterWalls(b: StoryAreaDef['bounds']): StoryAreaWall[] {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const hw = (b.maxX - b.minX) / 2;
  const hd = (b.maxZ - b.minZ) / 2;
  return [
    { x: b.minX, z: cz, hw: 1, hd: hd + 1 },
    { x: b.maxX, z: cz, hw: 1, hd: hd + 1 },
    { x: cx, z: b.minZ, hw: hw + 1, hd: 1 },
    { x: cx, z: b.maxZ, hw: hw + 1, hd: 1 },
  ];
}

// The Tidemill's one room: flat mill floor, the stone in the center. The
// boss fight webs the exits; the space is small on purpose (Q0's climax is
// personal, not epic).
function tidemillHeight(_lx: number, _lz: number): number {
  return 0;
}

// The drowned first redoubt: a fighting descent. Four shelf drops from the
// rope entry (z 0) down to the founding bell chamber (z past 150, 12 yards
// below the entry), so "climb out ahead of the tide" reads in the legs.
function vaultHeight(_lx: number, lz: number): number {
  return -(
    3.2 * smoothstep(10, 40, lz) +
    3.4 * smoothstep(50, 80, lz) +
    2.7 * smoothstep(90, 120, lz) +
    2.7 * smoothstep(130, 150, lz)
  );
}

// Inside the breach: one vast hollow of dream-stone, open ground all the way
// to the heart (the wrongness is the light, never the navigation). A shallow
// basin centered on the heart with a gentle rim; the exterior threshold strip
// (lz < -30) stays level with the watchstone.
function breachHeight(lx: number, lz: number): number {
  const d = Math.hypot(lx / 95, (lz - 120) / 110);
  const basin = -4.2 * (1 - smoothstep(0.25, 1, d));
  const rim = 3.0 * smoothstep(0.86, 1.08, d) * smoothstep(-30, -10, lz);
  return basin + rim;
}

// Willowweep: a low mound under one willow, water-meadow flat around it.
function willowfenHeight(lx: number, lz: number): number {
  const d = Math.hypot(lx, lz);
  return 1.6 * (1 - smoothstep(6, 26, d));
}

export const LAST_BELL_AREAS: Record<string, StoryAreaDef> = {
  // Q0 climax: put down whatever is in the Tidemill. Solo, always.
  lb_tidemill: {
    dungeonId: 'lb_tidemill',
    height: tidemillHeight,
    bounds: { minX: -24, maxX: 24, minZ: -24, maxZ: 24 },
    walls: perimeterWalls({ minX: -24, maxX: 24, minZ: -24, maxZ: 24 }),
    props: [
      { kind: 'lb_mill_stone', x: 0, z: 4, r: 3.2, h: 1.6 },
      { kind: 'lb_mill_post', x: -12, z: -8, r: 0.7, h: 6 },
      { kind: 'lb_mill_post', x: 12, z: -8, r: 0.7, h: 6 },
      { kind: 'lb_mill_post', x: -12, z: 14, r: 0.7, h: 6 },
      { kind: 'lb_mill_post', x: 12, z: 14, r: 0.7, h: 6 },
    ],
    soloClaim: true,
    mood: 'dusk',
  },
  // Q1: the night rift-line: a private copy of the Watch Meadow and the
  // lower fields, walked at dusk with Coalfast and Tam.
  lb_riftline: {
    dungeonId: 'lb_riftline',
    mirror: { srcX: 372, srcZ: 2 },
    bounds: { minX: -100, maxX: 100, minZ: -80, maxZ: 120 },
    walls: perimeterWalls({ minX: -100, maxX: 100, minZ: -80, maxZ: 120 }),
    props: [],
    soloClaim: false,
    mood: 'night',
  },
  // Q3: the drowned first redoubt beneath the Sundered Cliffs.
  lb_vault: {
    dungeonId: 'lb_vault',
    height: vaultHeight,
    bounds: { minX: -22, maxX: 22, minZ: -12, maxZ: 190 },
    walls: [
      ...perimeterWalls({ minX: -22, maxX: 22, minZ: -12, maxZ: 190 }),
      // The fallen-room chicane: whole rooms on their sides narrow the way.
      { x: -12, z: 55, hw: 9, hd: 2 },
      { x: 13, z: 95, hw: 8, hd: 2 },
      { x: -13, z: 135, hw: 8, hd: 2 },
    ],
    props: [
      { kind: 'lb_vault_pillar', x: -16, z: 30, r: 1.4, h: 7 },
      { kind: 'lb_vault_pillar', x: 17, z: 70, r: 1.4, h: 7 },
      { kind: 'lb_vault_pillar', x: -17, z: 110, r: 1.4, h: 7 },
      // The founding bell, split, the Bellheart inside the split.
      { kind: 'lb_vault_bell', x: 0, z: 168, r: 4.2, h: 5 },
    ],
    soloClaim: false,
    mood: 'vault',
  },
  // Q4: the redoubt: council room, the mast, the mess. A private copy of
  // Gullhaven's headland so the council can sit while the town lives on.
  lb_council: {
    dungeonId: 'lb_council',
    mirror: { srcX: 306, srcZ: 66 },
    bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
    walls: perimeterWalls({ minX: -80, maxX: 80, minZ: -80, maxZ: 80 }),
    props: [],
    soloClaim: false,
    mood: 'dusk',
  },
  // Q6: the Landing beach and the tidal flats among the wrecks.
  lb_landing: {
    dungeonId: 'lb_landing',
    mirror: { srcX: 250, srcZ: 10 },
    bounds: { minX: -90, maxX: 60, minZ: -60, maxZ: 80 },
    walls: perimeterWalls({ minX: -90, maxX: 60, minZ: -60, maxZ: 80 }),
    props: [],
    soloClaim: false,
    mood: 'night',
  },
  // Q8: the Riftfields approach, ward site to ward site.
  lb_riftfields: {
    dungeonId: 'lb_riftfields',
    mirror: { srcX: 434, srcZ: 58 },
    bounds: { minX: -100, maxX: 100, minZ: -60, maxZ: 100 },
    walls: perimeterWalls({ minX: -100, maxX: 100, minZ: -60, maxZ: 100 }),
    props: [
      { kind: 'lb_ward_anchor', x: -70, z: -20, r: 1.2, h: 3 },
      { kind: 'lb_ward_anchor', x: 70, z: -10, r: 1.2, h: 3 },
      { kind: 'lb_ward_anchor', x: -55, z: 70, r: 1.2, h: 3 },
      { kind: 'lb_ward_anchor', x: 60, z: 75, r: 1.2, h: 3 },
    ],
    soloClaim: false,
    mood: 'day',
  },
  // Q9 to Q11: inside the breach, then the watchstone outside it. One
  // continuous instance: the threshold crossing at lz -30 is the walk from
  // Q10's retreat into Q11's ordinary night air.
  lb_breach: {
    dungeonId: 'lb_breach',
    height: breachHeight,
    bounds: { minX: -110, maxX: 110, minZ: -70, maxZ: 230 },
    walls: perimeterWalls({ minX: -110, maxX: 110, minZ: -70, maxZ: 230 }),
    props: [
      { kind: 'lb_dream_spire', x: -60, z: 60, r: 2.4, h: 14 },
      { kind: 'lb_dream_spire', x: 55, z: 90, r: 2.4, h: 14 },
      { kind: 'lb_dream_spire', x: -40, z: 170, r: 2.4, h: 14 },
      { kind: 'lb_dream_spire', x: 70, z: 150, r: 2.4, h: 14 },
      { kind: 'lb_heart_collar', x: 0, z: 120, r: 5.0, h: 3 },
      { kind: 'lb_watchstone', x: 0, z: -52, r: 2.0, h: 3.4 },
    ],
    soloClaim: false,
    mood: 'dream',
  },
  // END: the quiet redoubt, post to post. Solo, always.
  lb_lastwatch: {
    dungeonId: 'lb_lastwatch',
    mirror: { srcX: 306, srcZ: 66 },
    bounds: { minX: -100, maxX: 100, minZ: -80, maxZ: 100 },
    walls: perimeterWalls({ minX: -100, maxX: 100, minZ: -80, maxZ: 100 }),
    props: [],
    soloClaim: true,
    mood: 'night',
  },
  // EPI: Willowweep in the Willowfen. Five stones under one willow. Solo.
  lb_willowfen: {
    dungeonId: 'lb_willowfen',
    height: willowfenHeight,
    bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
    walls: perimeterWalls({ minX: -40, maxX: 40, minZ: -40, maxZ: 40 }),
    props: [
      { kind: 'lb_willow', x: 0, z: 6, r: 1.8, h: 11 },
      { kind: 'lb_name_stone_plot', x: 0, z: 1, r: 0.01, h: 0.5 },
    ],
    soloClaim: true,
    mood: 'night',
  },
};

export const LAST_BELL_STORY_INTERIOR = 'farshore_story';
