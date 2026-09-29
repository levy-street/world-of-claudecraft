// The Fire and Fly arena: a private open-field interior, one per claim. This
// pure module owns the clearing's height, the cannon tower at its center, the
// rock and tree-ring placements, the invisible walls, and the static collision
// set the renderer draws from the same lists. Coordinates are instance-local
// with the tower at the origin. Placements hash their index: no rng draw.

import type { Collider } from './colliders';
import { ROCK_HEIGHT_PER_SCALE, rockRadius } from './decoration_dims';
import { hash2 } from './rng';

// hex_tower_cannon.glb in model units, measured from its meshes: the roof
// platform the head sits on, the parapet's top, and the widest shaft ring above
// the plinth (the plinth flares a little wider but only ankle high).
const TOWER_MODEL = { roofY: 1.4, topY: 1.5, radius: 0.56 } as const;
const TOWER_SCALE = 3.4;

/** The cannon tower, shared by the render (its GLB at `scale`) and the sim. */
export const FIRE_AND_FLY_TOWER = {
  scale: TOWER_SCALE,
  /** Roof platform above the ground at the tower's foot: where the player stands. */
  roofY: TOWER_MODEL.roofY * TOWER_SCALE,
  /** Parapet top above the ground: nothing flies over the tower below it. */
  topY: TOWER_MODEL.topY * TOWER_SCALE,
  radius: TOWER_MODEL.radius * TOWER_SCALE,
} as const;

export const FIRE_AND_FLY_CLEARING_RADIUS = 55;
export const FIRE_AND_FLY_TREE_RING = { inner: 60, outer: 95 } as const;
/** Inner face of the invisible wall that closes the arena. */
export const FIRE_AND_FLY_WALL_RADIUS = 100;

const HASH_SEED = 0x46a9f1;

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function unit(index: number, channel: number): number {
  return hash2(index, channel, HASH_SEED);
}

/**
 * A gentle roll (under 0.55 yd from trough to crest) across the clearing, faded
 * to exactly flat around the tower's foot, then a slow rise into the forest.
 */
export function fireAndFlyFieldHeight(lx: number, lz: number): number {
  const r = Math.hypot(lx, lz);
  const roll =
    0.16 * Math.sin(lx * 0.083 + 0.6) * Math.sin(lz * 0.071 - 1.1) +
    0.11 * Math.sin(lx * 0.041 - lz * 0.057 + 2.3);
  const forest =
    3.2 * smoothstep(FIRE_AND_FLY_CLEARING_RADIUS, 104, r) +
    0.6 * smoothstep(62, 104, r) * Math.sin(lx * 0.05 + lz * 0.043 + 0.9);
  return roll * smoothstep(5, 16, r) + forest;
}

export interface FireAndFlyRock {
  x: number;
  z: number;
  rot: number;
  /** Decoration scale: the render sizes the rock GLB to `height` like the open world's stones. */
  scale: number;
  /** rock_1 to rock_3 in /models/foliage. */
  variant: 1 | 2 | 3;
  radius: number;
  height: number;
}

export interface FireAndFlyTree {
  x: number;
  z: number;
  rot: number;
  scale: number;
  kind: 'oak' | 'pine';
  /** oak_1 to oak_5 or pine_1 to pine_5 in /models/foliage. */
  variant: 1 | 2 | 3 | 4 | 5;
}

const ROCK_COUNT = 7;
// The forest edge, behind the 46 yd spawn ring: marchers never cross a rock on
// their way in, while a body thrown far out still meets one.
const ROCK_RING = { inner: 50, span: 8 } as const;

export const FIRE_AND_FLY_ROCKS: readonly FireAndFlyRock[] = Array.from(
  { length: ROCK_COUNT },
  (_, i) => {
    const angle = ((i + 0.2 + 0.6 * unit(i, 1)) * 2 * Math.PI) / ROCK_COUNT + 0.4;
    const r = ROCK_RING.inner + ROCK_RING.span * unit(i, 2);
    const scale = 1.4 + 0.8 * unit(i, 3);
    return {
      x: Math.sin(angle) * r,
      z: Math.cos(angle) * r,
      rot: unit(i, 4) * 2 * Math.PI,
      scale,
      variant: (1 + Math.floor(unit(i, 5) * 3)) as FireAndFlyRock['variant'],
      radius: rockRadius(scale),
      height: scale * ROCK_HEIGHT_PER_SCALE,
    };
  },
);

// Staggered rows about 6.5 yd apart, trunks about 9 yd apart along a row: the
// jitter below never brings two trunks within 3 yd of each other.
const TREE_ROWS = [61.5, 68, 74.5, 81, 87.5, 93.5] as const;
const TREE_SPACING = 9;

export const FIRE_AND_FLY_TREES: readonly FireAndFlyTree[] = TREE_ROWS.flatMap((row, k) => {
  const count = Math.round((2 * Math.PI * row) / TREE_SPACING);
  const offset = unit(k, 20) * 2 * Math.PI;
  return Array.from({ length: count }, (_, j) => {
    const index = k * 1000 + j;
    const angle = offset + ((j + 0.5 + (unit(index, 21) - 0.5) * 0.6) * 2 * Math.PI) / count;
    const r = row + (unit(index, 22) - 0.5) * 2.4;
    return {
      x: Math.sin(angle) * r,
      z: Math.cos(angle) * r,
      rot: unit(index, 23) * 2 * Math.PI,
      scale: 0.95 + 0.5 * unit(index, 24),
      kind: unit(index, 25) < 0.45 ? ('pine' as const) : ('oak' as const),
      variant: (1 + Math.floor(unit(index, 26) * 5)) as FireAndFlyTree['variant'],
    };
  });
});

const WALL_SEGMENTS = 24;
const WALL_HALF_DEPTH = 1;

/** A closed polygon of full-height boxes, each yawed to face the center. */
export const FIRE_AND_FLY_WALLS: readonly {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
}[] = Array.from({ length: WALL_SEGMENTS }, (_, i) => {
  const angle = (i * 2 * Math.PI) / WALL_SEGMENTS;
  const center = FIRE_AND_FLY_WALL_RADIUS + WALL_HALF_DEPTH;
  return {
    x: Math.sin(angle) * center,
    z: Math.cos(angle) * center,
    hw: center * Math.tan(Math.PI / WALL_SEGMENTS) + WALL_HALF_DEPTH,
    hd: WALL_HALF_DEPTH,
    rot: angle,
  };
});

/** A tree's trunk circle, the open world's scatter rule (decoration_collider.ts). */
export function fireAndFlyTrunkRadius(tree: FireAndFlyTree): number {
  return 0.55 * tree.scale;
}

/** The arena's static collision, every top seated on the interior floor `floorY`. */
export function fireAndFlyColliders(floorY: number): Collider[] {
  const ground = (x: number, z: number) => floorY + fireAndFlyFieldHeight(x, z);
  return [
    {
      type: 'circle',
      x: 0,
      z: 0,
      r: FIRE_AND_FLY_TOWER.radius,
      moveTopY: ground(0, 0) + FIRE_AND_FLY_TOWER.roofY,
      standable: true,
      cameraTopY: ground(0, 0) + FIRE_AND_FLY_TOWER.topY,
    },
    ...FIRE_AND_FLY_ROCKS.map((rock): Collider => {
      const top = ground(rock.x, rock.z) + rock.height;
      return {
        type: 'circle',
        x: rock.x,
        z: rock.z,
        r: rock.radius,
        moveTopY: top,
        standable: true,
        cameraTopY: top,
      };
    }),
    ...FIRE_AND_FLY_TREES.map(
      (tree): Collider => ({
        type: 'circle',
        x: tree.x,
        z: tree.z,
        r: fireAndFlyTrunkRadius(tree),
        cameraTopY: ground(tree.x, tree.z) + 7.5 * tree.scale,
      }),
    ),
    ...FIRE_AND_FLY_WALLS.map((wall): Collider => ({ type: 'obb', ...wall })),
  ];
}
