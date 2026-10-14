// An authored map is a CLEAN SLATE: no built-in world content may leak into it.
//
// Most of the world self-gates, because the sim and renderer read it off the
// ACTIVE WorldContent and an authored map's props/camps/npcs are empty. The
// leaks are the pieces hard-coded at fixed world coordinates, which land inside
// an ordinary authored map's rect and cannot be edited or deleted there:
//
//   * the neighbouring zones' bespoke biome scenery (render/renderer.ts
//     ensureZoneFeatures), giant trees, mist banks and lily pads built at
//     BUILT-IN coordinates and planted at terrainHeight(), which on an authored
//     map is the flat slate: they stand out over the ocean beside the map,
//   * the painted horizon backdrop baked into the sky dome (render/sky.ts) ,
//     the shipped overworld's ridge line drawn around a map that has its own,
//   * the shipped gather veins (below),
//   * Eastbrook town, the jail and the crafting stations (render/renderer.ts) ,
//     gated there alongside the gather veins; not reachable from a node test,
//     so this file covers the veins and the renderer keeps its own gate.
//
// This file USED to carry three more suites, all of them the Sowfield: its
// boarball boards and goals blocking as invisible walls, its grandstand LIFT
// raising walkable ground into an invisible staircase, and its crowd bed
// murmuring over one band of every authored map. Upstream v0.40 demolished the
// stadium and retired the Vale Cup outright, so all three leaks and the
// sowfieldIsLive() gate written for them are gone with the feature. The lesson
// they recorded is the one the header states: anything pinned to FIXED world
// coordinates leaks, and the fix is to gate on the active presentation.

import { describe, expect, it } from 'vitest';
import { customMapToWorldContent, newFlatCustomMap } from '../src/editor/custom_map';
import type { Collider } from '../src/sim/colliders';
import {
  activeGatherNodes,
  BUILTIN_WORLD,
  DUNGEONS,
  GATHER_NODES,
  setActiveWorldContent,
} from '../src/sim/data';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';
import { DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID } from '../src/sim/drowned_temple_entrance';
import { dungeonDoorJambColliders } from '../src/sim/dungeon_door_jambs';
import { HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID } from '../src/sim/hollow_crypt_entrance';
import { DOOR_ARCH_JAMB_HD, DOOR_ARCH_JAMB_HW } from '../src/sim/prop_layout';
import { SUNKEN_BASTION_ENTRANCE_DUNGEON_ID } from '../src/sim/sunken_bastion_entrance';
import { WILDHEART_BASIN_ENTRANCE_DUNGEON_ID } from '../src/sim/wildheart_basin_entrance';
import { groundHeight, terrainHeight } from '../src/sim/world';

describe("authored maps: the shipped world's gather veins do not appear", () => {
  // The file header above already claimed these were "gated in render/
  // renderer.ts". They were not: buildGatherNodes ran unconditionally, so the
  // Deepglass arena drew 223,702 triangles of ore, timber and herbs a frame ,
  // 36% of its whole frame, around and inside a blitzball stadium, while the
  // minimap (which DID gate) drew none of them. Now every reader goes through
  // activeGatherNodes(), so the mesh, the map and the interact key agree.
  it('offers the full table on the built-in world', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    expect(GATHER_NODES.length).toBeGreaterThan(0);
    expect(activeGatherNodes()).toHaveLength(GATHER_NODES.length);
  });

  it('offers none on an ordinary authored map', () => {
    const blank = newFlatCustomMap('Blank', 'leak_veins', 1, { width: 400, height: 400 });
    setActiveWorldContent(customMapToWorldContent(blank));
    expect(activeGatherNodes()).toEqual([]);
  });

  it('offers none in the Deepglass, whose building the veins stand inside', () => {
    const world = buildDeepglassWorld();
    expect(world.presentationMode).toBe('deepglass');

    // The leak was not theoretical: veins really do land inside the arena.
    // Measured against the parapet (r 99, sim/deepglass/world.ts), which is as
    // far out as a player can walk.
    setActiveWorldContent(BUILTIN_WORLD);
    const insideTheBuilding = GATHER_NODES.filter((n) => Math.hypot(n.pos.x, n.pos.z) < 99);
    expect(insideTheBuilding.length).toBeGreaterThan(0);

    setActiveWorldContent(world);
    expect(activeGatherNodes()).toEqual([]);
  });
});

describe("authored maps: the shipped world's level pads and walk lifts do not apply", () => {
  // terrainHeight runs the shipped world's pad chain (Dawnhold's grounds, the
  // Last Keep site, the Evergarden and Galecrest pads) AFTER the sculpt layer,
  // so on an authored map each pad was a patch the maker could not sculpt:
  // SPACEY's Deepglass had Dawnhold's pad pinned at y 3.2 under 28 lowering
  // stamps (2026-09-15, "a weird flat square ... hard stuck"). Its wall walks
  // rode groundHeight the same way, as invisible walls over the maker's ground.
  const PAD = { x: 266, z: 899 }; // inside DAWNHOLD.pad (x 232..300, z 854..944)
  const WALL = { x: 240, z: 880 }; // on the curtain wall's west centerline
  const SEED = 1234;

  it('keeps them on the shipped world and on full copies of it', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    expect(terrainHeight(PAD.x, PAD.z, SEED)).toBeCloseTo(3.2, 6);
    expect(groundHeight(WALL.x, WALL.z, SEED)).toBeGreaterThan(terrainHeight(WALL.x, WALL.z, SEED));
    // A world copy (no presentation mode) is the shipped world: castles stand.
    setActiveWorldContent({ ...BUILTIN_WORLD, terrainEdits: [] });
    expect(terrainHeight(PAD.x, PAD.z, SEED)).toBeCloseTo(3.2, 6);
  });

  it('lets an authored map sculpt the ground under them', () => {
    const blank = newFlatCustomMap('Blank', 'leak_pads', 1, { width: 800, height: 2000 });
    blank.terrainEdits.push({ x: PAD.x, z: PAD.z, radius: 30, delta: -6, falloff: 'flat' });
    setActiveWorldContent(customMapToWorldContent(blank));
    const seed = blank.meta.seed;
    const beside = terrainHeight(PAD.x + 40, PAD.z, seed); // outside the stamp
    expect(terrainHeight(PAD.x, PAD.z, seed)).toBeCloseTo(beside - 6, 6);
    // No invisible wall walk either: the feet stand on the drawn ground.
    expect(groundHeight(WALL.x, WALL.z, seed)).toBe(terrainHeight(WALL.x, WALL.z, seed));
  });
});

describe('authored maps: the four built dungeon entrances keep to the shipped world', () => {
  // The Drowned Gate Tower, the Fallen Chapel, the Moon Stair and the Jaguar
  // Maw stand at their dungeons' fixed overworld doors. On the Deepglass the
  // Drowned Gate Tower's curtain wall came up as an invisible full-height wall
  // across Castle B's east wall-walk flight (tests/tidehold_castle_b_flights).
  // An authored map keeps the plain door jambs it always had, and the renderer
  // builds none of the four (render/static_world_features.ts).
  const BUILT = [
    SUNKEN_BASTION_ENTRANCE_DUNGEON_ID,
    HOLLOW_CRYPT_ENTRANCE_DUNGEON_ID,
    DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID,
    WILDHEART_BASIN_ENTRANCE_DUNGEON_ID,
  ];
  const flatTop = (_seed: number, _x: number, _z: number, h: number): number => h;
  const isPlainJamb = (c: Collider): boolean =>
    c.type === 'obb' && c.hw === DOOR_ARCH_JAMB_HW && c.hd === DOOR_ARCH_JAMB_HD && c.rot === 0;
  const near = (cs: Collider[], d: { x: number; z: number }): Collider[] =>
    cs.filter((c) => Math.hypot(c.x - d.x, c.z - d.z) < 40);

  it('collides with each set piece on the shipped world', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const cs = dungeonDoorJambColliders(1, flatTop);
    for (const id of BUILT) {
      expect(
        near(cs, DUNGEONS[id].doorPos).some((c) => !isPlainJamb(c)),
        id,
      ).toBe(true);
    }
  });

  it('keeps only the plain jambs at those doors in the Deepglass', () => {
    setActiveWorldContent(buildDeepglassWorld());
    const cs = dungeonDoorJambColliders(1, flatTop);
    for (const id of BUILT) {
      const around = near(cs, DUNGEONS[id].doorPos);
      expect(around.length, id).toBeGreaterThan(0);
      expect(
        around.filter((c) => !isPlainJamb(c)),
        id,
      ).toEqual([]);
    }
    setActiveWorldContent(BUILTIN_WORLD);
  });
});
