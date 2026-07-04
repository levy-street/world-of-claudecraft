// The temporary frontier barricades of the level-40 launch (v0.19): two rockslide
// walls plug the only road passes that lead out of the launch play space, and a
// Legion Frontier Warden camps beside each to explain the closure in-world.
//
// - z = 900 (Thornpeak Heights -> Ossara Domain): the tutorial island's land exit.
//   Leaving the Landing is meant to happen through the Envoys' Hall teleport, so
//   the old road is buried.
// - z = SEALED_FRONTIER_Z = 2970 (Pale Crossing -> The Breach): seals the eternal
//   war zone and everything north of it (the 45-60 band) until the cap raise.
//
// The boulders ride the SAME deterministic decoration field the procedural rocks
// use (world.ts generateDecorations appends them), so rendering and collision come
// from one list: what you see is exactly what you collide with. Every ridge
// crossing OUTSIDE the road pass is already an impassable slope wall
// (tests/terrain_walls.test.ts), so plugging the |x| < 10 pass closes the border
// completely. Colliders are circles (never jumpable, unlike fences), sized
// 0.7 * scale by the collider rock arm, so the stagger below keeps every gap
// smaller than a player body (radius 0.5).
//
// Removing the barricades at the cap-raise release deletes this module's rows
// (and frees the wardens for the reopening event); nothing else references them.

import { emptyZoneProps, type NpcDef, type ZonePropsDef } from '../../types';

// First sealed world-z: everything at or past this band is out of the launch play
// space. Used by the barricade rows below, the character-load safety clamp
// (sim.ts addPlayer), and the world-map sealed state (map_atlas_view.ts).
export const SEALED_FRONTIER_Z = 2970;

// The island exit pass (Thornpeak Heights zMax).
export const LANDING_EXIT_Z = 900;

// A staggered double row of boulders across the road pass at the given z. The
// pass floor is |x| < 10 with walls fully risen by |x| = 28; the rows run to
// |x| = 13 so they bite into the rising shoulder with margin. Scales cycle a
// fixed pattern (deterministic, no rng): collider radius 0.7 * scale gives
// 0.77..1.26, and the 1.3 spacing keeps neighbor gaps negative (overlapping).
function rockslide(z: number): { x: number; z: number; scale: number }[] {
  const out: { x: number; z: number; scale: number }[] = [];
  const SCALES = [1.5, 1.1, 1.8, 1.25, 1.4];
  // Integer counter: a float accumulator drifts past the bound by 4e-15 and
  // drops the final +x column (caught by review). Rows span |x| <= 17: the
  // road pass is |x| < 10 but the terrain climb gate only takes over around
  // |x| ~ 17 on the shoulders, and the widened barrier sweep proved x = 16
  // walkable with the old 13-wide rows.
  for (let k = 0; k <= 26; k++) {
    const x = -17 + k * 1.3;
    out.push({ x, z, scale: SCALES[k % SCALES.length] });
    out.push({ x: x + 0.65, z: z + 1.4, scale: SCALES[(k + 3) % SCALES.length] });
  }
  return out;
}

export const BARRIER_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  boulders: [...rockslide(LANDING_EXIT_Z - 1), ...rockslide(SEALED_FRONTIER_Z - 1)],
  // Each warden keeps a small post beside the road, south of their wall.
  tents: [
    { x: 6, z: LANDING_EXIT_Z - 10, rot: 2.4, scale: 1.05 },
    { x: 7, z: SEALED_FRONTIER_Z - 11, rot: -2.1, scale: 1.05 },
  ],
  campfires: [
    [4, LANDING_EXIT_Z - 8],
    [5, SEALED_FRONTIER_Z - 9],
  ],
  crates: [
    [7.5, LANDING_EXIT_Z - 9],
    [8.5, SEALED_FRONTIER_Z - 10],
  ],
};

export const BARRIER_NPCS: Record<string, NpcDef> = {
  frontier_warden_corvis: {
    id: 'frontier_warden_corvis',
    name: 'Warden Corvis',
    title: 'Legion Frontier Warden',
    pos: { x: 2.5, z: LANDING_EXIT_Z - 7 },
    facing: Math.PI,
    color: 0xb08d57,
    questIds: [],
    greeting:
      'The old road is buried, and it stays buried. The continent receives you through the Envoys, not through rubble.',
  },
  frontier_warden_maerlys: {
    id: 'frontier_warden_maerlys',
    name: 'Warden Maerlys',
    title: 'Legion Frontier Warden',
    pos: { x: 2.5, z: SEALED_FRONTIER_Z - 8 },
    facing: Math.PI,
    color: 0xb08d57,
    questIds: [],
    greeting:
      'Past those stones lies the Breach, and the war knows no truce. The front stays sealed until the Legion says otherwise.',
  },
};
