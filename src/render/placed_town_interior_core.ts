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
//  - guild (the Highwatch adventurers' guild, built in this repo): the great hall clear of
//    the guildmaster's hearth and the quartermaster's shelves, the front door, the arch
//    and the trophy hall behind it, short of its hearth.
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

/** The authored air per painted model (the geometry name, shared by every look). */
const MODEL_AIR: Readonly<Record<string, ModelAir>> = {
  tavern_b: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-12.35, 12.35, 0.45, 5.25, -6.85, 6.85],
      [-3.5, -0.5, 0.45, 4.6641, -7.6, -6.05],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  tavern: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-9.35, 9.35, 0.45, 5.25, -5.85, 5.85],
      [-1.5, 1.5, 0.45, 4.6641, -6.6, -5.05],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  bank: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-8.35, 8.35, 0.45, 5.45, -5.5962, 5.5962],
      [-1.34, 1.34, 0.45, 4.2146, -6.3461, -4.7961],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  hall: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-5.35, 5.35, 0.9, 8.9, -10.35, 10.35],
      [-1.79, 1.79, 0.9, 5.9288, -11.1, -9.55],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  shop_a: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-4.85, 4.85, 0.45, 4.25, -3.55, 3.55],
      [-2.76, -0.44, 0.45, 3.7089, -4.3, -2.75],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  shop_b: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-4.05, 4.05, 0.45, 4.25, -3.85, 3.85],
      [-1.86, 0.46, 0.45, 3.7089, -4.6, -3.05],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  smithy: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-4.85, 4.85, 0.45, 4.85, -3.85, 3.85],
      [-2.6, 0.2, 0.45, 4.3831, -4.6, -3.05],
    ],
    openings: [{ box: 1, axis: 2, side: -1 }],
  },
  guild: {
    // the hand-built lot (scripts/assets/eastbrook_houses/lots.py): its room under the
    // ceiling, then each doorway through its wall
    boxes: [
      [-14.25, 14.25, 0.6, 10, -10.25, 10.25],
      [-1.61, 1.61, 0.6, 5.1231, -11, -9.45],
      [-2.8, 2.8, 0.6, 6.25, 9.45, 11.8],
      [-8.6, 8.6, 0.6, 7.35, 11.15, 19.15],
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
