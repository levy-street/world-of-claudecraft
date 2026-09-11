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
//   * the painted horizon backdrop baked into the sky dome (render/sky.ts), //     the shipped overworld's ridge line drawn around a map that has its own,
//   * the shipped gather veins (below),
//   * Eastbrook town, the jail and the crafting stations (render/renderer.ts), //     gated there alongside the gather veins; not reachable from a node test,
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
import {
  activeGatherNodes,
  BUILTIN_WORLD,
  GATHER_NODES,
  setActiveWorldContent,
} from '../src/sim/data';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';

describe("authored maps: the shipped world's gather veins do not appear", () => {
  // The file header above already claimed these were "gated in render/
  // renderer.ts". They were not: buildGatherNodes ran unconditionally, so the
  // Deepglass arena drew 223,702 triangles of ore, timber and herbs a frame,   // 36% of its whole frame, around and inside a blitzball stadium, while the
  // minimap (which DID gate) drew none of them. Now every reader goes through
  // activeGatherNodes(), so the mesh, the map and the interact key agree.
  it('offers the full table on the built-in world', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    expect(GATHER_NODES.length).toBeGreaterThan(0);
    expect(activeGatherNodes()).toHaveLength(GATHER_NODES.length);
  });

  // OWED: "offers none on an ordinary authored map" (newFlatCustomMap, a
  // Studio-only blank/flat CustomMap factory with document width/height, plus
  // the presentationMode wire-through customMapToWorldContent needs to gate
  // activeGatherNodes on it) is not ported to this branch's
  // src/editor/custom_map.ts; the case is dropped pending that port.

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
