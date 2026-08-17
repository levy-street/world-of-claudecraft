// Dawnhold Castle's lived-in furnishing: KayKit castle (kcas) furniture GLBs
// plus the registered Evergarden flower props (planter beds, flowering
// shrubs, glow blossoms, the leafy fox topiary) instanced along the authored
// room walls of the dawnhold interior. A sibling module the interior builder
// calls (the lastkeep_dressing idiom), not a method bank on dungeon.ts.
//
// The spot list is PURE data derived from the same DAWNHOLD_ROOMS/DOORS/DECOR
// tables the sim builds collision from, so tests/dawnhold.test.ts can assert
// the placement contract without a renderer: every piece sits inside a room,
// off the stair ramps, keeps a 1.5yd lane through every doorway, and never
// lands on a sim decor collider. The furniture itself carries NO collider (it
// hugs the walls by construction); the sim's decor list stays the collision
// truth.
//
// Assets load through PROP_ASSET_DEFS urls via loadGltf: props.ts preloads the
// whole registry at boot, so these are cache hits, and a missing model simply
// skips its spots instead of breaking the interior.

import * as THREE from 'three';
import {
  type AuthoredRoom,
  DAWNHOLD_DECOR,
  DAWNHOLD_DOORS,
  DAWNHOLD_ROOMS,
} from '../sim/dungeon_layout';
import { authoredLiftAt } from '../sim/rift/authored';
import { loadGltf } from './assets/loader';
import { PROP_ASSET_DEFS } from './props';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const DAWNHOLD_DRESSING_KEYS = [
  // The kcas lived-in set the Last Keep already ships (all preloaded).
  'kcasBookcase',
  'kcasTableLong',
  'kcasTableCloth',
  'kcasTableRoundSmall',
  'kcasTableRoundMedium',
  'kcasBench',
  'kcasChair',
  'kcasStool',
  'kcasKeg',
  'kcasBarrel',
  'kcasCrateSmall',
  'kcasBedRoyal',
  'kcasChest',
  'kcasShelfSmall',
  'kcasShelfBooks',
  'kcasShelfCandles',
  'kcasBartopMedium',
  'kcasCandleTriple',
  'kcasTorch',
  'kcasTorchMounted',
  'kcasShrine',
  // The garden heraldry: the GREEN banner colorway the exterior bailey flies
  // (dawnhold_features.ts), never the keep's red.
  'kcasBannerGreenA',
  'kcasBannerGreenShield',
  'kcasBannerGreenTriple',
  // The conservatory's growing things: the Evergarden's modeled flower beds
  // as indoor planters, flowering shrubs, glow blossoms, and the leafy fox.
  'flowerBedSquareA',
  'flowerBedSquareB',
  'flowerBedRound',
  'shrubFlowering',
  'flowerGlow',
  'leafyFoxStatue',
] as const;
export type DawnholdDressingKind = (typeof DAWNHOLD_DRESSING_KEYS)[number];

// Warm daylight-candle glow for the mounted sconces: the same hue as
// TORCH_COLORS.dawnhold.light in dungeon.ts (kept in sync by hand; this
// module must not import dungeon.ts or the two would cycle).
const DAWNHOLD_TORCH_LIGHT = 0xffc061;

export interface DawnholdDressingSpot {
  kind: DawnholdDressingKind;
  x: number;
  z: number;
  /** absolute y (room lift + any mount height) */
  y: number;
  yaw: number;
  s: number;
  /** footprint clearance radius, for the doorway-lane contract test */
  clearR: number;
  /** wall-mounted (banners, sconces, shelves): exempt from the floor-lane contract */
  mounted: boolean;
  /** sconce/candle/torch spots additionally emit a warm point light */
  light?: boolean;
}

const roomById = new Map<string, AuthoredRoom>(DAWNHOLD_ROOMS.map((r) => [r.id, r]));
const lift = (id: string): number => roomById.get(id)?.lift ?? 0;

// Footprint clearance radius per kind at scale 1 (half the model's larger
// horizontal extent; kcas values measured for lastkeep_dressing, the flower
// props from their overworld placements).
const CLEAR_R: Record<DawnholdDressingKind, number> = {
  kcasBookcase: 2.0,
  kcasTableLong: 2.0,
  kcasTableCloth: 2.0,
  kcasTableRoundSmall: 0.5,
  kcasTableRoundMedium: 1.0,
  kcasBench: 0.9,
  kcasChair: 0.4,
  kcasStool: 0.4,
  kcasKeg: 0.95,
  kcasBarrel: 0.9,
  kcasCrateSmall: 0.75,
  kcasBedRoyal: 1.55,
  kcasChest: 0.85,
  kcasShelfSmall: 0.5,
  kcasShelfBooks: 0.5,
  kcasShelfCandles: 0.5,
  kcasBartopMedium: 1.0,
  kcasCandleTriple: 0.25,
  kcasTorch: 0.3,
  kcasTorchMounted: 0.35,
  kcasShrine: 0.55,
  kcasBannerGreenA: 0.8,
  kcasBannerGreenShield: 1.2,
  kcasBannerGreenTriple: 1.9,
  flowerBedSquareA: 3.0,
  flowerBedSquareB: 3.0,
  flowerBedRound: 3.0,
  shrubFlowering: 0.9,
  flowerGlow: 0.5,
  leafyFoxStatue: 1.0,
};

let spotsCache: DawnholdDressingSpot[] | null = null;

/** The full furnishing plan, instance-local. Pure and deterministic. */
export function dawnholdFurnishings(): readonly DawnholdDressingSpot[] {
  if (spotsCache) return spotsCache;
  const out: DawnholdDressingSpot[] = [];
  const add = (
    kind: DawnholdDressingKind,
    room: string,
    x: number,
    z: number,
    yaw: number,
    s: number,
    opts?: { dy?: number; mounted?: boolean; light?: boolean },
  ): void => {
    out.push({
      kind,
      x,
      z,
      y: lift(room) + (opts?.dy ?? 0),
      yaw,
      s,
      clearR: CLEAR_R[kind] * s,
      mounted: opts?.mounted ?? false,
      light: opts?.light,
    });
  };
  const HALF = Math.PI / 2;
  const sconce = (room: string, x: number, z: number, yaw: number): void =>
    add('kcasTorchMounted', room, x, z, yaw, 1.7, { dy: 3.3, mounted: true, light: true });
  // A three-stem candelabrum, on the floor or on a tabletop (dy = the table's
  // scaled top height, since extraction re-zeroes every model's min-y).
  const candle = (room: string, x: number, z: number, opts?: { dy?: number; light?: boolean }) =>
    add('kcasCandleTriple', room, x, z, 0, 1.2, opts);
  // An indoor planter: one of the Evergarden's modeled beds, potted down.
  const planter = (
    kind: 'flowerBedSquareA' | 'flowerBedSquareB' | 'flowerBedRound',
    room: string,
    x: number,
    z: number,
    yaw = 0,
    s = 0.42,
  ): void => add(kind, room, x, z, yaw, s);

  // ---- entrance hall: garden heraldry over both thresholds, sconces down
  // the walls, planters flanking the parlor arch, a waiting bench
  add('kcasBannerGreenShield', 'hall_entrance', -6, -1.35, Math.PI, 1.5, {
    dy: 2.0,
    mounted: true,
  });
  add('kcasBannerGreenShield', 'hall_entrance', 6, -1.35, Math.PI, 1.5, { dy: 2.0, mounted: true });
  add('kcasBannerGreenA', 'hall_entrance', -5, -14.65, 0, 1.5, { dy: 2.0, mounted: true });
  add('kcasBannerGreenA', 'hall_entrance', 5, -14.65, 0, 1.5, { dy: 2.0, mounted: true });
  sconce('hall_entrance', -7.65, -12, HALF);
  sconce('hall_entrance', -7.65, -3, HALF);
  sconce('hall_entrance', 7.65, -12, -HALF);
  sconce('hall_entrance', 7.65, -6, -HALF);
  planter('flowerBedRound', 'hall_entrance', -6.6, -2.9, 0, 0.4);
  planter('flowerBedRound', 'hall_entrance', 6.6, -2.9, 0, 0.4);
  add('kcasBench', 'hall_entrance', 0, -14.6, 0, 1.4);

  // ---- great parlor: the hearth sitting circle, one long laid table with
  // benches, green banners on every wall, planters by the south arch
  add('kcasTableRoundMedium', 'great_parlor', 7.6, 17, 0.2, 1.25);
  add('kcasChair', 'great_parlor', 6.4, 15.9, -2.2, 1.3);
  add('kcasChair', 'great_parlor', 6.6, 18.3, 2.6, 1.3);
  candle('great_parlor', 7.6, 17, { dy: 1.25, light: true });
  add('kcasTableCloth', 'great_parlor', -4.5, 8, 0, 1.5);
  candle('great_parlor', -4.5, 8, { dy: 1.5, light: true });
  for (const bx of [-6.4, -2.6]) {
    for (const bz of [6.4, 9.6]) add('kcasBench', 'great_parlor', bx, bz, HALF, 1.5);
  }
  add('kcasChair', 'great_parlor', -4.5, 4.1, 0, 1.4);
  add('kcasChair', 'great_parlor', -4.5, 11.9, Math.PI, 1.4);
  add('kcasBannerGreenTriple', 'great_parlor', -11.65, 10, HALF, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerGreenTriple', 'great_parlor', 11.65, 21.5, -HALF, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerGreenTriple', 'great_parlor', 0, 22.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  sconce('great_parlor', -11.65, 2, HALF);
  sconce('great_parlor', -11.65, 14, HALF);
  sconce('great_parlor', 11.65, 6.5, -HALF);
  sconce('great_parlor', 11.65, 13.5, -HALF);
  sconce('great_parlor', -11, 22.65, Math.PI);
  planter('flowerBedSquareA', 'great_parlor', -9.5, 1.6, 0, 0.4);
  planter('flowerBedSquareB', 'great_parlor', 9.5, 1.6, 0, 0.4);

  // ---- dining room: the set dinner table under candlelight, a sideboard on
  // the west wall, garden heraldry
  add('kcasTableCloth', 'dining_room', -20, 5, 0, 1.5);
  candle('dining_room', -20, 5, { dy: 1.5, light: true });
  add('kcasChair', 'dining_room', -21.6, 3.6, HALF, 1.3);
  add('kcasChair', 'dining_room', -21.6, 6.4, HALF, 1.3);
  add('kcasChair', 'dining_room', -18.4, 3.6, -HALF, 1.3);
  add('kcasChair', 'dining_room', -18.4, 6.4, -HALF, 1.3);
  add('kcasChair', 'dining_room', -20, 1.4, 0, 1.3);
  add('kcasChair', 'dining_room', -20, 8.6, Math.PI, 1.3);
  add('kcasBartopMedium', 'dining_room', -25.6, 8.5, HALF, 1.4);
  add('kcasBannerGreenShield', 'dining_room', -25.65, 2.5, HALF, 1.5, { dy: 2.2, mounted: true });
  sconce('dining_room', -25.65, 10.5, HALF);
  sconce('dining_room', -20, -0.65, 0);

  // ---- kitchen: the cook's work table, stools, larder stores off the lanes
  add('kcasTableLong', 'kitchen', -19, 22.5, HALF, 1.4);
  candle('kitchen', -19, 22.5, { dy: 1.4, light: true });
  add('kcasStool', 'kitchen', -20.5, 20.4, 0.4, 1.2);
  add('kcasStool', 'kitchen', -17.6, 24.3, -0.9, 1.2);
  add('kcasShelfSmall', 'kitchen', -21, 24.65, Math.PI, 1.3, { dy: 1.4, mounted: true });
  add('kcasKeg', 'kitchen', -25.8, 24.6, 0.4, 1.05);
  add('kcasKeg', 'kitchen', -24, 24.9, 1.9, 1.05);
  add('kcasBarrel', 'kitchen', -25.9, 13.2, 0.8, 1.0);
  add('kcasCrateSmall', 'kitchen', -14.2, 13.4, 0.7, 1.1);
  sconce('kitchen', -25.65, 15.5, HALF);
  sconce('kitchen', -14.35, 21.5, -HALF);

  // ---- garden room, the conservatory: planters along the south and east
  // walls, the centerpiece bed crowned by the leafy fox, flowering shrubs and
  // glow blossoms between, benches facing the beds, standing torches
  planter('flowerBedSquareA', 'garden_room', 19, -2.2);
  planter('flowerBedSquareB', 'garden_room', 24, -2.2);
  planter('flowerBedSquareB', 'garden_room', 31.2, 2, HALF);
  planter('flowerBedSquareA', 'garden_room', 31.2, 7, HALF);
  planter('flowerBedRound', 'garden_room', 31.2, 18);
  planter('flowerBedRound', 'garden_room', 22, 8, 0, 0.5);
  add('leafyFoxStatue', 'garden_room', 22, 8, -0.4, 0.9, { dy: 0.45 });
  add('shrubFlowering', 'garden_room', 14.8, 17.9, 0.9, 1.1);
  add('shrubFlowering', 'garden_room', 17.5, 2.6, 1.8, 1.1);
  add('shrubFlowering', 'garden_room', 27.5, 2.4, 0.7, 1.0);
  add('shrubFlowering', 'garden_room', 26, 18.2, 2.4, 1.1);
  add('flowerGlow', 'garden_room', 16, 5.4, 0.3, 1.0);
  add('flowerGlow', 'garden_room', 20.5, 12.8, 1.4, 1.0);
  add('flowerGlow', 'garden_room', 25, 5.6, 2.2, 1.0);
  add('flowerGlow', 'garden_room', 29.8, 11, 0.8, 1.0);
  add('flowerGlow', 'garden_room', 18, 15.8, 2.9, 1.0);
  add('kcasBench', 'garden_room', 19, 5.2, 0, 1.3);
  add('kcasBench', 'garden_room', 25.2, 10.8, Math.PI, 1.3);
  add('kcasTorch', 'garden_room', 14.7, -2.6, 0, 1.5, { light: true });
  add('kcasTorch', 'garden_room', 31.4, -2.7, 0, 1.5, { light: true });
  add('kcasBannerGreenA', 'garden_room', 24.5, 18.65, Math.PI, 1.5, { dy: 2.2, mounted: true });
  sconce('garden_room', 21.5, -2.65, 0);
  sconce('garden_room', 26.5, -2.65, 0);
  sconce('garden_room', 15.5, 18.65, Math.PI);

  // ---- library nook: bookcases on the east and north walls, a reading
  // table off both door lanes, a standing lamp torch
  add('kcasBookcase', 'library_nook', 25.6, 22.8, -HALF, 1.35);
  add('kcasBookcase', 'library_nook', 25.6, 26.8, -HALF, 1.35);
  add('kcasBookcase', 'library_nook', 19.5, 28.6, Math.PI, 1.35);
  add('kcasTableCloth', 'library_nook', 21, 25.6, 0, 1.3);
  candle('library_nook', 21, 25.6, { dy: 1.3, light: true });
  add('kcasBench', 'library_nook', 19.2, 24.6, HALF, 1.3);
  add('kcasShelfBooks', 'library_nook', 23.5, 28.65, Math.PI, 1.3, { dy: 1.4, mounted: true });
  add('kcasTorch', 'library_nook', 25.9, 20.8, 0, 1.5, { light: true });
  sconce('library_nook', 14.35, 21.5, HALF);

  // ---- the CHAPEL: candle-lit (no braziers): the shrine on the north wall,
  // pew rows split by the aisle, candle shelf and green shield banners
  add('kcasShrine', 'chapel', -8, 32.65, Math.PI, 1.5, { light: true });
  candle('chapel', -10.4, 32.8, { light: true });
  candle('chapel', -5.6, 32.8, { light: true });
  for (const pz of [27.4, 29.6]) {
    add('kcasBench', 'chapel', -10.6, pz, 0, 1.35);
    add('kcasBench', 'chapel', -5.4, pz, 0, 1.35);
  }
  add('kcasShelfCandles', 'chapel', -11.65, 31, HALF, 1.3, { dy: 1.6, mounted: true });
  add('kcasBannerGreenShield', 'chapel', -11, 32.65, Math.PI, 1.4, { dy: 2.2, mounted: true });
  add('kcasBannerGreenShield', 'chapel', -5, 32.65, Math.PI, 1.4, { dy: 2.2, mounted: true });
  sconce('chapel', -4.35, 26.5, -HALF);
  sconce('chapel', -11.65, 26, HALF);

  // ---- the solar stair: sconce-lit landing with a glow blossom pot
  sconce('stair_solar', 4.35, 29, HALF);
  sconce('stair_solar', 11.65, 29, -HALF);
  add('flowerGlow', 'stair_solar', 4.6, 25.4, 1.1, 1.0);

  // ---- the gallery: benches along the south wall, banners and planters on
  // the north, all clear of the stair ramp band (x 6.4..9.6, z 31..37)
  add('kcasBench', 'gallery', -5.6, 35.4, 0, 1.4);
  add('kcasBench', 'gallery', -1, 35.4, 0, 1.4);
  add('kcasBannerGreenTriple', 'gallery', -4, 40.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerGreenShield', 'gallery', 3.5, 40.65, Math.PI, 1.5, { dy: 2.2, mounted: true });
  planter('flowerBedRound', 'gallery', -3.9, 40.8, 0, 0.35);
  planter('flowerBedRound', 'gallery', 9.5, 40.8, 0, 0.35);
  sconce('gallery', -7.65, 35.35, 0);
  sconce('gallery', -0.5, 40.65, Math.PI);

  // ---- bedroom suite: the state bed with its dowry chest, a private round
  // table, bookcase, candle shelf, and a planter by the south wall
  add('kcasBedRoyal', 'bedroom_suite', -22.8, 42.5, HALF, 1.4);
  add('kcasChest', 'bedroom_suite', -19.4, 42.5, HALF, 1.2);
  add('kcasTableRoundSmall', 'bedroom_suite', -13.5, 44.8, 0, 1.25);
  add('kcasChair', 'bedroom_suite', -14.6, 43.7, -2.4, 1.3);
  add('kcasChair', 'bedroom_suite', -12.3, 45.9, 0.7, 1.3);
  candle('bedroom_suite', -13.5, 44.8, { dy: 1.25, light: true });
  add('kcasBookcase', 'bedroom_suite', -16, 46.35, Math.PI, 1.35);
  add('kcasShelfCandles', 'bedroom_suite', -23.65, 38.5, HALF, 1.3, { dy: 1.6, mounted: true });
  add('kcasBannerGreenShield', 'bedroom_suite', -10.35, 44, -HALF, 1.5, {
    dy: 1.8,
    mounted: true,
  });
  planter('flowerBedRound', 'bedroom_suite', -20.5, 35.2, 0, 0.35);
  sconce('bedroom_suite', -23.65, 46, HALF);
  sconce('bedroom_suite', -16, 35.35, 0);

  // ---- the SOLAR: the sunlit upper room: a reading table, shelves, and
  // more growing things than any room but the conservatory
  add('kcasTableCloth', 'solar', 20, 40.5, 0, 1.3);
  candle('solar', 20, 40.5, { dy: 1.3, light: true });
  add('kcasBench', 'solar', 22.9, 40.5, HALF, 1.3);
  add('kcasChair', 'solar', 17.6, 39.3, 0.8, 1.3);
  add('kcasChair', 'solar', 18, 42, -2.5, 1.3);
  add('kcasShelfBooks', 'solar', 25.65, 38, -HALF, 1.3, { dy: 1.4, mounted: true });
  add('kcasShelfCandles', 'solar', 25.65, 42, -HALF, 1.3, { dy: 1.6, mounted: true });
  planter('flowerBedRound', 'solar', 25.4, 35.6, 0, 0.4);
  planter('flowerBedSquareA', 'solar', 15, 44.4, 0, 0.4);
  add('shrubFlowering', 'solar', 23, 44.8, 1.2, 1.0);
  add('flowerGlow', 'solar', 16.3, 36.2, 0.5, 1.0);
  add('kcasBannerGreenTriple', 'solar', 19, 44.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  sconce('solar', 14.35, 42, HALF);
  sconce('solar', 23.5, 44.65, Math.PI);

  // ---- the west guard room: the watch's own mess, benches and a weapon
  // shelf, all clear of the (-9, -8) door lane into the entrance hall
  add('kcasTableLong', 'west_guard', -16, -9, 0, 1.3);
  add('kcasBench', 'west_guard', -16, -11, 0, 1.35);
  add('kcasBench', 'west_guard', -16, -7, Math.PI, 1.35);
  add('kcasStool', 'west_guard', -19.6, -9, 0, 1.2);
  candle('west_guard', -16, -9, { dy: 1.3, light: true });
  add('kcasBarrel', 'west_guard', -21.4, -12.4, 0.4, 1.2);
  add('kcasCrateSmall', 'west_guard', -21.6, -5.9, 1.1, 1.2);
  add('kcasShelfSmall', 'west_guard', -21.65, -9, HALF, 1.3, { dy: 1.5, mounted: true });
  add('kcasBannerGreenA', 'west_guard', -16, -12.65, 0, 1.5, { dy: 2.0, mounted: true });
  sconce('west_guard', -21.65, -12, HALF);
  sconce('west_guard', -12, -12.65, 0);

  // ---- the east guard room: the armoury side, racks and a keg
  add('kcasTableLong', 'east_guard', 16, -9, 0, 1.3);
  add('kcasBench', 'east_guard', 16, -11, 0, 1.35);
  add('kcasStool', 'east_guard', 19.6, -9, 0, 1.2);
  candle('east_guard', 16, -9, { dy: 1.3, light: true });
  add('kcasKeg', 'east_guard', 21.4, -12.2, 0.7, 1.2);
  add('kcasCrateSmall', 'east_guard', 21.5, -6, -0.9, 1.2);
  add('kcasChest', 'east_guard', 11.6, -12.4, 0.3, 1.2);
  add('kcasShelfBooks', 'east_guard', 21.65, -9, -HALF, 1.3, { dy: 1.4, mounted: true });
  add('kcasBannerGreenShield', 'east_guard', 16, -12.65, 0, 1.5, { dy: 2.0, mounted: true });
  sconce('east_guard', 21.65, -12, -HALF);
  sconce('east_guard', 12, -12.65, 0);

  // ---- the orangery: the conservatory's long glass wing, planters down
  // both flanks and a potting bench, clear of the (33, 11) arch
  planter('flowerBedSquareA', 'orangery', 37, 3.5, 0, 0.42);
  planter('flowerBedSquareB', 'orangery', 41.5, 8, 0, 0.42);
  planter('flowerBedRound', 'orangery', 37, 16.5, 0, 0.36);
  planter('flowerBedRound', 'orangery', 42.5, 16.5, 0, 0.36);
  add('shrubFlowering', 'orangery', 43.4, 3, 0.8, 1.1);
  add('shrubFlowering', 'orangery', 35.2, 19, 2.2, 1.0);
  add('flowerGlow', 'orangery', 39.5, 12.5, 0.4, 1.1);
  add('kcasTableCloth', 'orangery', 39.5, 6.5, 0, 1.25);
  add('kcasStool', 'orangery', 39.5, 4.6, 0, 1.2);
  add('kcasBench', 'orangery', 43.6, 12, -HALF, 1.3);
  add('kcasBannerGreenTriple', 'orangery', 39, 0.65, 0, 1.6, { dy: 2.2, mounted: true });
  sconce('orangery', 43.65, 6, -HALF);
  sconce('orangery', 34.35, 15.5, HALF);

  // ---- the east stair: the second climb to the solar, kept clear down its
  // middle for the two ramp bands (z 27..33 at x ~14.5, z 31..37 at x ~20.5)
  add('flowerGlow', 'stair_east', 25.4, 32, 0.6, 1.0);
  add('kcasBarrel', 'stair_east', 17.4, 31.4, 0.5, 1.15);
  sconce('stair_east', 25.65, 32.5, -HALF);

  // ---- the north turret: the quiet room at the top of the house
  add('kcasTableRoundMedium', 'north_turret', -17, 52, 0, 1.3);
  add('kcasChair', 'north_turret', -18.4, 50.9, 0.7, 1.3);
  add('kcasChair', 'north_turret', -15.6, 53.1, -2.4, 1.3);
  candle('north_turret', -17, 52, { dy: 1.35, light: true });
  add('kcasBookcase', 'north_turret', -23.6, 53.5, HALF, 1.35);
  add('kcasChest', 'north_turret', -11.6, 54.2, -0.4, 1.2);
  planter('flowerBedRound', 'north_turret', -20.5, 54.5, 0, 0.34);
  add('kcasBannerGreenA', 'north_turret', -17, 54.65, Math.PI, 1.5, { dy: 2.0, mounted: true });
  sconce('north_turret', -23.65, 54, HALF);
  sconce('north_turret', -10.35, 51, -HALF);

  spotsCache = out;
  return out;
}

// ---------------------------------------------------------------------------
// Asset extraction + instanced build
// ---------------------------------------------------------------------------

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

const partsCache = new Map<DawnholdDressingKind, Part[]>();
let loadTask: Promise<void> | null = null;

// Meshopt-quantized attributes are normalized ints; bake them to plain floats
// FIRST or applyMatrix4/translate clamp world-space values back into the
// normalized [-1, 1] domain and the furniture collapses (the same guard
// dungeon.ts's module extraction and lastkeep_dressing carry). getComponent
// denormalizes.
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

// Bake a loaded scene into parts, xz-centered with min-y at 0. Geometry
// is cloned (loader cache results are immutable); the materials stay the
// loader's shared instances, marked shared so view disposal skips them.
function extractParts(scene: THREE.Group): Part[] {
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone();
    attributeToFloat(geo, 'position');
    attributeToFloat(geo, 'normal');
    geo.applyMatrix4(mesh.matrixWorld);
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    parts.push({ geo: markSharedGeometry(geo), mat: markSharedMaterial(mat) });
  });
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox as THREE.Box3);
  }
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  for (const p of parts) {
    p.geo.translate(-cx, -box.min.y, -cz);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
  }
  return parts;
}

/** Resolve every dressing GLB (cache hits: props.ts preloads the whole
 * registry at boot). A model that fails to load resolves to no parts and its
 * spots are skipped, so a missing asset never breaks the palace. */
export function ensureDawnholdDressing(): Promise<void> {
  loadTask ??= Promise.all(
    DAWNHOLD_DRESSING_KEYS.map(async (key) => {
      try {
        const gltf = await loadGltf(PROP_ASSET_DEFS[key].url);
        partsCache.set(key, extractParts(gltf.scene));
      } catch {
        partsCache.set(key, []);
      }
    }),
  ).then(() => undefined);
  return loadTask;
}

/** Instance the furnishing plan into `group` (instance-local coordinates).
 * `addLight` is the interior's budgeted warm point-light hook
 * (DungeonInteriors.addInfernalLight bound to the group), so sconce light
 * rides the same GFX-tier light budget as every other interior. */
export function buildDawnholdDressing(
  group: THREE.Group,
  addLight: (x: number, z: number, color: number, y?: number, scale?: number) => void,
  lowGfx: boolean,
): void {
  const byKind = new Map<DawnholdDressingKind, DawnholdDressingSpot[]>();
  for (const spot of dawnholdFurnishings()) {
    const list = byKind.get(spot.kind);
    if (list) list.push(spot);
    else byKind.set(spot.kind, [spot]);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (const [kind, list] of byKind) {
    const parts = partsCache.get(kind);
    if (!parts || parts.length === 0) continue;
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach((spot, i) => {
        q.setFromAxisAngle(up, spot.yaw);
        v.set(spot.x, spot.y, spot.z);
        sc.set(spot.s, spot.s, spot.s);
        mesh.setMatrixAt(i, m4.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      // The interior sun rig is dropped underground, so shadows come from
      // nothing here; keep the furniture receive-only like the kit props.
      mesh.castShadow = false;
      mesh.receiveShadow = !lowGfx;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  // Warm candle pools at every sconce, candle, and standing torch. The glow
  // sits near the floor; the point light rides the shared fire-light budget.
  for (const spot of dawnholdFurnishings()) {
    if (!spot.light) continue;
    const floorY = spot.mounted ? spot.y - 3.3 : spot.y;
    addLight(spot.x, spot.z, DAWNHOLD_TORCH_LIGHT, floorY + 0.12, 0.9);
  }
}

/** Test-only window: the placement-contract pieces the vitest asserts. */
export const dawnholdDressingInternalsForTest = {
  keys: DAWNHOLD_DRESSING_KEYS,
  rooms: DAWNHOLD_ROOMS,
  doors: DAWNHOLD_DOORS,
  decor: DAWNHOLD_DECOR,
  liftAt: (x: number, z: number): number => authoredLiftAt(DAWNHOLD_ROOMS, DAWNHOLD_DOORS, x, z),
};
