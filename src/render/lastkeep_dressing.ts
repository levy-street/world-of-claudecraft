// The Last Keep's lived-in furnishing: KayKit castle (kcas) furniture GLBs
// instanced along the authored room walls of the lastkeep interior. A sibling
// module the interior builder calls (the rift_decor idiom), not a method bank
// on dungeon.ts.
//
// The spot list is PURE data derived from the same LASTKEEP_ROOMS/DOORS/DECOR
// tables the sim builds collision from, so tests/last_keep.test.ts can assert
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
  LASTKEEP_DECOR,
  LASTKEEP_DOORS,
  LASTKEEP_ROOMS,
} from '../sim/dungeon_layout';
import { authoredLiftAt } from '../sim/rift/authored';
import { loadGltf } from './assets/loader';
import { PROP_ASSET_DEFS } from './props';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const KEEP_DRESSING_KEYS = [
  'kcasBookcase',
  'kcasTableLong',
  'kcasBench',
  'kcasKeg',
  'kcasBarrel',
  'kcasChestGold',
  'kcasTorch',
  'kcasTorchMounted',
  'kcasBannerRedA',
  'kcasBannerRedShield',
  'kcasBannerRedTriple',
  // The castle-v3 lived-in set (KayKit tavern furniture under models/dungeon):
  // beds for every bedroom, seating and clothed tables for the dining rooms,
  // wall shelves, buffet counters, candelabra, crates, the armory's wall
  // racks, and the chapel shrine.
  'kcasBedRoyal',
  'kcasBedDouble',
  'kcasBedSingle',
  'kcasBedBunk',
  'kcasBedCot',
  'kcasBedroll',
  'kcasChair',
  'kcasStool',
  'kcasStoolRound',
  'kcasTableRoundSmall',
  'kcasTableRoundMedium',
  'kcasTableCloth',
  'kcasShelfLarge',
  'kcasShelfSmall',
  'kcasShelfBooks',
  'kcasShelfCandles',
  'kcasBarA',
  'kcasBarB',
  'kcasBarC',
  'kcasBartopMedium',
  'kcasCandleTriple',
  'kcasCrateLarge',
  'kcasCrateSmall',
  'kcasCratesStacked',
  'kcasSwordShield',
  'kcasShrine',
  'kcasChest',
] as const;
export type KeepDressingKind = (typeof KEEP_DRESSING_KEYS)[number];

// Warm candle light for the mounted torch sconces: the same hue as
// TORCH_COLORS.lastkeep.light in dungeon.ts (kept in sync by hand; this module
// must not import dungeon.ts or the two would cycle).
const KEEP_TORCH_LIGHT = 0xffa14e;

export interface KeepDressingSpot {
  kind: KeepDressingKind;
  x: number;
  z: number;
  /** absolute y (room lift + any mount height) */
  y: number;
  yaw: number;
  s: number;
  /** footprint clearance radius, for the doorway-lane contract test */
  clearR: number;
  /** wall-mounted (banners, sconces): exempt from the floor-lane contract */
  mounted: boolean;
  /** sconce spots additionally emit a warm point light */
  light?: boolean;
}

const roomById = new Map<string, AuthoredRoom>(LASTKEEP_ROOMS.map((r) => [r.id, r]));
const lift = (id: string): number => roomById.get(id)?.lift ?? 0;

// Footprint clearance radius per kind at scale 1 (half the model's larger
// horizontal extent, measured from the GLBs).
const CLEAR_R: Record<KeepDressingKind, number> = {
  kcasBookcase: 2.0,
  kcasTableLong: 2.0,
  kcasBench: 0.9,
  kcasKeg: 0.95,
  kcasBarrel: 0.9,
  kcasChestGold: 1.15,
  kcasTorch: 0.3,
  kcasTorchMounted: 0.35,
  kcasBannerRedA: 0.8,
  kcasBannerRedShield: 1.2,
  kcasBannerRedTriple: 1.9,
  kcasBedRoyal: 1.55,
  kcasBedDouble: 1.75,
  kcasBedSingle: 1.5,
  kcasBedBunk: 1.6,
  kcasBedCot: 1.5,
  kcasBedroll: 1.5,
  kcasChair: 0.4,
  kcasStool: 0.4,
  kcasStoolRound: 0.4,
  kcasTableRoundSmall: 0.5,
  kcasTableRoundMedium: 1.0,
  kcasTableCloth: 2.0,
  kcasShelfLarge: 1.0,
  kcasShelfSmall: 0.5,
  kcasShelfBooks: 0.5,
  kcasShelfCandles: 0.5,
  kcasBarA: 1.0,
  kcasBarB: 1.0,
  kcasBarC: 1.0,
  kcasBartopMedium: 1.0,
  kcasCandleTriple: 0.25,
  kcasCrateLarge: 1.0,
  kcasCrateSmall: 0.75,
  kcasCratesStacked: 1.15,
  kcasSwordShield: 1.15,
  kcasShrine: 0.55,
  kcasChest: 0.85,
};

let spotsCache: KeepDressingSpot[] | null = null;

/** The full furnishing plan, instance-local. Pure and deterministic. */
export function lastKeepFurnishings(): readonly KeepDressingSpot[] {
  if (spotsCache) return spotsCache;
  const out: KeepDressingSpot[] = [];
  const add = (
    kind: KeepDressingKind,
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

  // ---- entrance hall: heraldry over the threshold, sconces down both walls
  add('kcasBannerRedShield', 'hall_entrance', -7, 6.65, Math.PI, 1.5, { dy: 2.0, mounted: true });
  add('kcasBannerRedShield', 'hall_entrance', 7, 6.65, Math.PI, 1.5, { dy: 2.0, mounted: true });
  add('kcasBannerRedA', 'hall_entrance', -6, -14.65, 0, 1.5, { dy: 2.0, mounted: true });
  add('kcasBannerRedA', 'hall_entrance', 6, -14.65, 0, 1.5, { dy: 2.0, mounted: true });
  sconce('hall_entrance', -8.65, -12, HALF);
  sconce('hall_entrance', -8.65, -2, HALF);
  sconce('hall_entrance', 10.65, -12, -HALF);
  sconce('hall_entrance', 10.65, 2, -HALF);

  // ---- guard room: the watch's round table and stools, two cots against the
  // west wall, stores, and a crossed-arms rack over the armory door
  add('kcasTableRoundMedium', 'guard_room', -17, -9.5, 0.3, 1.3);
  add('kcasStool', 'guard_room', -15.5, -8.7, 0.8, 1.3);
  add('kcasStool', 'guard_room', -18.4, -8.3, -0.5, 1.3);
  add('kcasStool', 'guard_room', -17.3, -11.4, 2.4, 1.3);
  candle('guard_room', -17, -9.5, { dy: 1.3, light: true });
  add('kcasBedCot', 'guard_room', -21.2, -3.5, HALF, 1.25);
  add('kcasBedCot', 'guard_room', -21.2, -7.2, HALF, 1.25);
  add('kcasCratesStacked', 'guard_room', -23, 2.5, 0.2, 1.1);
  add('kcasKeg', 'guard_room', -11.3, -12.7, 0.6, 1.05);
  add('kcasSwordShield', 'guard_room', -13, 2.65, Math.PI, 1.3, { dy: 1.5, mounted: true });
  sconce('guard_room', -11.35, -12, -HALF);
  sconce('guard_room', -11.35, -1, -HALF);
  sconce('guard_room', -22.65, -6.5, HALF);

  // ---- armory: sword-and-shield racks on the walls, a stocked shelf, and
  // crated arms between the garrison's two doors
  add('kcasSwordShield', 'armory', -22.65, 8, HALF, 1.3, { dy: 1.5, mounted: true });
  add('kcasSwordShield', 'armory', -22.65, 12, HALF, 1.3, { dy: 1.5, mounted: true });
  add('kcasSwordShield', 'armory', -16, 16.65, Math.PI, 1.3, { dy: 1.5, mounted: true });
  add('kcasShelfLarge', 'armory', -15.35, 8.5, -HALF, 1.3, { dy: 1.5, mounted: true });
  add('kcasCrateLarge', 'armory', -15.8, 5.4, 0.4, 1.1);
  add('kcasCratesStacked', 'armory', -22.9, 16.2, 1.1, 1.1);
  add('kcasBarrel', 'armory', -22.9, 6.4, 1.9, 1.0);
  sconce('armory', -15.35, 12.5, -HALF);
  sconce('armory', -22.65, 5.2, HALF);

  // ---- great hall, the feast hall: two rows of clothed feast tables (two
  // laid for the feast: kcasTableLong IS the food-laden decorated tablecloth
  // model) with benches and head chairs, triple banners and sconces the
  // length of both walls, and a banner pair over the throne arch
  for (const [tx, tz, laid] of [
    [-6.5, 20, true],
    [6.5, 20, false],
    [-6.5, 32, false],
    [6.5, 32, true],
  ] as const) {
    add(laid ? 'kcasTableLong' : 'kcasTableCloth', 'great_hall', tx, tz, 0, 1.5);
    if (!laid) candle('great_hall', tx, tz, { dy: 1.5, light: true });
    for (const bx of [tx - 1.9, tx + 1.9]) {
      for (const bz of [tz - 1.6, tz + 1.6]) {
        add('kcasBench', 'great_hall', bx, bz, HALF, 1.5);
      }
    }
    add('kcasChair', 'great_hall', tx, tz - 3.9, 0, 1.4);
    add('kcasChair', 'great_hall', tx, tz + 3.9, Math.PI, 1.4);
  }
  for (const bz of [12, 24, 36]) {
    add('kcasBannerRedTriple', 'great_hall', -12.65, bz, HALF, 1.6, { dy: 2.2, mounted: true });
  }
  for (const bz of [12, 20, 28, 36]) {
    add('kcasBannerRedTriple', 'great_hall', 12.65, bz, -HALF, 1.6, { dy: 2.2, mounted: true });
  }
  add('kcasBannerRedTriple', 'great_hall', -9, 38.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerRedTriple', 'great_hall', 9, 38.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  sconce('great_hall', -12.65, 18, HALF);
  sconce('great_hall', -12.65, 30, HALF);
  sconce('great_hall', 12.65, 18, -HALF);
  sconce('great_hall', 12.65, 34, -HALF);

  // ---- the THRONE ROOM: candle rows flanking the court carpet up to the
  // dais stair, paired triple banners on both long walls, sconces
  for (const cz of [42.5, 45, 47.5, 50, 52.4]) {
    candle('throne_room', -4.8, cz, { light: cz === 45 || cz === 50 });
    candle('throne_room', 4.8, cz, { light: cz === 45 || cz === 50 });
  }
  for (const bz of [42, 50]) {
    add('kcasBannerRedTriple', 'throne_room', -12.65, bz, HALF, 1.6, { dy: 2.2, mounted: true });
    add('kcasBannerRedTriple', 'throne_room', 12.65, bz, -HALF, 1.6, { dy: 2.2, mounted: true });
  }
  add('kcasBannerRedTriple', 'throne_room', -8, 54.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerRedTriple', 'throne_room', 8, 54.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  sconce('throne_room', -12.65, 46.5, HALF);
  sconce('throne_room', 12.65, 52.5, -HALF);
  sconce('throne_room', -11, 54.65, Math.PI);
  sconce('throne_room', 11, 54.65, Math.PI);
  // The dais: shield banners behind the throne, candles at its feet.
  add('kcasBannerRedShield', 'throne_dais', -3, 60.65, Math.PI, 1.5, { dy: 2.0, mounted: true });
  add('kcasBannerRedShield', 'throne_dais', 3, 60.65, Math.PI, 1.5, { dy: 2.0, mounted: true });
  candle('throne_dais', -3.2, 61);
  candle('throne_dais', 3.2, 61);

  // ---- ballroom: a buffet of bar counters under the west banners, benches
  // along the south wall, candle rows on the east and north edges; the dance
  // floor itself stays open
  for (const bx of [-33, -28.5, -24]) add('kcasBench', 'ballroom', bx, 19.8, 0, 1.5);
  add('kcasBarA', 'ballroom', -35.3, 27.2, HALF, 1.4);
  add('kcasBarB', 'ballroom', -35.3, 30, HALF, 1.4);
  add('kcasBarC', 'ballroom', -35.3, 32.8, HALF, 1.4);
  add('kcasBarA', 'ballroom', -35.3, 35.6, HALF, 1.4);
  add('kcasBartopMedium', 'ballroom', -36.6, 28.6, HALF, 1.4);
  add('kcasBartopMedium', 'ballroom', -36.6, 34.2, HALF, 1.4);
  candle('ballroom', -35.3, 27.2, { dy: 1.4, light: true });
  candle('ballroom', -35.3, 32.8, { dy: 1.4, light: true });
  for (const cz of [22, 25.5, 36.5, 40]) candle('ballroom', -15.8, cz);
  candle('ballroom', -20, 42.6);
  candle('ballroom', -23.5, 42.6);
  add('kcasBannerRedTriple', 'ballroom', -36.65, 24, HALF, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerRedTriple', 'ballroom', -36.65, 38, HALF, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerRedTriple', 'ballroom', -22, 42.65, Math.PI, 1.6, { dy: 2.2, mounted: true });
  add('kcasBannerRedTriple', 'ballroom', -15.35, 36, -HALF, 1.6, { dy: 2.2, mounted: true });
  sconce('ballroom', -36.65, 31, HALF);
  sconce('ballroom', -15.35, 20, -HALF);
  sconce('ballroom', -15.35, 40, -HALF);
  sconce('ballroom', -27, 42.65, Math.PI);

  // ---- kitchen: the cook's work table and stools, wall shelf, keg and
  // barrel stores off the lanes
  add('kcasTableLong', 'kitchen', -30, 52, HALF, 1.4);
  add('kcasStool', 'kitchen', -30.5, 49.9, 0.4, 1.2);
  add('kcasStool', 'kitchen', -29, 54.1, -0.9, 1.2);
  add('kcasShelfSmall', 'kitchen', -34, 56.65, Math.PI, 1.3, { dy: 1.4, mounted: true });
  add('kcasKeg', 'kitchen', -36, 56.2, 0.4, 1.05);
  add('kcasKeg', 'kitchen', -34.2, 56.4, 1.9, 1.05);
  add('kcasBarrel', 'kitchen', -36.6, 45.2, 0.8, 1.0);
  add('kcasCrateSmall', 'kitchen', -25.5, 56.6, 0.7, 1.1);
  sconce('kitchen', -25.35, 46.5, -HALF);

  // ---- pantry: the larder, stacked stores and a laden shelf on the walls
  add('kcasShelfLarge', 'pantry', -19, 54.65, Math.PI, 1.3, { dy: 1.5, mounted: true });
  add('kcasKeg', 'pantry', -21, 54.4, 0.7, 1.05);
  add('kcasKeg', 'pantry', -18.9, 54.6, 2.3, 1.05);
  add('kcasBarrel', 'pantry', -18.5, 47.4, 0.3, 1.0);
  add('kcasBarrel', 'pantry', -20.4, 47.6, 1.4, 1.0);
  add('kcasCrateSmall', 'pantry', -16.2, 50, 1.9, 1.1);

  // ---- steward's office: ledger shelves, a small round desk, locked stores
  add('kcasTableRoundSmall', 'steward_office', 19.5, 17, 0, 1.25);
  add('kcasChair', 'steward_office', 18.5, 15.9, -2.6, 1.3);
  candle('steward_office', 19.5, 17, { dy: 1.25, light: true });
  add('kcasShelfBooks', 'steward_office', 20.65, 12.5, -HALF, 1.3, { dy: 1.4, mounted: true });
  add('kcasShelfBooks', 'steward_office', 20.65, 15.5, -HALF, 1.3, { dy: 1.4, mounted: true });
  add('kcasCrateSmall', 'steward_office', 15.3, 11.3, 0.5, 1.1);
  sconce('steward_office', 18, 18.65, Math.PI);

  // ---- the private dining parlor: one clothed table set with chairs, a
  // sideboard against the east wall, heraldry over the head of the table
  add('kcasTableCloth', 'dining_parlor', 18, 30.5, 0, 1.35);
  add('kcasChair', 'dining_parlor', 16.6, 29.3, HALF, 1.3);
  add('kcasChair', 'dining_parlor', 16.6, 31.9, HALF, 1.3);
  add('kcasChair', 'dining_parlor', 19.4, 29.3, -HALF, 1.3);
  add('kcasChair', 'dining_parlor', 19.4, 31.9, -HALF, 1.3);
  add('kcasChair', 'dining_parlor', 18, 27.2, 0, 1.3);
  add('kcasChair', 'dining_parlor', 18, 33.8, Math.PI, 1.3);
  candle('dining_parlor', 18, 30.5, { dy: 1.35, light: true });
  add('kcasBartopMedium', 'dining_parlor', 20.6, 27, -HALF, 1.4);
  add('kcasBannerRedShield', 'dining_parlor', 18, 34.65, Math.PI, 1.5, { dy: 2.2, mounted: true });
  sconce('dining_parlor', 15.35, 32, HALF);

  // ---- council chamber: the plain clothed table over the crest (no feast
  // spread: this is a room for maps and quills), benches all round
  add('kcasTableCloth', 'council', 23, 49, HALF, 1.6);
  candle('council', 23, 49, { dy: 1.6, light: true });
  add('kcasBench', 'council', 20, 46.6, 0, 1.5);
  add('kcasBench', 'council', 26, 46.6, 0, 1.5);
  add('kcasBench', 'council', 20, 51.4, 0, 1.5);
  add('kcasBench', 'council', 26, 51.4, 0, 1.5);
  add('kcasBannerRedShield', 'council', 30.65, 45, -HALF, 1.5, { dy: 2.2, mounted: true });
  sconce('council', 15.35, 49, HALF);
  sconce('council', 26, 54.65, Math.PI);

  // ---- treasury: the crown's gold chest beside the plinth, sealed stores
  add('kcasChestGold', 'treasury', 35.5, 45.8, -0.4, 1.5);
  add('kcasBarrel', 'treasury', 40.8, 47.8, 0.9, 1.0);
  add('kcasBarrel', 'treasury', 40.4, 52.4, 2.1, 1.0);
  add('kcasCrateLarge', 'treasury', 36, 52.8, 1.3, 1.15);

  // ---- the two stairs to the residence: sconce-lit landings
  sconce('stair_grand', 15.35, 61, HALF);
  sconce('stair_grand', 22.65, 61, -HALF);
  sconce('stair_servants', -32.65, 60, HALF);
  sconce('stair_servants', -25.35, 63, -HALF);

  // ---- the long gallery: benches under the north-wall banner row
  for (const bx of [-20, -14, -8, -2, 4, 10]) add('kcasBench', 'gallery', bx, 67.8, 0, 1.5);
  for (const bx of [-16, -6, 6, 16]) {
    add('kcasBannerRedA', 'gallery', bx, 76.65, Math.PI, 1.5, { dy: 1.8, mounted: true });
  }
  sconce('gallery', -11, 67.35, 0);
  sconce('gallery', 1, 67.35, 0);
  sconce('gallery', 13, 67.35, 0);
  sconce('gallery', -21, 76.65, Math.PI);
  sconce('gallery', 21, 76.65, Math.PI);

  // ---- royal chamber: the state bed against the west wall with a dowry
  // chest at its foot, a private round table, shelves, and heraldry
  add('kcasBedRoyal', 'royal_chamber', -38.6, 76, HALF, 1.4);
  add('kcasChest', 'royal_chamber', -35.1, 76, HALF, 1.2);
  add('kcasTableRoundMedium', 'royal_chamber', -31, 72.5, 0.2, 1.25);
  add('kcasChair', 'royal_chamber', -29.7, 71.4, -2.4, 1.3);
  add('kcasChair', 'royal_chamber', -32.4, 73.5, 0.7, 1.3);
  candle('royal_chamber', -31, 72.5, { dy: 1.25, light: true });
  add('kcasBookcase', 'royal_chamber', -30, 82.35, Math.PI, 1.4);
  add('kcasBookcase', 'royal_chamber', -36, 82.35, Math.PI, 1.4);
  add('kcasShelfCandles', 'royal_chamber', -40.65, 80.6, HALF, 1.3, { dy: 1.6, mounted: true });
  add('kcasBannerRedShield', 'royal_chamber', -25.35, 78.5, -HALF, 1.5, {
    dy: 1.8,
    mounted: true,
  });
  sconce('royal_chamber', -38, 69.35, 0);
  sconce('royal_chamber', -33, 82.65, Math.PI);

  // ---- the guest chambers: west holds paired singles, the middle a double,
  // the east the grand double suite with its own sitting corner
  add('kcasBedSingle', 'guest_west', -21.9, 87.3, 0, 1.15);
  add('kcasBedSingle', 'guest_west', -19.1, 87.3, 0, 1.15);
  add('kcasStoolRound', 'guest_west', -20.5, 84.2, 0.4, 1.2);
  candle('guest_west', -20.5, 84.2, { dy: 0.6 });
  add('kcasChest', 'guest_west', -18.7, 82.6, HALF, 1.2);
  sconce('guest_west', -22.65, 81.5, HALF);
  add('kcasBedDouble', 'guest_mid', -13.5, 87.4, 0, 1.2);
  add('kcasChest', 'guest_mid', -11.9, 81.9, HALF, 1.2);
  add('kcasStoolRound', 'guest_mid', -15.8, 84.6, 1.1, 1.2);
  candle('guest_mid', -15.8, 84.6, { dy: 0.6 });
  sconce('guest_mid', -15.65, 88.5, HALF);
  add('kcasBedDouble', 'guest_east', 21, 84, HALF, 1.3);
  add('kcasChest', 'guest_east', 22, 80, 0, 1.2);
  add('kcasTableRoundSmall', 'guest_east', 10.6, 86.6, 0, 1.25);
  add('kcasChair', 'guest_east', 9.6, 85.5, 2.5, 1.3);
  add('kcasChair', 'guest_east', 11.9, 87.6, -0.8, 1.3);
  candle('guest_east', 10.6, 86.6, { dy: 1.25, light: true });
  add('kcasShelfCandles', 'guest_east', 13, 88.65, Math.PI, 1.3, { dy: 1.5, mounted: true });
  sconce('guest_east', 9.35, 80.5, HALF);
  sconce('guest_east', 22.65, 79.3, -HALF);

  // ---- servants' quarters: stacked bunks by the servants' stair
  add('kcasBedBunk', 'servants_quarters', -38.9, 60.3, HALF, 1.25);
  add('kcasBedBunk', 'servants_quarters', -38.9, 65.7, HALF, 1.25);
  add('kcasStool', 'servants_quarters', -37.2, 63.2, 0.6, 1.2);
  add('kcasCrateSmall', 'servants_quarters', -35.9, 67.3, 0.3, 1.1);
  candle('servants_quarters', -35.9, 67.3, { dy: 0.66, light: true });
  sconce('servants_quarters', -35.35, 61.2, -HALF);

  // ---- solar (the study): a reading table ringed by shelves; the north
  // pair parts around the chapel door
  add('kcasTableCloth', 'solar', 0, 84.5, 0, 1.3);
  add('kcasBench', 'solar', 2.9, 84.5, HALF, 1.3);
  candle('solar', 0, 84.5, { dy: 1.3 });
  add('kcasBookcase', 'solar', -6.55, 84, HALF, 1.35);
  add('kcasBookcase', 'solar', 6.55, 82.5, -HALF, 1.35);
  add('kcasBookcase', 'solar', -5, 88.55, Math.PI, 1.35);
  add('kcasBookcase', 'solar', 5, 88.55, Math.PI, 1.35);
  sconce('solar', -6.65, 80.5, HALF);
  sconce('solar', 6.65, 87.5, -HALF);

  // ---- the CHAPEL: candle-lit (no braziers): the shrine against the north
  // wall, pew rows split by the aisle, candle shelves and shield banners
  add('kcasShrine', 'chapel', 0, 98, Math.PI, 1.5, { light: true });
  candle('chapel', -2.6, 98.2, { light: true });
  candle('chapel', 2.6, 98.2, { light: true });
  for (const pz of [92.6, 94.8, 97]) {
    add('kcasBench', 'chapel', -3.6, pz, 0, 1.4);
    add('kcasBench', 'chapel', 3.6, pz, 0, 1.4);
  }
  add('kcasShelfCandles', 'chapel', -6.65, 93.5, HALF, 1.3, { dy: 1.6, mounted: true });
  add('kcasShelfCandles', 'chapel', 6.65, 95.5, -HALF, 1.3, { dy: 1.6, mounted: true });
  add('kcasBannerRedShield', 'chapel', -4, 98.65, Math.PI, 1.4, { dy: 2.2, mounted: true });
  add('kcasBannerRedShield', 'chapel', 4, 98.65, Math.PI, 1.4, { dy: 2.2, mounted: true });
  sconce('chapel', -6.65, 91.2, HALF);
  sconce('chapel', 6.65, 91.2, -HALF);

  // ---- the LIBRARY: bookcase-lined walls, reading tables down the middle
  for (const bz of [65, 71, 77]) add('kcasBookcase', 'library', 40.35, bz, -HALF, 1.4);
  for (const bx of [26.5, 38.5]) add('kcasBookcase', 'library', bx, 61.65, 0, 1.4);
  add('kcasBookcase', 'library', 25.65, 63.5, HALF, 1.4);
  add('kcasBookcase', 'library', 26.6, 78.35, Math.PI, 1.4);
  add('kcasTableCloth', 'library', 30, 70, 0, 1.4);
  add('kcasTableCloth', 'library', 36, 70, 0, 1.4);
  add('kcasBench', 'library', 28.3, 70, HALF, 1.4);
  add('kcasBench', 'library', 37.7, 70, HALF, 1.4);
  candle('library', 30, 70, { dy: 1.4, light: true });
  candle('library', 36, 70, { dy: 1.4 });
  add('kcasTorch', 'library', 25.6, 76.8, 0, 1.5, { light: true });
  sconce('library', 37, 78.65, Math.PI);

  // ---- the watch tower: sconce-lit turn, standing torches on the lookout
  sconce('tower_mid', 29.35, 85, HALF);
  sconce('tower_mid', 36.65, 85, -HALF);
  add('kcasTorch', 'tower_lookout', 29.8, 98.2, 0, 1.5, { light: true });
  add('kcasTorch', 'tower_lookout', 36.2, 98.2, 0, 1.5, { light: true });

  // ---- the undercroft (story 0 keeps its dungeon dressing): the warden's
  // post in the gaol, a prisoner's bedroll per cell, and the stores
  add('kcasTableRoundSmall', 'gaol', 27.5, 2, 0.7, 1.15);
  add('kcasStool', 'gaol', 26.4, 3.1, 1.8, 1.15);
  candle('gaol', 27.5, 2, { dy: 1.15, light: true });
  add('kcasBedroll', 'cell_north', 35.5, 9.3, 0.4, 1.2);
  add('kcasBedroll', 'cell_mid', 35.8, -3.6, 2.1, 1.2);
  add('kcasBedroll', 'cell_south', 35.4, -12.7, 1.2, 1.2);
  add('kcasBarrel', 'storeroom', 36.3, 21.2, 0.4, 1.0);
  add('kcasBarrel', 'storeroom', 35.2, 22.6, 1.6, 1.0);
  add('kcasBarrel', 'storeroom', 36.5, 23.8, 2.7, 1.0);
  add('kcasBarrel', 'storeroom', 24.8, 28.6, 0.9, 1.0);
  add('kcasKeg', 'storeroom', 31.5, 17.6, 0.5, 1.05);
  add('kcasKeg', 'storeroom', 33.6, 17.4, 1.8, 1.05);
  add('kcasKeg', 'storeroom', 30.4, 18.9, 2.9, 1.05);
  add('kcasCratesStacked', 'storeroom', 24.3, 21.5, 0.9, 1.1);
  add('kcasCrateLarge', 'storeroom', 34.5, 27.8, 2.2, 1.15);
  for (const kz of [33.5, 35.7, 37.9, 40.1]) add('kcasKeg', 'wine_cellar', 23.9, kz, HALF, 1.05);
  for (const kz of [33.5, 35.7, 37.9]) add('kcasKeg', 'wine_cellar', 36.1, kz, -HALF, 1.05);
  add('kcasBarrel', 'wine_cellar', 30, 40.4, 0.6, 1.0);
  add('kcasBarrel', 'wine_cellar', 28.2, 40.2, 1.7, 1.0);
  add('kcasBarrel', 'wine_cellar', 31.8, 40.6, 2.5, 1.0);

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

const partsCache = new Map<KeepDressingKind, Part[]>();
let loadTask: Promise<void> | null = null;

// Meshopt-quantized attributes are normalized ints; bake them to plain floats
// FIRST or applyMatrix4/translate clamp world-space values back into the
// normalized [-1, 1] domain and the furniture collapses (the same guard
// dungeon.ts's module extraction carries). getComponent denormalizes.
function attributeToFloat(geo: THREE.BufferGeometry, name: string): void {
  const attr = geo.getAttribute(name);
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
}

// Bake a loaded kcas scene into parts, xz-centered with min-y at 0. Geometry
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

/** Resolve every kcas furniture GLB (cache hits: props.ts preloads the whole
 * registry at boot). A model that fails to load resolves to no parts and its
 * spots are skipped, so a missing asset never breaks the keep. */
export function ensureLastKeepDressing(): Promise<void> {
  loadTask ??= Promise.all(
    KEEP_DRESSING_KEYS.map(async (key) => {
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
export function buildLastKeepDressing(
  group: THREE.Group,
  addLight: (x: number, z: number, color: number, y?: number, scale?: number) => void,
  lowGfx: boolean,
): void {
  const byKind = new Map<KeepDressingKind, KeepDressingSpot[]>();
  for (const spot of lastKeepFurnishings()) {
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
  // Warm candle pools at every sconce and standing torch. The glow decal sits
  // near the floor; the point light rides the shared fire-light budget.
  for (const spot of lastKeepFurnishings()) {
    if (!spot.light) continue;
    const floorY = spot.mounted ? spot.y - 3.3 : spot.y;
    addLight(spot.x, spot.z, KEEP_TORCH_LIGHT, floorY + 0.12, 0.9);
  }
}

/** Test-only window: the placement-contract pieces the vitest asserts. */
export const lastKeepDressingInternalsForTest = {
  keys: KEEP_DRESSING_KEYS,
  rooms: LASTKEEP_ROOMS,
  doors: LASTKEEP_DOORS,
  decor: LASTKEEP_DECOR,
  liftAt: (x: number, z: number): number => authoredLiftAt(LASTKEEP_ROOMS, LASTKEEP_DOORS, x, z),
};
