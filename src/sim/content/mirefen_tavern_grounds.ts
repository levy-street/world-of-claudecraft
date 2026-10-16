// The Mirefen tavern's grounds: what stands outside on the terrain round the inn (the building
// itself is ./mirefen_tavern.ts). Data-as-code, in the tavern's LOCAL yards (origin on the ground
// floor at the hall's middle, +x to the right of a player walking in, +z out of the front door
// toward the road, heights over the ground floor), like every other tavern number. Imports
// nothing at runtime (the prop shape is a type), so ./mirefen_tavern.ts can merge the pieces
// into TAVERN_PROPS without an import cycle.
//
//  - the cobbled forecourt before the front, from the stone base out to the road's shoulder
//    (never onto the road): drawn over the terrain, never a walk surface of its own, so the
//    ground the feet walk is still the terrain (groundHeight is untouched);
//  - the terrace on it: two trestle tables left of the steps and one right of them, each with
//    a bench either side (sittable: content/mirefen_tavern_seats.ts), a string of lanterns hung
//    between posts round it and back to the front wall, a warm light over each side;
//  - stacked casks and crates at the front's right corner;
//  - the open stable west of the hall (its walls and posts: ../mirefen_tavern_grounds.ts), a
//    horse trough before it, hay bales in it and at its door, a cart parked beside it;
//  - a woodpile against the hall's north wall by the chimney;
//  - a dog asleep on the porch.
//
// Every piece outside carries `baseY`, the terrain's height under its middle (pinned against the
// live terrain by tests/mirefen_tavern_asset.test.ts), so its collider stands on the ground and the
// model plants its feet there.

import type { TavernProp } from './mirefen_tavern';

/** A local rectangle on the terrain: [x0, x1, z0, z1]. */
export type TavernGroundRect = readonly [number, number, number, number];

/** The cobbled forecourt: the front's width from the stone base out to a yard and more short of
 *  the road's shoulder, and a tongue round the foot of the porch steps. */
export const TAVERN_FORECOURT: readonly TavernGroundRect[] = [
  [-17.2, 17.2, 14.0, 20.8],
  [-6.4, 6.4, 20.8, 22.1],
];

/** The open stable west of the hall: its footprint (local), its floor (the terrain under its
 *  middle, over the ground floor), its eaves and ridge over that floor (the ridge runs along x,
 *  the front eave over the open front), its walls' thickness, and the stall partition (its x,
 *  and how far it runs out from the back wall). The front is open between three posts. */
export const TAVERN_STABLE = {
  x0: -26.6,
  x1: -19.0,
  z0: -1.1,
  z1: 5.5,
  baseY: -2.897,
  eave: 3.4,
  ridge: 5.6,
  wall: 0.28,
  partitionX: -22.8,
  partitionTo: 3.2,
  /** The roof overhangs the open front and the back wall by this much (its front edge stays
   *  over a walking body's head: tests/mirefen_tavern_grounds.test.ts). */
  eaveOut: 0.7,
} as const;

/** The lantern strings over the terrace: each hung from `a` to `b` (local, over the ground
 *  floor), sagging `sag` at its middle, with `lanterns` small glowing lanterns along it. The
 *  posts they hang from are TAVERN_GROUNDS_PROPS' posts (their tops), the rest hook onto the
 *  front wall under the jetty. */
export const TAVERN_LANTERN_STRINGS: readonly {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  sag: number;
  lanterns: number;
}[] = [
  { a: [-15.8, 1.956, 20.6], b: [-5.7, 1.914, 21.0], sag: 0.45, lanterns: 8 },
  { a: [-15.8, 1.956, 20.6], b: [-15.4, 4.6, 14.1], sag: 0.35, lanterns: 5 },
  { a: [-5.7, 1.914, 21.0], b: [-6.2, 4.6, 14.1], sag: 0.35, lanterns: 5 },
  { a: [5.6, 2.538, 19.6], b: [13.0, 3.385, 19.2], sag: 0.4, lanterns: 6 },
  { a: [5.6, 2.538, 19.6], b: [6.2, 4.6, 14.1], sag: 0.3, lanterns: 4 },
  { a: [13.0, 3.385, 19.2], b: [15.4, 4.6, 14.1], sag: 0.3, lanterns: 4 },
];

/** The warm light the lantern strings throw on each side of the terrace (local x, y, z). */
export const TAVERN_TERRACE_LIGHTS: readonly (readonly [number, number, number])[] = [
  [-10.6, 2.2, 18.4],
  [9.4, 2.9, 17.6],
];

/** The chalkboard menu on the front wall right of the door, over the porch's casks: its middle
 *  (local x), its foot and head over the ground floor and its width. Pictures only (a tankard,
 *  a loaf, a fish, a steaming bowl and chalk dots for the prices), never words. */
export const TAVERN_CHALKBOARD = { x: 3.35, y0: 1.95, y1: 3.35, width: 0.9 } as const;

/** The dog asleep on the porch (TAVERN_GROUNDS_PROPS' 'dog'): curled nose to tail, breathing. */
export const TAVERN_DOG = { x: -3.48, z: 15.95, rot: 0.35 } as const;

const bench = (x: number, z: number, hw: number, baseY: number): TavernProp => ({
  kind: 'terraceBench',
  x,
  z,
  rot: 0,
  hw,
  hd: 0.22,
  height: 0.9,
  level: 'ground',
  baseY,
  standable: true,
});

const table = (x: number, z: number, hw: number, baseY: number): TavernProp => ({
  kind: 'terraceTable',
  x,
  z,
  rot: 0,
  hw,
  hd: 0.5,
  height: 1.45,
  level: 'ground',
  baseY,
  standable: true,
});

const post = (x: number, z: number, baseY: number): TavernProp => ({
  kind: 'post',
  x,
  z,
  rot: 0,
  r: 0.16,
  height: 4.6,
  level: 'ground',
  baseY,
});

/** Everything solid outside (merged into TAVERN_PROPS after the inside's furniture). */
export const TAVERN_GROUNDS_PROPS: readonly TavernProp[] = [
  // the terrace left of the steps: two trestle tables along the front, a bench either side
  table(-12.3, 17.6, 1.7, -2.343),
  bench(-12.3, 16.6, 1.6, -2.225),
  bench(-12.3, 18.6, 1.6, -2.451),
  table(-7.3, 17.9, 1.5, -2.338),
  bench(-7.3, 16.9, 1.4, -2.255),
  bench(-7.3, 18.9, 1.4, -2.434),
  // ...and one right of them, under the tankard sign
  table(8.8, 17.3, 1.4, -1.705),
  bench(8.8, 16.3, 1.3, -1.736),
  bench(8.8, 18.3, 1.3, -1.678),
  // the lantern strings' posts at the terrace's outer corners
  post(-15.8, 20.6, -2.644),
  post(-5.7, 21.0, -2.686),
  post(5.6, 19.6, -2.062),
  post(13.0, 19.2, -1.215),
  // stone flower tubs at the terrace's outer corners
  {
    kind: 'planter',
    x: -16.6,
    z: 19.8,
    rot: 0.9,
    r: 0.5,
    height: 0.95,
    level: 'ground',
    baseY: -2.56,
    standable: true,
  },
  {
    kind: 'planter',
    x: 14.2,
    z: 19.9,
    rot: 2.1,
    r: 0.5,
    height: 0.95,
    level: 'ground',
    baseY: -1.147,
    standable: true,
  },
  // casks and crates stacked at the front's right corner
  {
    kind: 'cask',
    x: 14.3,
    z: 15.0,
    rot: 1.9,
    r: 0.42,
    height: 1.25,
    level: 'ground',
    baseY: -1.207,
    standable: true,
  },
  {
    kind: 'cask',
    x: 15.2,
    z: 15.45,
    rot: 0.8,
    r: 0.4,
    height: 1.15,
    level: 'ground',
    baseY: -1.058,
    standable: true,
  },
  {
    kind: 'crate',
    x: 13.15,
    z: 15.05,
    rot: 0.2,
    hw: 0.45,
    hd: 0.45,
    height: 0.9,
    level: 'ground',
    baseY: -1.345,
    standable: true,
  },
  {
    kind: 'crate',
    x: 15.5,
    z: 16.75,
    rot: -0.3,
    hw: 0.4,
    hd: 0.4,
    height: 0.8,
    level: 'ground',
    baseY: -1.014,
    standable: true,
  },
  // the stable's trough before its door, the hay at its door and in its back stall, the cart
  // parked beside it
  {
    kind: 'trough',
    x: -22.8,
    z: 7.0,
    rot: 0,
    hw: 1.15,
    hd: 0.38,
    height: 0.75,
    level: 'ground',
    baseY: -2.823,
    standable: true,
  },
  {
    kind: 'hay',
    x: -25.9,
    z: 6.8,
    rot: 0.3,
    hw: 0.75,
    hd: 0.45,
    height: 1.0,
    level: 'ground',
    baseY: -2.73,
    standable: true,
  },
  {
    kind: 'hay',
    x: -25.3,
    z: 0.2,
    rot: 0,
    hw: 1.0,
    hd: 0.7,
    height: 1.4,
    level: 'ground',
    baseY: -3.275,
    standable: true,
  },
  {
    kind: 'cart',
    x: -27.9,
    z: 9.2,
    rot: -0.4,
    hw: 0.95,
    hd: 1.9,
    height: 1.35,
    level: 'ground',
    baseY: -2.705,
    standable: true,
  },
  // the woodpile against the hall's north wall, beside the chimney
  {
    kind: 'woodpile',
    x: 16.95,
    z: 6.9,
    rot: 0,
    hw: 0.55,
    hd: 1.9,
    height: 1.7,
    level: 'ground',
    baseY: -0.06,
    standable: true,
  },
  // the dog asleep on the porch against its left parapet, before the bench, clear of the
  // doorway's lane and of the bench's sitter
  {
    kind: 'dog',
    x: TAVERN_DOG.x,
    z: TAVERN_DOG.z,
    rot: TAVERN_DOG.rot,
    r: 0.32,
    height: 0.5,
    level: 'ground',
  },
];
