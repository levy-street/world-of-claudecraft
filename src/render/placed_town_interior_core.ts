// The AIR of a walk-in placed town building (a painted Tidehold model stood by a town
// layout, sim/placed_town_kit.ts), for the indoor chase camera (interior_camera.ts): the
// rooms a camera may stand in and the doorways that open them onto the world, read off each
// model's baked collision (data/asset_collision_overrides.json) at AUTHORED size, then
// carried to the building's placement: its scale, its turn and its ground.
//
// Each piece is a box in the model's own axes, in yards over its ground line (y 0), against
// the inner wall faces (a quarter yard in from them, clear of the beams, sills and trims the
// collision lines do not carry), the floor deck and the ceiling over it:
//  - tavern_b (Highwatch's inn): the taproom under the upper floor's slab, the front door,
//    the stair well at its +x end, and the upper floor under the roof's tie beams;
//  - tavern (the inn of Eastbrook and Fenbridge, tavern_b's smaller sister): the same rooms,
//    the taproom cut round its hearth and its back-bar shelves;
//  - bank: the banking hall under its beams, cut round its two pillars, and the front door
//    (the strongroom behind the vault door is shut, so it has none);
//  - hall (a chapel): the nave to the wall plates (the roof is open above them), the portal;
//  - shop_a (a counting house) and shop_b (a potion shop): the shop room under its beams,
//    in front of its back shelves, and the front door;
//  - smithy: the forge room under its ceiling, the front door, and the side arch onto the
//    forge shelter (an opening too: the shelter is open to the weather);
//  - manor (the Highwatch manor, built in this repo): the great hall under its hood, the
//    front door, the dais bay through its arch, and through their arches and doors the
//    dining hall and the kitchen (west), the library and the chapel (east).
// A model with no entry here (a sealed one: the cottages, the watch house, the vault) has no
// air: the camera stays the open-world one. Every town that stands these models (Highwatch,
// Eastbrook, Fenbridge) registers the air through placed_town_interiors.ts.
//
// A building at a quarter turn gets its air in the world's axes, each piece turned into a
// world box. One at any other angle (Eastbrook stands its buildings at the Studio map's own
// turns) gets the model's pieces as they are, carried to its scale and ground, in the
// building's own frame (its anchor and its turn, interior_camera_core.ts InteriorFrame), so
// its rooms stay square to its walls and every door keeps the model's own axis and side.
// Three-, DOM- and i18n-free; built once per town view, never per frame.

import { localToWorld } from '../sim/placed_town_kit';
import {
  type CameraInterior,
  cameraInterior,
  type InteriorBox,
  type InteriorOpening,
} from './interior_camera_core';

/** One piece of air in the model's own axes at authored size: [x0, x1, y0, y1, z0, z1]. */
type LocalBox = readonly [number, number, number, number, number, number];

export interface ModelAir {
  readonly boxes: readonly LocalBox[];
  /** The pieces that open onto the world: their index, the model axis (0 x, 2 z) and the
   *  side (-1 the min face, +1 the max face). */
  readonly openings: readonly { box: number; axis: 0 | 2; side: 1 | -1 }[];
}

/**
 * How far (yards at authored size) a strip of air cut round a hearth or shelves runs on into
 * the room beside it. The camera walks its ray through the air with every piece shrunk by its
 * near-plane pad (interiorCameraPadding: about 0.4 yd at the default field of view, past 0.7
 * at the widest the settings allow), so two pieces that only meet at a face leave a gap of
 * twice that between them: the ray of a player standing in the strip stopped short of the
 * room, and the camera fell back to a cramped framing beside the hearth. Overlapping by more
 * than both pads keeps the air one piece at any scale and nearly any field of view. (A strip
 * is only worth cutting where it is wider than both pads too: the smithy's corners either
 * side of its hearth, about a yard across, are left out for that.)
 */
const JOIN_REACH = 1.5;

/** The authored air per painted model (the geometry name, shared by every look). */
const MODEL_AIR: Readonly<Record<string, ModelAir>> = {
  tavern_b: {
    boxes: [
      // the taproom: inner walls x +-12.4, z +-6.9, the deck at 0.45, under the beams that
      // carry the upper floor's slab (5.36); the chimney breast (x -12.5 to -11.1, z -2.8
      // to 0.8) stands in its -x end, so that strip is cut round it
      [-11.0, 12.15, 0.45, 5.0, -6.65, 6.65],
      // the front door through the front wall (z -7.5 to -6.9), its head at 4.85
      [-3.5, -0.5, 0.45, 4.85, -7.6, -6.4],
      // the stair well at the +x end, open from the taproom to the upper floor
      [10.28, 12.15, 0.45, 9.65, -5.9, 3.5],
      // the upper floor: over the slab (5.68) to the tie beams (9.65)
      [-12.3, 12.3, 5.68, 9.65, -7.5, 7.5],
      // the taproom's -x strip either side of the chimney breast (JOIN_REACH into the
      // taproom: see there)
      [-12.15, -11.0 + JOIN_REACH, 0.45, 5.0, -6.65, -2.95],
      [-12.15, -11.0 + JOIN_REACH, 0.45, 5.0, 0.95, 6.65],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  tavern: {
    boxes: [
      // the taproom: inner walls x +-9.4, z +-5.9, the deck at 0.45, under the beams that
      // carry the upper floor's slab (4.95 to 5.36); the hearth's chimney breast (x -9.5 to
      // -8.1, z -1.8 to 1.8) stands in its -x end and the back-bar shelves (x 1.2 to 3.6
      // either side, z 4.98 on) against its back wall, so it stops short of both
      [-8.0, 9.15, 0.45, 5.0, -5.65, 4.88],
      // the front door through the front wall (z -6.5 to -5.9), its head at 4.85
      [-1.5, 1.5, 0.45, 4.85, -6.6, -5.4],
      // the stair well at the +x end, open from the taproom to the upper floor
      [7.28, 9.15, 0.45, 9.65, -4.9, 2.9],
      // the upper floor: over the slab (5.68) to the tie beams (9.65)
      [-9.3, 9.3, 5.68, 9.65, -6.5, 6.5],
      // the taproom's -x strips either side of the chimney breast, and its back wall either
      // side of the shelves and between them (JOIN_REACH into the taproom: see there)
      [-9.15, -8.0 + JOIN_REACH, 0.45, 5.0, -5.65, -1.95],
      [-9.15, -8.0 + JOIN_REACH, 0.45, 5.0, 1.95, 5.65],
      [-8.0, -3.7, 0.45, 5.0, 4.88 - JOIN_REACH, 5.65],
      [-1.1, 1.1, 0.45, 5.0, 4.88 - JOIN_REACH, 5.65],
      [3.7, 9.15, 0.45, 5.0, 4.88 - JOIN_REACH, 5.65],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  bank: {
    boxes: [
      // the banking hall between its two pillars: inner walls x +-8.55, z +-5.8, the deck at
      // 0.45, under the ceiling beams (5.43 to 5.83)
      [-3.95, 3.95, 0.45, 5.45, -5.55, 5.55],
      // the front door through the front wall (z -6.25 to -5.8), its head at 4.85
      [-1.3, 1.3, 0.45, 4.85, -6.35, -5.3],
      // the hall round its two pillars (x 4.05 to 5.15 either side, z -2.7 to -1.7, floor to
      // ceiling): both sides past them, and the whole width before and behind them
      [-8.3, -5.25, 0.45, 5.45, -5.55, 5.55],
      [5.25, 8.3, 0.45, 5.45, -5.55, 5.55],
      [-8.3, 8.3, 0.45, 5.45, -5.55, -2.8],
      [-8.3, 8.3, 0.45, 5.45, -1.6, 5.55],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  hall: {
    boxes: [
      // the nave: inner walls x +-5.2, z +-10.2, the floor at 0.9, the wall plates at 9.3
      [-4.95, 4.95, 0.9, 9.3, -9.95, 9.95],
      // the portal through the front gable (z -11 to -10.2), its head at 5.9
      [-1.6, 1.6, 0.9, 5.9, -11.1, -9.7],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  shop_a: {
    boxes: [
      // the counting room: inner walls x +-5.05, z +-3.75, the deck at 0.45, under the beams
      // that carry the ceiling (4.23 to 4.63); its back shelves, z 3.33 to 3.75, stand in
      // front of the back wall
      [-4.8, 4.8, 0.45, 4.25, -3.5, 3.25],
      // the front door through the shop front (z -4.2 to -3.75), its head at 3.7
      [-2.5, -0.7, 0.45, 3.7, -4.3, -3.2],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  shop_b: {
    boxes: [
      // the shop: inner walls x +-4.25, z +-4.05, the deck at 0.45, under the beams that
      // carry the ceiling (4.23 to 4.63); its back shelves, z 3.56 to 4.05, stand in front of
      // the back wall
      [-4.0, 4.0, 0.45, 4.25, -3.8, 3.46],
      // the front door through the shop front (z -4.5 to -4.05), its head at 3.7
      [-1.6, 0.2, 0.45, 3.7, -4.6, -3.5],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  smithy: {
    boxes: [
      // the forge room: inner walls x +-4.9, z +-3.9, the deck at 0.45, the ceiling 5.25;
      // the hearth (x -4.9 to -3.98, four yards up) fills its -x end
      [-3.85, 4.65, 0.45, 5.25, -3.65, 3.65],
      // the front door through the front wall (z -4.5 to -3.9), its head at 4.45
      [-2.6, 0.2, 0.45, 4.45, -4.6, -3.4],
      // the side arch onto the forge shelter through the +x wall (x 4.9 to 5.5)
      [4.4, 5.6, 0.45, 4.05, -1.2, 1.2],
    ],
    openings: [
      { box: 1, axis: 2, side: -1 },
      { box: 2, axis: 0, side: 1 },
    ],
  },
  manor: {
    // scripts/assets/highwatch_manor/manor_plan.py: one storey, the floor at 0.6 everywhere
    // but the dais (1.0)
    boxes: [
      // the great hall: inner walls x +-13, z +-10, under the copper hood (9.9) and the
      // chandeliers; the open roof's trusses all stand above 11.6
      [-12.75, 12.75, 0.6, 9.6, -9.6, 9.6],
      // the front door through the front wall (z -10.9 to -10), its head at 5.8
      [-1.6, 1.6, 0.6, 5.8, -11.0, -9.7],
      // the round arch onto the dais, inside its curve, and the dais bay under its ceiling
      [-3.6, 3.6, 1.0, 8.0, 9.5, 11.1],
      [-5.75, 5.75, 1.0, 9.4, 10.9, 17.15],
      // the arches through the gable walls into the wings (x +-13 to +-13.9)
      [12.6, 14.3, 0.6, 5.8, -2.4, 2.4],
      [-14.3, -12.6, 0.6, 5.8, -2.4, 2.4],
      // the dining hall (west) under its tie beams, the door to the kitchen and the kitchen,
      // short of its range's chimney breast
      [14.15, 23.65, 0.6, 7.9, -6.95, 7.55],
      [21.2, 23.2, 0.6, 5.4, 7.5, 8.9],
      [15.85, 23.65, 0.6, 6.9, 8.85, 13.1],
      // the library (east), clear of its shelves, the door to the chapel and the chapel
      [-22.9, -14.15, 0.6, 7.9, -6.95, 3.9],
      [-19.8, -17.8, 0.6, 5.4, 3.8, 5.9],
      [-21.75, -15.85, 0.6, 7.8, 5.85, 12.15],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
};

/** The fields of a placed building record the air needs (sim/placed_town_kit.ts). */
export interface PlacedTownInteriorBuilding {
  readonly id: string;
  readonly assetId: string;
  readonly walkIn?: boolean;
  readonly placement: {
    readonly x: number;
    readonly z: number;
    readonly rotation: number;
    readonly scale: number;
    readonly lift: number;
  };
}

/** The painted model a record draws: `/models/tidehold/<look>/<name>.glb` -> `<name>`. */
export function placedTownModelName(assetId: string): string {
  return assetId.replace(/^.*\//, '').replace(/\.glb$/, '');
}

/** The models that carry authored air (tests stand each one and pin its air against the
 *  model's baked collision). */
export function placedTownInteriorModels(): readonly string[] {
  return Object.keys(MODEL_AIR);
}

const QUARTER = Math.PI / 2;

/**
 * The camera interior of one walk-in placed building whose anchor stands on ground at
 * `groundY` (the terrain under the anchor, the height the town view stands the model on),
 * or null for a sealed record or a model with no authored air. The model's ground line
 * stands at groundY + scale (the footing) + lift. A quarter turn gives world boxes; any other
 * turn gives the model's own boxes in the building's frame (its anchor and its turn).
 */
export function placedTownCameraInterior(
  building: PlacedTownInteriorBuilding,
  groundY: number,
): CameraInterior | null {
  if (building.walkIn !== true) return null;
  const air = MODEL_AIR[placedTownModelName(building.assetId)];
  if (!air) return null;
  const p = building.placement;
  const s = p.scale;
  const lineY = groundY + s + p.lift;
  const id = `placed_town:${building.id}`;
  const quarters = Math.round(p.rotation / QUARTER);
  if (Math.abs(p.rotation - quarters * QUARTER) > 1e-6) {
    // any other turn: the pieces stay square to the building's own walls, in its frame (the
    // model's axes at the placed scale, the anchor its origin), and so do its doors
    const local: InteriorBox[] = air.boxes.map(([x0, x1, y0, y1, z0, z1]) => [
      x0 * s,
      x1 * s,
      lineY + y0 * s,
      lineY + y1 * s,
      z0 * s,
      z1 * s,
    ]);
    const doors: InteriorOpening[] = air.openings.map((o) => ({
      box: o.box,
      axis: o.axis,
      side: o.side,
    }));
    return cameraInterior(id, local, doors, new Map(), 'preserve-angle', {
      x: p.x,
      z: p.z,
      yaw: p.rotation,
    });
  }
  const boxes: InteriorBox[] = air.boxes.map(([x0, x1, y0, y1, z0, z1]) => {
    const a = localToWorld(p, p.rotation, x0 * s, z0 * s);
    const b = localToWorld(p, p.rotation, x1 * s, z1 * s);
    return [
      Math.min(a.x, b.x),
      Math.max(a.x, b.x),
      lineY + y0 * s,
      lineY + y1 * s,
      Math.min(a.z, b.z),
      Math.max(a.z, b.z),
    ];
  });
  const openings: InteriorOpening[] = air.openings.map((o) => {
    // the opening's outward normal in the model's axes, turned into the world's
    const local = localToWorld(
      { x: 0, z: 0 },
      p.rotation,
      o.axis === 0 ? o.side : 0,
      o.axis === 2 ? o.side : 0,
    );
    const alongX = Math.abs(local.x) > Math.abs(local.z);
    const value = alongX ? local.x : local.z;
    return { box: o.box, axis: alongX ? 0 : 2, side: value > 0 ? 1 : -1 };
  });
  return cameraInterior(id, boxes, openings, new Map(), 'preserve-angle');
}
