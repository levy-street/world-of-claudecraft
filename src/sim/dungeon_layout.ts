// Dungeon interior layouts as plain numbers — the single source of truth for
// BOTH the visual module placement (src/render/dungeon.ts builds KayKit kit
// pieces from this) and the interior collision sets (src/sim/colliders.ts
// derives CRYPT_COLLIDERS/SANCTUM_COLLIDERS via layoutColliders). This kills
// the old hand-mirroring between renderer geometry and collider literals.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';
import {
  type AuthoredDecor,
  type AuthoredDoor,
  type AuthoredRoom,
  authoredDecorColliders,
  authoredWallSegments,
} from './dungeon_rooms';

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
  /** side-wall collider slab (matches the legacy hand-authored extents) */
  sideWallZ: number;
  sideWallHd: number;
  /** centre-aisle pillar obstacles; torches mount on these */
  pillars: GridPoint[];
  /** wall-side obstacles — OBB TOMB_HW x TOMB_HD at rot 0 */
  tombs: GridPoint[];
  /** chamber-waist wall stubs (sanctum's three-chamber structure) */
  stubs: WallStub[];
  /** boss dais — walkable, deliberately NO collider */
  dais: { x: number; z: number; r: number };
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
  /** Authored axis-aligned room graph used by bespoke dungeon interiors. */
  rooms?: AuthoredRoom[];
  /** Traversable openings cut from the authored room walls. */
  doors?: AuthoredDoor[];
  /** Interior structural walls, shared by rendering, collision, and the minimap. */
  barriers?: Array<WallStub & { style?: 'maze' | 'pit' }>;
  /** Room-wall cuts used only by rendering, for open drops backed by invisible collision. */
  visualOpenings?: AuthoredDoor[];
  /** Shared visual placement data with optional movement collision radii. */
  decor?: AuthoredDecor[];
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
  };
})();

// Infernal Abyss: a branching endgame descent through a lava maze and forge,
// across the Maw bridge, into the Heart Cairn. Side rooms remain optional for
// progression while their doors and collisions use the same authored source.
export const INFERNAL_ABYSS_LAYOUT: DungeonLayout = {
  zMin: -25,
  zMax: 232,
  sideWallZ: 103.5,
  sideWallHd: 128.5,
  wallX: 82,
  endWallHw: 82,
  floorHalfX: 82,
  pillars: [],
  tombs: [],
  stubs: [],
  dais: { x: 0, z: 222, r: 18 },
  rooms: [
    { id: 'ashen_descent_entrance', x0: -18, x1: 18, z0: -25, z1: 5 },
    { id: 'chainscar_descent', x0: -8, x1: 8, z0: 5, z1: 21 },
    { id: 'lower_forge_junction', x0: -18, x1: 18, z0: 21, z1: 35 },
    { id: 'lava_maze_approach', x0: -18, x1: -8, z0: 35, z1: 43 },
    { id: 'lava_maze', x0: -54, x1: 12, z0: 43, z1: 92 },
    { id: 'lost_armory', x0: -78, x1: -54, z0: 49, z1: 69 },
    { id: 'pyre_golem_crucible', x0: -82, x1: -54, z0: 72, z1: 94 },
    { id: 'infernal_forge', x0: -30, x1: 30, z0: 92, z1: 136 },
    { id: 'gladiator_pit', x0: 30, x1: 72, z0: 98, z1: 134 },
    { id: 'maw_approach', x0: -10, x1: 10, z0: 136, z1: 146 },
    { id: 'maw_bridge', x0: -5, x1: 5, z0: 146, z1: 178 },
    { id: 'heart_cairn_vestibule', x0: -12, x1: 12, z0: 178, z1: 188 },
    { id: 'heart_cairn_gate', x0: -16, x1: 16, z0: 188, z1: 195 },
    { id: 'heart_cairn_lower', x0: -32, x1: 32, z0: 195, z1: 202 },
    { id: 'heart_cairn_boss_arena', x0: -42, x1: 42, z0: 202, z1: 222 },
    { id: 'heart_cairn_crown', x0: -32, x1: 32, z0: 222, z1: 232 },
  ],
  doors: [
    { x: 0, z: 5, hw: 3.6, hd: 1 },
    { x: 0, z: 21, hw: 4, hd: 1 },
    { x: -13, z: 35, hw: 4, hd: 1 },
    { x: -13, z: 43, hw: 4, hd: 1 },
    { x: -54, z: 59, hw: 1, hd: 4 },
    { x: -54, z: 82, hw: 1, hd: 4 },
    { x: -20, z: 92, hw: 5, hd: 1 },
    { x: 30, z: 116, hw: 1, hd: 3.6 },
    { x: 0, z: 136, hw: 3.6, hd: 1 },
    { x: 0, z: 146, hw: 6.5, hd: 1 },
    { x: 0, z: 178, hw: 4, hd: 1 },
    { x: 0, z: 188, hw: 3.6, hd: 1 },
    { x: 0, z: 195, hw: 15, hd: 1 },
    { x: 0, z: 202, hw: 31, hd: 1 },
    { x: 0, z: 222, hw: 31, hd: 1 },
  ],
  barriers: [
    { x: -39, z: 54, hw: 13, hd: 1, style: 'maze' },
    { x: -25, z: 62, hw: 1, hd: 9, style: 'maze' },
    { x: -39, z: 70, hw: 10, hd: 1, style: 'maze' },
    { x: -43, z: 81, hw: 1, hd: 10, style: 'maze' },
    { x: -28, z: 84, hw: 6, hd: 1, style: 'maze' },
    { x: -14, z: 69, hw: 1, hd: 9, style: 'maze' },
    { x: -4, z: 58, hw: 9, hd: 1, style: 'maze' },
    { x: 1, z: 76, hw: 1, hd: 9, style: 'maze' },
    { x: -8, z: 86, hw: 9, hd: 1, style: 'maze' },
    { x: 52, z: 104, hw: 13, hd: 1, style: 'pit' },
    { x: 52, z: 128, hw: 13, hd: 1, style: 'pit' },
    { x: 39, z: 108.5, hw: 1, hd: 4.5, style: 'pit' },
    { x: 39, z: 124.5, hw: 1, hd: 3.5, style: 'pit' },
    { x: 65, z: 116, hw: 1, hd: 12, style: 'pit' },
  ],
  visualOpenings: [
    { x: -5, z: 162, hw: 1, hd: 14 },
    { x: 5, z: 162, hw: 1, hd: 14 },
  ],
  decor: [
    { key: 'lava_brazier', x: -12, z: -12, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 12, z: -12, yaw: Math.PI, r: 0.9 },
    { key: 'abyss_hanging_chain_cage', x: -13, z: -18, yaw: 0.18, r: 1.2 },
    { key: 'abyss_hanging_chain_cage', x: 13, z: -18, yaw: -0.18, r: 1.2 },
    { key: 'abyss_cracked_obsidian_floor_plate', x: 0, z: -14, yaw: 0 },
    { key: 'abyss_skull_bone_ossuary_pile', x: -14, z: -5, yaw: 0.35 },
    { key: 'abyss_skull_bone_ossuary_pile', x: 14, z: -1, yaw: -0.45 },
    { key: 'abyss_horned_wall_sconce', x: -17, z: -9, yaw: Math.PI / 2 },
    { key: 'abyss_horned_wall_sconce', x: 17, z: -9, yaw: -Math.PI / 2 },
    { key: 'infernal_portcullis', x: 0, z: 5, yaw: 0, scale: 1.55 },
    { key: 'lava_brazier', x: -6, z: 12, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 6, z: 18, yaw: Math.PI, r: 0.9 },
    { key: 'abyss_horned_guardian_statue', x: -13, z: 28, yaw: 0.2, r: 1.5 },
    { key: 'abyss_horned_guardian_statue', x: 13, z: 28, yaw: -0.2, r: 1.5 },
    { key: 'abyss_demonic_basalt_buttress', x: -16, z: 34, yaw: 0 },
    { key: 'abyss_demonic_basalt_buttress', x: 16, z: 34, yaw: 0 },

    { key: 'lava_fissure', x: -47, z: 61, yaw: 0, scale: 1.25 },
    { key: 'lava_fissure', x: -32, z: 76, yaw: Math.PI / 2, scale: 1.1 },
    { key: 'lava_fissure', x: -7, z: 71, yaw: 0, scale: 1.15 },
    { key: 'lava_brazier', x: -50, z: 47, yaw: Math.PI / 2, r: 0.9 },
    { key: 'lava_brazier', x: 8, z: 88, yaw: -Math.PI / 2, r: 0.9 },
    { key: 'volcanic_spire_cluster', x: -50, z: 88, yaw: 0.4, r: 1.8 },
    { key: 'abyss_horned_wall_sconce', x: -52.5, z: 48, yaw: Math.PI / 2 },
    { key: 'abyss_horned_wall_sconce', x: 10.5, z: 86, yaw: -Math.PI / 2 },

    { key: 'abyss_wall_weapon_display', x: -76.5, z: 54, yaw: -Math.PI / 2 },
    { key: 'abyss_wall_weapon_display', x: -76.5, z: 63, yaw: -Math.PI / 2 },
    { key: 'lost_armory_weapon_rack', x: -60, z: 53, yaw: -Math.PI / 2, r: 1.2 },
    { key: 'lost_armory_weapon_rack', x: -68, z: 52, yaw: Math.PI, r: 1.2 },
    { key: 'lost_armory_weapon_rack', x: -68, z: 66, yaw: 0, r: 1.2 },
    { key: 'lava_brazier', x: -58, z: 65, yaw: -Math.PI / 2, r: 0.9 },
    { key: 'lava_brazier', x: -75, z: 66, yaw: Math.PI / 2, r: 0.9 },
    { key: 'abyss_armory_crates_pile', x: -73, z: 59.5, yaw: -0.25, r: 1.4 },
    { key: 'abyss_battlefield_debris_cluster', x: -62.5, z: 61, yaw: 0.5 },
    { key: 'abyss_torn_chained_war_banner', x: -55.2, z: 60, yaw: -Math.PI / 2 },
    { key: 'abyss_skull_bone_ossuary_pile', x: -58.5, z: 57.5, yaw: 0.7 },

    { key: 'lava_pool', x: -78, z: 76, yaw: 0, scale: 1.1 },
    { key: 'lava_pool', x: -78, z: 91, yaw: 0, scale: 1.05 },
    { key: 'lava_brazier', x: -57, z: 76, yaw: -Math.PI / 2, r: 0.9 },
    { key: 'volcanic_spire_cluster', x: -57, z: 91, yaw: 0.8, r: 1.8 },
    { key: 'abyss_basalt_lavafall_shrine', x: -79, z: 84, yaw: Math.PI / 2 },
    { key: 'abyss_molten_crucible', x: -73.5, z: 78.5, yaw: 0.3, r: 1.2 },
    { key: 'abyss_molten_crucible', x: -73.5, z: 88.5, yaw: -0.3, r: 1.2 },
    { key: 'abyss_cracked_obsidian_floor_plate', x: -64, z: 84, yaw: 0 },
    { key: 'abyss_magma_crystal_cluster', x: -78, z: 76, yaw: 0.2 },
    { key: 'abyss_magma_crystal_cluster', x: -78, z: 91, yaw: -0.35 },
    { key: 'abyss_furnace_demon_wall_relief', x: -68, z: 92.5, yaw: Math.PI },

    {
      key: 'infernal_furnace',
      x: -28.2,
      z: 125,
      yaw: Math.PI / 2,
      scale: 0.9,
      hw: 4.3,
      hd: 1.5,
    },
    { key: 'infernal_chain_crane', x: -19, z: 124, yaw: 0, hw: 2.5, hd: 2.5 },
    { key: 'infernal_chain_crane', x: 19, z: 124, yaw: Math.PI, hw: 2.5, hd: 2.5 },
    { key: 'infernal_forge_anvil', x: 0, z: 110, yaw: 0.15, r: 2.2 },
    { key: 'abyss_cracked_obsidian_floor_plate', x: 0, z: 110, yaw: 0 },
    { key: 'lava_fissure', x: -9, z: 112, yaw: 0, scaleX: 0.8, scaleZ: 3 },
    { key: 'lava_fissure', x: 9, z: 112, yaw: 0, scaleX: 0.8, scaleZ: 3 },
    { key: 'abyss_molten_crucible', x: -18, z: 107, yaw: 0.25, r: 1.2 },
    { key: 'abyss_molten_crucible', x: 18, z: 107, yaw: -0.25, r: 1.2 },
    { key: 'abyss_infernal_tongs_rack', x: -27, z: 118, yaw: Math.PI / 2, r: 1.1 },
    { key: 'abyss_forge_bellows_pipes', x: 27, z: 127, yaw: -Math.PI / 2, r: 1.5 },
    { key: 'abyss_furnace_demon_wall_relief', x: -28.5, z: 109, yaw: Math.PI / 2 },
    { key: 'abyss_furnace_demon_wall_relief', x: 28.5, z: 116, yaw: -Math.PI / 2 },
    { key: 'abyss_demonic_basalt_buttress', x: -13, z: 133, yaw: Math.PI },
    { key: 'abyss_demonic_basalt_buttress', x: 13, z: 133, yaw: Math.PI },
    { key: 'abyss_molten_ingot_mold_pile', x: -13, z: 128, yaw: 0.3 },
    { key: 'abyss_molten_ingot_mold_pile', x: 13, z: 128, yaw: -0.3 },
    { key: 'abyss_horned_wall_sconce', x: -28.5, z: 101, yaw: Math.PI / 2 },
    { key: 'abyss_horned_wall_sconce', x: 28.5, z: 126, yaw: -Math.PI / 2 },
    { key: 'lava_brazier', x: -25, z: 98, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 25, z: 98, yaw: Math.PI, r: 0.9 },

    { key: 'infernal_portcullis', x: 30, z: 116, yaw: Math.PI / 2, scale: 1.55 },
    { key: 'abyss_gladiator_spectator_stand', x: 43, z: 101, yaw: 0 },
    { key: 'abyss_gladiator_spectator_stand', x: 49, z: 101, yaw: 0 },
    { key: 'abyss_gladiator_spectator_stand', x: 55, z: 101, yaw: 0 },
    { key: 'abyss_gladiator_spectator_stand', x: 61, z: 101, yaw: 0 },
    { key: 'abyss_gladiator_spectator_stand', x: 43, z: 131, yaw: Math.PI },
    { key: 'abyss_gladiator_spectator_stand', x: 49, z: 131, yaw: Math.PI },
    { key: 'abyss_gladiator_spectator_stand', x: 55, z: 131, yaw: Math.PI },
    { key: 'abyss_gladiator_spectator_stand', x: 61, z: 131, yaw: Math.PI },
    { key: 'abyss_gladiator_spectator_stand', x: 68, z: 110, yaw: -Math.PI / 2 },
    { key: 'abyss_gladiator_spectator_stand', x: 68, z: 116, yaw: -Math.PI / 2 },
    { key: 'abyss_gladiator_spectator_stand', x: 68, z: 122, yaw: -Math.PI / 2 },
    { key: 'gladiator_chain_gantry', x: 52, z: 116, yaw: 0, hw: 3, hd: 3 },
    { key: 'abyss_hanging_chain_cage', x: 61, z: 116, yaw: 0.2 },
    { key: 'abyss_arena_chain_carnage_clutter', x: 44, z: 109, yaw: -0.4 },
    { key: 'abyss_arena_chain_carnage_clutter', x: 59, z: 124, yaw: 0.65 },
    { key: 'abyss_arena_chain_carnage_clutter', x: 58, z: 108, yaw: 0.15 },
    { key: 'abyss_skull_bone_ossuary_pile', x: 43, z: 125, yaw: -0.25 },
    { key: 'abyss_torn_chained_war_banner', x: 52, z: 132.5, yaw: Math.PI },
    { key: 'abyss_horned_wall_sconce', x: 70.5, z: 116, yaw: -Math.PI / 2 },
    { key: 'abyss_horned_wall_sconce', x: 42, z: 132.5, yaw: Math.PI },
    { key: 'abyss_horned_wall_sconce', x: 62, z: 132.5, yaw: Math.PI },
    { key: 'lava_brazier', x: 43, z: 107, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 61, z: 125, yaw: Math.PI, r: 0.9 },
    { key: 'lost_armory_weapon_rack', x: 64, z: 104, yaw: Math.PI / 2, r: 1.2 },
    { key: 'lost_armory_weapon_rack', x: 64, z: 128, yaw: Math.PI / 2, r: 1.2 },

    { key: 'lava_chasm', x: -12, z: 162, yaw: 0, scaleX: 14, scaleZ: 44 },
    { key: 'lava_chasm', x: 12, z: 162, yaw: 0, scaleX: 14, scaleZ: 44 },
    { key: 'infernal_portcullis', x: 0, z: 136, yaw: 0, scale: 1.55 },
    { key: 'lava_brazier', x: -4, z: 142, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 4, z: 182, yaw: Math.PI, r: 0.9 },
    { key: 'abyss_horned_guardian_statue', x: -9.5, z: 181, yaw: 0.15, r: 1.4 },
    { key: 'abyss_horned_guardian_statue', x: 9.5, z: 181, yaw: -0.15, r: 1.4 },
    { key: 'infernal_portcullis', x: 0, z: 188, yaw: 0, scale: 1.55 },
    { key: 'abyss_torn_chained_war_banner', x: -13.5, z: 191, yaw: Math.PI / 2 },
    { key: 'abyss_torn_chained_war_banner', x: 13.5, z: 191, yaw: -Math.PI / 2 },

    { key: 'lava_moat', x: 0, z: 216.5, yaw: 0, scaleX: 78, scaleZ: 28, innerScale: 0.68 },
    { key: 'lava_fissure', x: -16, z: 213, yaw: 0, scale: 1.25 },
    { key: 'lava_fissure', x: 16, z: 213, yaw: 0, scale: 1.25 },
    { key: 'lava_brazier', x: -27, z: 199, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 27, z: 199, yaw: Math.PI, r: 0.9 },
    { key: 'volcanic_spire_cluster', x: -32, z: 214, yaw: 0.25, r: 1.8 },
    { key: 'abyss_magma_crystal_cluster', x: 32, z: 214, yaw: -0.25 },
    { key: 'abyss_horned_guardian_statue', x: -20, z: 228, yaw: Math.PI - 0.2, r: 1.5 },
    { key: 'abyss_horned_guardian_statue', x: 20, z: 228, yaw: Math.PI + 0.2, r: 1.5 },
    { key: 'abyss_arena_chain_carnage_clutter', x: -34, z: 207, yaw: 0.6 },
    { key: 'abyss_arena_chain_carnage_clutter', x: 34, z: 207, yaw: -0.35 },
    { key: 'abyss_skull_bone_ossuary_pile', x: -29, z: 228, yaw: -0.4 },
    { key: 'abyss_skull_bone_ossuary_pile', x: 29, z: 228, yaw: 0.5 },
    { key: 'abyss_hanging_chain_cage', x: -36, z: 217, yaw: -0.12, r: 1.2 },
    { key: 'abyss_hanging_chain_cage', x: 36, z: 217, yaw: 0.12, r: 1.2 },
    { key: 'abyss_demonic_basalt_buttress', x: -27, z: 230, yaw: Math.PI },
    { key: 'abyss_demonic_basalt_buttress', x: 27, z: 230, yaw: Math.PI },
    { key: 'abyss_horned_wall_sconce', x: -30, z: 229.5, yaw: Math.PI },
    { key: 'abyss_horned_wall_sconce', x: 30, z: 229.5, yaw: Math.PI },
    { key: 'abyss_giant_demonic_skull_gate', x: 0, z: 231, yaw: Math.PI, scale: 1.05 },
    { key: 'demonic_basalt_throne', x: 0, z: 229, yaw: Math.PI, hw: 4.5, hd: 3 },
    { key: 'abyssal_heart_altar', x: 0, z: 218, yaw: Math.PI, r: 3.4 },
  ],
};

// The Ashen Coliseum (interior 'arena'): a compact, fully-enclosed square pit
// — no door, no aisle (combatants are teleported in by matchmaking). Side
// walls at |x|=23 like the crypt so the KayKit wall modules fit unchanged;
// four corner pillars carry the arena's warm torches. The dais marker only
// drives the central floor glow (the renderer skips its platform for the
// arena), so it stays a flat, obstacle-free fighting ring.
export const ARENA_LAYOUT: DungeonLayout = {
  zMin: -20,
  zMax: 24,
  sideWallZ: 2,
  sideWallHd: 23,
  pillars: [
    { x: -14, z: -10 },
    { x: 14, z: -10 },
    { x: -14, z: 14 },
    { x: 14, z: 14 },
    // Cover/parkour posts, mirrored about the centre line (z=2) so neither side
    // is favoured. They give the Fiesta something to juke around (and ranked a
    // little cover too) without crowding the spawns at z=-14 / z=18.
    { x: 0, z: -4 },
    { x: 0, z: 8 },
    { x: -9, z: -10 },
    { x: 9, z: -10 },
    { x: -9, z: 14 },
    { x: 9, z: 14 },
  ],
  tombs: [],
  // Low flanking fences along the side lanes, also mirrored about z=2.
  stubs: [
    { x: -11, z: 2, hw: 0.6, hd: 4 },
    { x: 11, z: 2, hw: 0.6, hd: 4 },
  ],
  dais: { x: 0, z: 2, r: 8 },
};

// Combatant spawn points (instance-local), at opposite ends facing each other.
export const ARENA_SPAWN_A = { x: 0, z: -14, facing: 0 }; // faces +z toward B
export const ARENA_SPAWN_B = { x: 0, z: 18, facing: Math.PI }; // faces -z toward A

// 2v2: two fighters per side, spread along x.
export const ARENA_SPAWNS_A_2v2 = [
  { x: -7, z: -14, facing: 0 },
  { x: 7, z: -14, facing: 0 },
];
export const ARENA_SPAWNS_B_2v2 = [
  { x: -7, z: 18, facing: Math.PI },
  { x: 7, z: 18, facing: Math.PI },
];

/** Interior collision set for a layout, in instance-local coordinates. */
export function layoutColliders(layout: DungeonLayout): Collider[] {
  const out: Collider[] = [];
  if (layout.rooms) {
    for (const wall of authoredWallSegments(layout.rooms, layout.doors ?? [], DUNGEON_WALL_HW)) {
      out.push({ type: 'obb', ...wall, rot: 0 });
    }
    for (const barrier of layout.barriers ?? []) {
      out.push({ type: 'obb', ...barrier, rot: 0 });
    }
    out.push(...authoredDecorColliders(layout.decor ?? []));
    return out;
  }
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
  // wall-side obstacles (the boss dais is walkable: no collider)
  for (const t of layout.tombs)
    out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
  // floor clutter props (small circle per scatter point; renderer places matching props)
  for (const c of layout.clutter ?? []) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  return out;
}
