// Dungeon interior layouts as plain numbers — the single source of truth for
// BOTH the visual module placement (src/render/dungeon.ts builds KayKit kit
// pieces from this) and the interior collision sets (src/sim/colliders.ts
// derives CRYPT_COLLIDERS/SANCTUM_COLLIDERS via layoutColliders). This kills
// the old hand-mirroring between renderer geometry and collider literals.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';

/**
 * The per-slot dressing roll for a wall-side obstacle: the ONE draw both the
 * renderer (which prop fills the slot) and the collider builder (how tall the
 * standable top is) consume, so mesh and physics can never disagree. Same
 * stable sine hash the renderer's prop jitter has always used.
 */
export function tombSlotRoll(x: number, z: number): number {
  const s = Math.sin(x * 3.7 * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Shared structural constants (instance-local coordinates, y up, z into the
// dungeon). Values are frozen gameplay contracts: mob spawns and pathing
// assume these exact footprints.
export const DUNGEON_WALL_X = 23; // side wall centreline (|x|)
export const DUNGEON_WALL_HW = 1; // wall half thickness
/** Walkable half-width inside side-wall colliders (instance-local x). */
export const DUNGEON_WALK_HALF_X = DUNGEON_WALL_X - DUNGEON_WALL_HW;
export const DUNGEON_END_WALL_HW = 24; // front/back wall half width
export const PILLAR_COLLIDER_R = 1.0; // centre-aisle pillar obstacle radius
export const TOMB_HW = 1.1; // wall-side obstacle (sarcophagus/cargo) half extents
export const TOMB_HD = 2.1;
export const DUNGEON_WALL_HEIGHT = 8; // visual module height (2x KayKit 4u walls)
/**
 * Boss dais height (yards): the foundation blocks the renderer stacks are 2u
 * pieces at 0.3 y-scale. The SIM treats this as real elevation (the interior
 * floor rises by it inside the dais radius, see `daisLiftAt`), so the boss
 * stands ON the stage instead of knee-deep in it, and a player strides up the
 * rim exactly like an open-world kerb (it sits inside MAX_STEP_HEIGHT).
 */
export const DAIS_HEIGHT = 0.6;

/**
 * Standable tops for the wall-side obstacle slots, measured from the shipped
 * dungeon-kit GLBs at the exact scales `render/dungeon.ts` places them
 * (gltf-transform dequantized bounds), so the surface a body lands on IS the
 * silhouette it sees. Per-slot variety keys off the SAME `hash2(x * 3.7, z)`
 * draw the renderer uses to pick the prop, so collider and mesh can never
 * disagree about which piece fills a slot.
 */
// Hollow Crypt / Nythraxis corners: coffin lids are HUMPS, not slabs. The
// plain coffin (1.322 native x 1.3 y-scale) crests 1.72 along its centre
// line and falls to a 1.10 plinth at the sides; the decorated one crests
// 1.17 over a 0.71 plinth. Ridge runs along the coffin's LENGTH (local z).
export const TOMB_COFFIN_PLAIN_TOP = 1.72;
export const TOMB_COFFIN_PLAIN_EAVE = 1.1;
export const TOMB_COFFIN_DECORATED_TOP = 1.17;
export const TOMB_COFFIN_DECORATED_EAVE = 0.71;
// Sunken Bastion cargo. The stacks are TWO TIERS, a natural staircase: a
// broad lower tier at stride-up height from the floor's jump, then a smaller
// top crate a stride above it (crates_stacked: 1.35 then 2.14 at 1.0 scale;
// box_stacked: 1.20 then 1.99 at 0.6). Tier offsets are the measured GLB
// top-crate centres. Rear casks: barrel_large 1.70 tall x 0.76 half-width at
// 0.85, keg 1.85 x 0.81 at 0.9 (radii trimmed slightly, as everywhere).
export const TOMB_CARGO_STACK_TOP = 2.14;
export const TOMB_CARGO_STACK_TIER = 1.35;
export const TOMB_CARGO_BOX_TOP = 1.99;
export const TOMB_CARGO_BOX_TIER = 1.2;
export const TOMB_CARGO_BARREL_TOP = 1.7;
export const TOMB_CARGO_KEG_TOP = 1.85;
export const TOMB_CARGO_STACK_HW = 1.0;
export const TOMB_CARGO_BARREL_R = 0.7;
export const TOMB_CARGO_KEG_R = 0.75;
/** Top-crate footprint and centre offset within each stack (GLB-measured,
 *  scaled): [dx, dz, halfW, halfD]. */
export const TOMB_CARGO_STACK_TIER2 = [-0.15, -0.38, 0.5, 0.33] as const;
export const TOMB_CARGO_BOX_TIER2 = [-0.48, -0.21, 0.21, 0.11] as const;

/**
 * How a dungeon dresses its wall-side obstacle slots, and therefore what the
 * matching colliders look like. `coffins` slots are a single standable lid;
 * `cargo` slots split into the crate stack and the cask the renderer actually
 * draws; absent, the slot stays the legacy full-height block (the temple's
 * candle shrines are altars, not furniture).
 */
export type TombDressing = 'coffins' | 'cargo';

export interface GridPoint {
  x: number;
  z: number;
}

export interface WallStub {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface DungeonLayout {
  /** front wall centreline (entrance end) */
  zMin: number;
  /** back wall centreline (boss end) */
  zMax: number;
  /** side-wall collider slab: z CENTRELINE of the slab's run (matches the
   *  legacy hand-authored extents) */
  sideWallZ: number;
  /** side-wall collider slab: z half-DEPTH of the slab's run. Despite the
   *  similar name this is a z extent, not an x one: the slab's |x| position
   *  comes from wallX / DUNGEON_WALL_X. A room can grow its sideWallHd (a
   *  longer wall) while its wallX stays frozen. */
  sideWallHd: number;
  /** centre-aisle pillar obstacles; torches mount on these */
  pillars: GridPoint[];
  /** wall-side obstacles — OBB TOMB_HW x TOMB_HD at rot 0 */
  tombs: GridPoint[];
  /** chamber-waist wall stubs (sanctum's three-chamber structure) */
  stubs: WallStub[];
  /** boss dais — walkable, deliberately NO collider */
  dais: { x: number; z: number; r: number };
  /**
   * True when the renderer stacks the DAIS_HEIGHT foundation platform on the
   * dais: the sim's interior floor rises to match (`daisLiftAt`). Absent on
   * the flat fighting floors (arena, the Nythraxis raid).
   */
  daisRaised?: boolean;
  /** Optional room width override for oversized rooms. Defaults to the classic crypt width. */
  wallX?: number;
  endWallHw?: number;
  floorHalfX?: number;
  /** entrance archway z position; renderer places gate props here when set */
  doorZ?: number;
  /** floor scatter positions, renderer places props here AND collision circles back them */
  clutter?: GridPoint[];
  /** Room shell outline (CCW, simple, star-shaped from `shellPole`), instance-local.
   * When present, render/collision derive the room's walls and floor mask from this
   * polygon instead of the rectangular wallX/zMin/zMax shell. */
  shellPolygon?: Array<{ x: number; z: number }>;
  /** Star-shaping pole paired with `shellPolygon` (see geometry2d.polygonIsStarShaped). */
  shellPole?: { x: number; z: number };
}

function grid(zFrom: number, zTo: number, zStep: number, xs: readonly number[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let z = zFrom; z <= zTo; z += zStep) {
    for (const x of xs) out.push({ x, z });
  }
  return out;
}

// The Hollow Crypt / Sunken Bastion room (both DungeonDef.interior 'crypt'):
// one long nave, z -19..112, pillar rows at +-14, sarcophagi at +-19.
export const CRYPT_LAYOUT: DungeonLayout = {
  zMin: -19,
  zMax: 112,
  sideWallZ: 47,
  sideWallHd: 66,
  pillars: grid(10, 100, 15, [-14, 14]),
  tombs: grid(16, 92, 19, [-19, 19]),
  stubs: [],
  dais: { x: 0, z: 96, r: 9.5 },
  daisRaised: true,
};

// Gravewyrm Sanctum: a stretched three-chamber crypt (z -19..158) with
// narrowed waists at z 67/115 leaving a ~10u centre passage at |x| <= 5.
export const SANCTUM_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 85, 100, 125, 140]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 67, hw: 9, hd: 5 }); // Boneworks -> Korgath's Hall
    stubs.push({ x: sx, z: 115, hw: 9, hd: 3 }); // Ritual Vault -> Wyrm's Hollow
  }
  return {
    zMin: -19,
    zMax: 158,
    sideWallZ: 69.5,
    sideWallHd: 89,
    pillars,
    tombs: [],
    stubs,
    dais: { x: 0, z: 146, r: 11.5 },
    daisRaised: true,
  };
})();

// Nythraxis' Abandoned Crypt raid room: a long dark nave ending in one large
// fighting arena. It stays within the shared wall-width contract, but leaves the
// central floor open so ten players can spread, stack, and reach three wardstones.
export const NYTHRAXIS_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [18, 38, 60, 82, 106]) {
    for (const x of [-90, -45, 45, 90]) pillars.push({ x, z });
  }
  return {
    zMin: -19,
    zMax: 126,
    sideWallZ: 53.5,
    sideWallHd: 73,
    wallX: 230,
    endWallHw: 231,
    floorHalfX: 228,
    pillars,
    tombs: [
      { x: -210, z: 20 },
      { x: 210, z: 20 },
      { x: -210, z: 42 },
      { x: 210, z: 42 },
      { x: -210, z: 64 },
      { x: 210, z: 64 },
    ],
    stubs: [],
    dais: { x: 0, z: 96, r: 13.5 },
  };
})();

// The Drowned Temple (interior 'temple'): a two-part flooded temple — a long
// antechamber, a single chamber-waist arch at z 66 (10u centre passage), then
// the moon-sanctum with Ysolei's great altar dais. Side walls at |x|=23 like
// the crypt so the KayKit wall modules fit unchanged; wall-side slots carry
// drowned reliquary altars instead of sarcophagi.
export const TEMPLE_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 80, 95, 110]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 66, hw: 9, hd: 4 }); // antechamber -> moon-sanctum
  }
  return {
    zMin: -19,
    zMax: 132,
    sideWallZ: 56.5,
    sideWallHd: 75.5,
    pillars,
    tombs: grid(18, 40, 22, [-19, 19]), // reliquary altars hugging the antechamber walls
    stubs,
    dais: { x: 0, z: 116, r: 10.5 },
    daisRaised: true,
  };
})();

// The Ashen Coliseum (interior 'arena'): a fully-enclosed pit, no door, no
// aisle (combatants are teleported in by matchmaking). Side walls stay at
// |x|=23 like the crypt so the KayKit wall modules fit unchanged; the pit
// grows along z only, tuned for 1v1/2v2 (deliberately NOT large). The dais
// marker only drives the central floor glow (the renderer skips its platform
// for the arena), so the ring itself stays flat.
// Cover intent: an approach screen in front of each spawn breaks line of
// sight for caster openers, the centre diamond gives fighters a post to
// orbit around mid-bout, and the side-lane walls cover flanking runs. Every
// obstacle is mirror-symmetric about BOTH x=0 and z=2 so neither side is
// favoured; each approach screen's outer end is capped by a mid-field post
// (the sub-player gap between them is sealed, they read as one L-shaped
// cover piece).
export const ARENA_LAYOUT: DungeonLayout = {
  zMin: -24,
  zMax: 28,
  sideWallZ: 2,
  // z half-DEPTH of the side-wall slabs (26 spans zMin..zMax exactly); their
  // |x| stays the frozen DUNGEON_WALL_X = 23, a different axis entirely.
  sideWallHd: 26,
  pillars: [
    // corner pillars anchoring the four quadrants (every pillar mounts a torch)
    { x: -14, z: -14 },
    { x: 14, z: -14 },
    { x: -14, z: 18 },
    { x: 14, z: 18 },
    // mid-field posts capping the approach screens' outer ends
    { x: -9, z: -8 },
    { x: 9, z: -8 },
    { x: -9, z: 12 },
    { x: 9, z: 12 },
    // centre diamond around the dais glow, for centre orbiting
    { x: 0, z: -4 },
    { x: 0, z: 8 },
    { x: -6, z: 2 },
    { x: 6, z: 2 },
  ],
  tombs: [],
  stubs: [
    // narrow flanking cover walls along the side lanes, mirrored about z=2
    { x: -11, z: 2, hw: 0.6, hd: 5 },
    { x: 11, z: 2, hw: 0.6, hd: 5 },
    // approach screens: LoS breakers between each spawn and the centre
    { x: -5, z: -10, hw: 3, hd: 0.6 },
    { x: 5, z: -10, hw: 3, hd: 0.6 },
    { x: -5, z: 14, hw: 3, hd: 0.6 },
    { x: 5, z: 14, hw: 3, hd: 0.6 },
  ],
  dais: { x: 0, z: 2, r: 8 },
};

// The Drowned Court (interior 'arena', ODD slots): the second arena map, a
// flooded-temple counterpart to the Coliseum. Identical bounds and the same
// frozen |x|=23 walls, but a completely different cover grammar: two straight
// colonnades of five pillars each form a centre nave and two side aisles
// (lane-and-LoS chess, deliberately distinct from the Coliseum's scattered
// screens), with a reliquary block midway along each aisle as the only extra
// cover. No stubs; the dais is a smaller moonlit glow. Mirror-symmetric about
// BOTH x=0 and z=2, like the Coliseum.
export const DROWNED_COURT_LAYOUT: DungeonLayout = {
  zMin: -24,
  zMax: 28,
  sideWallZ: 2,
  sideWallHd: 26,
  // two colonnades at x=-8/8, z stepped by 8 and centred on the z=2 mirror
  pillars: grid(-14, 18, 8, [-8, 8]),
  // reliquary altars midway along each aisle, mirrored about both axes
  tombs: [
    { x: -16, z: -8 },
    { x: 16, z: -8 },
    { x: -16, z: 12 },
    { x: 16, z: 12 },
  ],
  stubs: [],
  dais: { x: 0, z: 2, r: 6 },
};

// Combatant spawn points (instance-local), at opposite ends facing each other,
// each behind its team's approach screen with a clear zone around it.
export const ARENA_SPAWN_A = { x: 0, z: -18, facing: 0 }; // faces +z toward B
export const ARENA_SPAWN_B = { x: 0, z: 22, facing: Math.PI }; // faces -z toward A

// 2v2: two fighters per side, spread along x.
export const ARENA_SPAWNS_A_2v2 = [
  { x: -7, z: -18, facing: 0 },
  { x: 7, z: -18, facing: 0 },
];
export const ARENA_SPAWNS_B_2v2 = [
  { x: -7, z: 22, facing: Math.PI },
  { x: 7, z: 22, facing: Math.PI },
];

// ---------------------------------------------------------------------------
// Arena maps: each world arena slot hosts one FIXED map, selected by slot
// parity (EVEN slots = Ashen Coliseum, ODD slots = The Drowned Court). The
// mapping is static at boot: colliders and render geometry per slot never
// change, and no selection here ever touches rng. Spawns are plumbed per map
// (not shared constants) so future maps can place them differently.
// ---------------------------------------------------------------------------

export type ArenaMapId = 'coliseum' | 'drowned_court';

export interface ArenaSpawnPoint {
  x: number;
  z: number;
  facing: number;
}

export interface ArenaMapDef {
  id: ArenaMapId;
  layout: DungeonLayout;
  spawnA: ArenaSpawnPoint;
  spawnB: ArenaSpawnPoint;
  spawnsA2v2: ArenaSpawnPoint[];
  spawnsB2v2: ArenaSpawnPoint[];
}

// The Drowned Court's 2v2 spread is +-5 (narrower than the Coliseum's +-7):
// the colonnade pillars at (+-8, -14/18) sit closer to the spawn line, and
// +-5 keeps the 4yd spawn clear zone the layout tests pin.
const DROWNED_COURT_MAP: ArenaMapDef = {
  id: 'drowned_court',
  layout: DROWNED_COURT_LAYOUT,
  spawnA: { x: 0, z: -18, facing: 0 },
  spawnB: { x: 0, z: 22, facing: Math.PI },
  spawnsA2v2: [
    { x: -5, z: -18, facing: 0 },
    { x: 5, z: -18, facing: 0 },
  ],
  spawnsB2v2: [
    { x: -5, z: 22, facing: Math.PI },
    { x: 5, z: 22, facing: Math.PI },
  ],
};

const COLISEUM_MAP: ArenaMapDef = {
  id: 'coliseum',
  layout: ARENA_LAYOUT,
  spawnA: ARENA_SPAWN_A,
  spawnB: ARENA_SPAWN_B,
  spawnsA2v2: ARENA_SPAWNS_A_2v2,
  spawnsB2v2: ARENA_SPAWNS_B_2v2,
};

/** index = slot parity: even slots Coliseum, odd slots Drowned Court. */
export const ARENA_MAPS: readonly [ArenaMapDef, ArenaMapDef] = [COLISEUM_MAP, DROWNED_COURT_MAP];

export function arenaMapForSlot(slot: number): ArenaMapDef {
  return ARENA_MAPS[((slot % 2) + 2) % 2];
}

/**
 * The interior floor's rise above the flat room floor at an instance-local
 * point: DAIS_HEIGHT inside a raised boss dais, zero elsewhere. This is the
 * sim half of the platform the renderer stacks; `world.ts` groundHeight adds
 * it, so mobs, spawns, loot, landings, and the camera all stand on the stage.
 */
export function daisLiftAt(layout: DungeonLayout, lx: number, lz: number): number {
  if (!layout.daisRaised) return 0;
  const d = layout.dais;
  const dx = lx - d.x;
  const dz = lz - d.z;
  return dx * dx + dz * dz <= d.r * d.r ? DAIS_HEIGHT : 0;
}

/**
 * Interior collision set for a layout, in instance-local coordinates.
 * `dressing` describes what the renderer stands in the tomb slots for this
 * dungeon, and therefore what the slots' colliders are: coffins are one
 * standable lid (per-slot height from the same hash the renderer draws),
 * cargo splits into the crate stack and the cask, and no dressing keeps the
 * legacy full-height block. `floorY` absolutizes the standable tops (the
 * interior floor constant; instance-local props all sit on it).
 */
export function layoutColliders(
  layout: DungeonLayout,
  dressing?: TombDressing,
  floorY = 0,
): Collider[] {
  const out: Collider[] = [];
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
  // side walls
  for (const sx of [-wallX, wallX]) {
    out.push({
      type: 'obb',
      x: sx,
      z: layout.sideWallZ,
      hw: DUNGEON_WALL_HW,
      hd: layout.sideWallHd,
      rot: 0,
    });
  }
  // back wall, then front wall (entrance porch: chase cam fits inside)
  out.push({ type: 'obb', x: 0, z: layout.zMax, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
  out.push({ type: 'obb', x: 0, z: layout.zMin, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
  // chamber waists
  for (const s of layout.stubs)
    out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  // pillar obstacles
  for (const p of layout.pillars)
    out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  // Wall-side obstacle slots (the boss dais is walkable: no collider). The
  // per-slot draw is `tombSlotRoll`, the same roll the renderer picks the
  // prop with, so the collider always matches the piece filling the slot.
  for (const t of layout.tombs) {
    const r = tombSlotRoll(t.x, t.z);
    if (dressing === 'coffins') {
      // The lid is a hump ridging along the coffin's length: standing feet
      // ride the crest at the centre line and the plinth at the sides.
      const plain = r < 0.55;
      const top = plain ? TOMB_COFFIN_PLAIN_TOP : TOMB_COFFIN_DECORATED_TOP;
      const eave = plain ? TOMB_COFFIN_PLAIN_EAVE : TOMB_COFFIN_DECORATED_EAVE;
      out.push({
        type: 'obb',
        x: t.x,
        z: t.z,
        hw: TOMB_HW,
        hd: TOMB_HD,
        rot: 0,
        moveTopY: floorY + top,
        standable: true,
        topSlope: {
          kind: 'ridge',
          axis: 'z',
          pitch: (top - eave) / TOMB_HW,
          eaveY: floorY + eave,
        },
      });
    } else if (dressing === 'cargo') {
      // Front stack (two tiers, the measured natural staircase) and the rear
      // cask, at the offsets the renderer uses, with the walkable gap
      // between them the player can now see AND use.
      const crates = r < 0.5;
      const tierTop = crates ? TOMB_CARGO_STACK_TIER : TOMB_CARGO_BOX_TIER;
      const stackTop = crates ? TOMB_CARGO_STACK_TOP : TOMB_CARGO_BOX_TOP;
      const tier2 = crates ? TOMB_CARGO_STACK_TIER2 : TOMB_CARGO_BOX_TIER2;
      out.push({
        type: 'obb',
        x: t.x,
        z: t.z - 1.0,
        hw: TOMB_CARGO_STACK_HW,
        hd: TOMB_CARGO_STACK_HW,
        rot: 0,
        moveTopY: floorY + tierTop,
        standable: true,
      });
      out.push({
        type: 'obb',
        x: t.x + tier2[0],
        z: t.z - 1.0 + tier2[1],
        hw: tier2[2],
        hd: tier2[3],
        rot: 0,
        moveTopY: floorY + stackTop,
        standable: true,
      });
      out.push({
        type: 'circle',
        x: t.x + (crates ? 0.1 : -0.1),
        z: t.z + 1.3,
        r: crates ? TOMB_CARGO_BARREL_R : TOMB_CARGO_KEG_R,
        moveTopY: floorY + (crates ? TOMB_CARGO_BARREL_TOP : TOMB_CARGO_KEG_TOP),
        standable: true,
      });
    } else {
      out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
    }
  }
  // floor clutter props (small circle per scatter point; renderer places matching props)
  for (const c of layout.clutter ?? []) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  return out;
}
