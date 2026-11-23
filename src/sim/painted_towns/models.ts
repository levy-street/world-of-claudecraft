// The painted Tidehold models a town may stand, measured once at AUTHORED size,
// and the one helper that stands one. Each record is the model's own:
// `reach` the whole ground it covers (porch, stair, awning, chimney) with its
// full height from the bottom of its footing, `walls` the walled body,
// `annexes` the solid parts outside the walls, `doorX` the door along the front
// (local -Z) face, all in the model's own axes (sim/placed_town_kit.ts). The
// numbers are the ones Eastbrook, Fenbridge and Highwatch stand the same models
// by (their layout modules), so every town's collision, rest area and map
// silhouette follow the walls a player sees.
//
// A LOOK is the set of shipped files a model is drawn from: the same geometry
// re-baked with other texture maps (default: Eastbrook's; fenrire: Fenbridge's
// moss; highwatch: Highwatch's Alpine slate; the town looks pantile, shakes,
// diamond, brick and thatch: the town texture library's colour sets and pattern layouts,
// each building with its own stained glass). A look carries only the models
// that were baked in it.
//
// Pure data and geometry: no engine imports, no randomness, no clocks.

import {
  deepFreeze,
  makePlacedTownBuilding,
  type PlacedTownBuilding,
  type PlacedTownMeasurements,
  type Point2,
  placedTownSeat,
  scalePlacedTownMeasurements,
} from '../placed_town_kit';

export type PaintedModel =
  | 'tavern_b'
  | 'tavern'
  | 'hall'
  | 'bank'
  | 'shop_a'
  | 'shop_b'
  | 'smithy'
  | 'house_a'
  | 'house_b'
  | 'house_c';

export type PaintedLook =
  | 'default'
  | 'fenrire'
  | 'highwatch'
  | 'pantile'
  | 'shakes'
  | 'diamond'
  | 'brick'
  | 'thatch';

export interface PaintedModelSpec extends PlacedTownMeasurements {
  /** The model bakes an open doorway onto rooms with authored camera air
   *  (render/placed_town_interior_core.ts): a town stands it walk-in. */
  readonly walkInAir: boolean;
}

export const PAINTED_MODELS: Readonly<Record<PaintedModel, PaintedModelSpec>> = deepFreeze({
  // the big inn (Highwatch's): taproom, stair and loft, a turret at the front's corner
  tavern_b: {
    reach: { x: 1.079, z: -0.864, width: 30.262, height: 22.351, depth: 20.428 },
    walls: { x: 0, z: 0, width: 26, depth: 15 },
    annexes: [
      { name: 'turret', x: 13.5, z: -8.5, width: 3.8, depth: 3.8 },
      { name: 'chimney', x: -13.47, z: -1, width: 1, depth: 2.4 },
    ],
    doorX: -2,
    walkInAir: true,
  },
  // the inn of Eastbrook and Fenbridge, tavern_b's smaller sister
  tavern: {
    reach: { x: 0.272, z: -0.05, width: 22.648, height: 18.78, depth: 16.8 },
    walls: { x: 0, z: 0, width: 20, depth: 13 },
    annexes: [
      { name: 'front_bench', x: -5.1, z: -7.25, width: 5.4, depth: 0.9 },
      { name: 'barrels', x: 10.9, z: -4.9, width: 1.1, depth: 2.3 },
    ],
    doorX: 0,
    walkInAir: true,
  },
  // the chapel: nave and portal, the bell tower at the front's corner
  hall: {
    reach: { x: 1.9255, z: -0.254, width: 18.851, height: 30.5, depth: 24.212 },
    walls: { x: 0, z: 0, width: 12, depth: 22 },
    annexes: [
      { name: 'bell_tower', x: 8.25, z: -9, width: 5.4, depth: 5.4 },
      { name: 'notice_board', x: -4.2, z: -11.8, width: 1.8, depth: 0.6 },
    ],
    doorX: 0,
    walkInAir: true,
  },
  // the bank: the banking hall, the strongroom behind it, a turret on its corner
  bank: {
    reach: { x: -0.7013, z: 0.7819, width: 22.6067, height: 22.5005, depth: 19.8387 },
    walls: { x: 0, z: 0, width: 18, depth: 12.4923 },
    annexes: [
      { name: 'strongroom', x: 0, z: 8.2, width: 5.8, depth: 3.9077 },
      { name: 'turret', x: -9.5923, z: -6.8462, width: 3.2308, depth: 3.2308 },
    ],
    doorX: 0,
    walkInAir: true,
  },
  // the goods shop with the coin-sack sign and a street counter
  shop_a: {
    reach: { x: 0, z: -0.8, width: 13.004, height: 16.28, depth: 12.2 },
    walls: { x: 0, z: 0, width: 11, depth: 8.4 },
    annexes: [
      { name: 'stall_counter', x: 2.375, z: -5.925, width: 3.61, depth: 0.77 },
      { name: 'stall_barrels', x: 4.885, z: -5.762, width: 1.477, depth: 2.169 },
    ],
    doorX: -1.6,
    walkInAir: true,
  },
  // the potion shop with the flask sign, a turret on its corner
  shop_b: {
    reach: { x: 0.4745, z: -0.849, width: 13.649, height: 18.7, depth: 12.702 },
    walls: { x: 0, z: 0, width: 9.4, depth: 9 },
    annexes: [{ name: 'turret', x: 5.19, z: -4.99, width: 2.66, depth: 2.66 }],
    doorX: -0.7,
    walkInAir: true,
  },
  // the smithy: the forge room, the open forge shelter at its +x end
  smithy: {
    reach: { x: 3.4285, z: -0.2955, width: 19.797, height: 12.781, depth: 11.69 },
    walls: { x: 0, z: 0, width: 11, depth: 9 },
    annexes: [
      { name: 'forge_shelter', x: 9.12, z: -0.08, width: 7.24, depth: 9.64 },
      { name: 'chimney', x: -5.97, z: 1, width: 1, depth: 2 },
    ],
    doorX: -1.2,
    walkInAir: true,
  },
  // the cottages and the tower house are sealed: one storey of walls, no rooms
  house_a: {
    reach: { x: 0.2145, z: 0, width: 11.763, height: 12.23, depth: 9.8 },
    walls: { x: 0, z: 0, width: 9.36, depth: 7.96 },
    doorX: -1.4,
    walkInAir: false,
  },
  house_b: {
    reach: { x: -0.3041, z: 0, width: 15.0123, height: 15.9799, depth: 11.6997 },
    walls: { x: 0, z: 0, width: 12.7538, depth: 8.5538 },
    annexes: [{ name: 'crates', x: -7.0308, z: -1.8231, width: 1.1538, depth: 2.2462 }],
    doorX: 0,
    walkInAir: false,
  },
  house_c: {
    reach: { x: 0.386, z: 0.23, width: 12.764, height: 19.58, depth: 16.264 },
    walls: { x: 0, z: 0, width: 8.56, depth: 11.96 },
    annexes: [{ name: 'tower', x: 4.61, z: 6.31, width: 2.76, depth: 2.76 }],
    doorX: -1.6,
    walkInAir: false,
  },
});

/** Where each look's files live (one `<model>.glb` per model, with its tiers). */
export const PAINTED_LOOK_SETS: Readonly<Record<PaintedLook, string>> = deepFreeze({
  default: '/models/tidehold',
  fenrire: '/models/tidehold/fenrire',
  highwatch: '/models/tidehold/highwatch',
  pantile: '/models/tidehold/pantile',
  shakes: '/models/tidehold/shakes',
  diamond: '/models/tidehold/diamond',
  brick: '/models/tidehold/brick',
  thatch: '/models/tidehold/thatch',
});

/** The models each look was baked for. */
export const PAINTED_LOOK_MODELS: Readonly<Record<PaintedLook, readonly PaintedModel[]>> =
  deepFreeze({
    default: [
      'tavern_b',
      'tavern',
      'hall',
      'bank',
      'shop_a',
      'shop_b',
      'smithy',
      'house_a',
      'house_b',
      'house_c',
    ],
    fenrire: ['hall', 'house_a', 'shop_a', 'shop_b', 'tavern'],
    highwatch: ['bank', 'hall', 'house_c', 'shop_a', 'smithy', 'tavern_b'],
    pantile: ['house_a', 'shop_a', 'tavern'],
    shakes: ['hall', 'house_a', 'tavern'],
    diamond: ['hall', 'house_c', 'shop_a', 'smithy', 'tavern'],
    brick: ['hall', 'house_a', 'shop_a', 'smithy', 'tavern'],
    thatch: ['hall', 'house_a', 'house_b', 'smithy', 'tavern'],
  });

/** A visitor stands this far off the wall face at a door at authored size; the
 *  step grows with the building (its stoop and overhang grow too). */
const FRONT_CLEARANCE = 1.8;

export interface PaintedTownBuildingSpec {
  readonly id: string;
  readonly kind: 'house' | 'inn' | 'chapel';
  readonly model: PaintedModel;
  readonly look: PaintedLook;
  /** Where the model's own origin stands. */
  readonly anchor: Point2;
  /** The model's turn: 0 puts the door toward -z, PI toward +z, PI/2 toward -x. */
  readonly rotation: number;
  /** One uniform size over authored (grand towns stand doors at about 5 yd). */
  readonly scale: number;
  /** Absent: walk-in exactly when the model has rooms (walkInAir). */
  readonly walkIn?: boolean;
}

/**
 * One painted building of a town: the model's measurements carried to the
 * building's scale, drawn from its look's file, on the seat every grand town
 * gives them (the lift buries the scaled footing; a visitor stands 1.8 yd times
 * the scale off the door). A look without the model, or a walk-in sealed
 * model, is an authoring error and throws when the layout module loads.
 */
export function paintedTownBuilding(spec: PaintedTownBuildingSpec): PlacedTownBuilding {
  if (!PAINTED_LOOK_MODELS[spec.look].includes(spec.model)) {
    throw new Error(`painted look '${spec.look}' has no '${spec.model}' (${spec.id})`);
  }
  const { walkInAir, ...measurements } = PAINTED_MODELS[spec.model];
  const walkIn = spec.walkIn ?? walkInAir;
  if (walkIn && !walkInAir) {
    throw new Error(
      `painted model '${spec.model}' is sealed and cannot stand walk-in (${spec.id})`,
    );
  }
  return makePlacedTownBuilding(
    {
      id: spec.id,
      assetId: `${PAINTED_LOOK_SETS[spec.look]}/${spec.model}.glb`,
      kind: spec.kind,
      anchor: spec.anchor,
      rotation: spec.rotation,
      ...scalePlacedTownMeasurements(measurements, spec.scale),
      walkIn,
    },
    placedTownSeat(spec.scale, FRONT_CLEARANCE * spec.scale),
  );
}
