// Pure kit floor/wall picking for the dungeon interior builder: which kit
// piece a floor tile, a floor quad subdivision, or a wall slot gets for a
// variant. Extracted from dungeon.ts (monolith ratchet); dungeon.ts is the
// thin consumer. Deterministic and DOM-free so it unit-tests headless (the
// ignivar weight constants come from the tile kit module, which is not).

import { polygonContainsPoint } from '../sim/geometry2d';
import { ignivarArenaFloorTileCenterHasStone } from '../sim/ignivar_arena';
import type { DungeonInteriorVariant } from './dungeon';
import { pickKind } from './dungeon_banner_core';
import { IGNIVAR_FLOOR_KIND_WEIGHTS, IGNIVAR_FLOOR_QUAD_KIND } from './ignivar_tile_kit';

/** Kit floor kind for a 4u tile. `isDelve` is passed in by the caller (the
 *  delve classification lives with the variant union in dungeon.ts). */
export function dungeonFloorKind(
  variant: DungeonInteriorVariant,
  t: number,
  isDelve: boolean,
): string {
  // The Drowned Court dresses as the temple (flooded flagstones, pale walls,
  // faded banners); structural placement keys on the real variant elsewhere.
  if (variant === 'arena_drowned') return dungeonFloorKind('temple', t, false);
  if (variant === 'bastion') {
    return pickKind(
      [
        ['floor_tile_large', 56],
        ['floor_tile_large_rocks', 5],
        ['floor_dirt_large', 4],
        ['floor_dirt_large_rocky', 4],
        ['grate', 8],
        ['quad', 23],
      ],
      t,
    );
  }
  if (variant === 'sanctum') {
    return pickKind(
      [
        ['floor_tile_large', 68],
        ['floor_tile_large_rocks', 7],
        ['floor_dirt_large', 4],
        ['floor_dirt_large_rocky', 4],
        ['quad', 17],
      ],
      t,
    );
  }
  if (variant === 'temple') {
    // flooded flagstones: more broken/weeded subdivisions, grate pits draining
    return pickKind(
      [
        ['floor_tile_large', 52],
        ['floor_tile_large_rocks', 6],
        ['floor_dirt_large', 4],
        ['floor_dirt_large_rocky', 4],
        ['grate', 9],
        ['quad', 25],
      ],
      t,
    );
  }
  if (variant === 'lastkeep') {
    // a KEPT castle floor: whole flags with decorated insets, no dirt, no
    // weeds, no grates (the undercroft cells re-key to the crypt mix)
    return pickKind(
      [
        ['floor_tile_large', 72],
        ['floor_tile_large_rocks', 3],
        ['quad', 25],
      ],
      t,
    );
  }
  if (variant === 'dawnhold') {
    // the garden palace floor: whole pale flags, even fewer breaks than the
    // keep and a richer decorated share (sun-catching insets), no dirt, no
    // weeds, no grates anywhere
    return pickKind(
      [
        ['floor_tile_large', 70],
        ['floor_tile_large_rocks', 2],
        ['quad', 28],
      ],
      t,
    );
  }
  if (variant === 'ignivar') return pickKind(IGNIVAR_FLOOR_KIND_WEIGHTS, t);
  if (isDelve) {
    // collapsed reliquary: grave-dust over cracked flags, more dirt and rubble
    return pickKind(
      [
        ['floor_tile_large', 54],
        ['floor_tile_large_rocks', 10],
        ['floor_dirt_large', 10],
        ['floor_dirt_large_rocky', 8],
        ['quad', 18],
      ],
      t,
    );
  }
  return pickKind(
    [
      ['floor_tile_large', 70],
      ['floor_tile_large_rocks', 6],
      ['floor_dirt_large', 6],
      ['floor_dirt_large_rocky', 5],
      ['quad', 13],
    ],
    t,
  );
}

/** Kit sub-tile kind for the 2u quads a `quad` floor tile subdivides into. */
export function dungeonFloorQuadKind(variant: DungeonInteriorVariant, t: number): string {
  if (variant === 'ignivar') return IGNIVAR_FLOOR_QUAD_KIND;
  if (variant === 'arena_drowned') return dungeonFloorQuadKind('temple', t);
  if (variant === 'bastion') {
    return pickKind(
      [
        ['floor_tile_small', 30],
        ['floor_tile_small_broken_A', 15],
        ['floor_tile_small_broken_B', 15],
        ['floor_tile_small_weeds_A', 18],
        ['floor_tile_small_weeds_B', 18],
        ['floor_tile_small_decorated', 4],
      ],
      t,
    );
  }
  if (variant === 'sanctum') {
    return pickKind(
      [
        ['floor_tile_small', 35],
        ['floor_tile_small_broken_A', 12],
        ['floor_tile_small_broken_B', 12],
        ['floor_tile_small_weeds_A', 8],
        ['floor_tile_small_weeds_B', 8],
        ['floor_tile_small_decorated', 25],
      ],
      t,
    );
  }
  if (variant === 'temple') {
    // damp temple flags: heavy weed growth between cracked, broken tiles
    return pickKind(
      [
        ['floor_tile_small', 26],
        ['floor_tile_small_broken_A', 16],
        ['floor_tile_small_broken_B', 16],
        ['floor_tile_small_weeds_A', 18],
        ['floor_tile_small_weeds_B', 18],
        ['floor_tile_small_decorated', 6],
      ],
      t,
    );
  }
  if (variant === 'lastkeep') {
    // swept castle flags: mostly whole slabs. The decorated tile carries a
    // baked candle cluster, so its share stays LOW: a lit votive here and
    // there reads lived-in, a hall full of them reads like a vigil.
    return pickKind(
      [
        ['floor_tile_small', 70],
        ['floor_tile_small_decorated', 12],
        ['floor_tile_small_broken_A', 9],
        ['floor_tile_small_broken_B', 9],
      ],
      t,
    );
  }
  if (variant === 'dawnhold') {
    // garden-palace flags: swept whole slabs with soft weed tufts breaking
    // through between them (green growing INTO the palace is the identity;
    // the decorated votive tile stays a rare accent, same vigil rule)
    return pickKind(
      [
        ['floor_tile_small', 62],
        ['floor_tile_small_weeds_A', 13],
        ['floor_tile_small_weeds_B', 13],
        ['floor_tile_small_decorated', 8],
        ['floor_tile_small_broken_A', 4],
      ],
      t,
    );
  }
  return pickKind(
    [
      ['floor_tile_small', 40],
      ['floor_tile_small_broken_A', 18],
      ['floor_tile_small_broken_B', 18],
      ['floor_tile_small_weeds_A', 7],
      ['floor_tile_small_weeds_B', 7],
      ['floor_tile_small_decorated', 10],
    ],
    t,
  );
}

/** Kit wall kind for an 8u wall slot. `isDelve` as in dungeonFloorKind. */
export function dungeonWallKind(
  variant: DungeonInteriorVariant,
  t: number,
  isDelve: boolean,
): string {
  if (variant === 'arena_drowned') return dungeonWallKind('temple', t, false);
  if (variant === 'bastion') {
    return pickKind(
      [
        ['wall', 44],
        ['wall_pillar', 22],
        ['wall_cracked', 18],
        ['wall_arched', 8],
        ['wall_archedwindow_gated', 8],
      ],
      t,
    );
  }
  if (variant === 'sanctum') {
    return pickKind(
      [
        ['wall', 46],
        ['wall_pillar', 22],
        ['wall_cracked', 12],
        ['wall_arched', 14],
        ['wall_archedwindow_gated', 6],
      ],
      t,
    );
  }
  if (variant === 'temple') {
    // arched moon-windows let pale light into the flooded halls; weathered, cracked
    return pickKind(
      [
        ['wall', 38],
        ['wall_pillar', 20],
        ['wall_cracked', 18],
        ['wall_arched', 12],
        ['wall_archedwindow_gated', 12],
      ],
      t,
    );
  }
  if (variant === 'lastkeep') {
    // the kept castle: clean coursed masonry, engaged pillars, arched bays
    // and the odd barred window, and NO cracked stone (the undercroft's wall
    // runs re-key to the crypt mix in placeAuthoredWalls)
    return pickKind(
      [
        ['wall', 56],
        ['wall_pillar', 24],
        ['wall_arched', 13],
        ['wall_archedwindow_gated', 7],
      ],
      t,
    );
  }
  if (variant === 'dawnhold') {
    // the garden palace: clean masonry thrown OPEN to the light: nearly a
    // third of every run is arched bays and windows so the halls read
    // daylit, and no cracked stone anywhere
    return pickKind(
      [
        ['wall', 42],
        ['wall_pillar', 26],
        ['wall_arched', 20],
        ['wall_archedwindow_gated', 12],
      ],
      t,
    );
  }
  if (isDelve) {
    // long-sealed reliquary: heavily cracked masonry, the odd gated arch
    return pickKind(
      [
        ['wall', 40],
        ['wall_pillar', 20],
        ['wall_cracked', 26],
        ['wall_arched', 9],
        ['wall_archedwindow_gated', 5],
      ],
      t,
    );
  }
  return pickKind(
    [
      ['wall', 50],
      ['wall_pillar', 22],
      ['wall_cracked', 14],
      ['wall_arched', 9],
      ['wall_archedwindow_gated', 5],
    ],
    t,
  );
}

/** Whether a floor module footprint centered at (x, z) with half-extents
 *  (hw, hd) reaches a polygon-shelled room: its center or any corner lies
 *  inside the shell. The center-only test drops a boundary module the moment
 *  its center steps outside, leaving a bare undershoot band (up to a full
 *  cell) along polygon walls and diagonal cuts; corner inclusion extends the
 *  floor to the wall face and overshoots slightly instead, exactly like the
 *  rectangle path's zMin-2/zMax+2 end rows, and the walls occlude the
 *  overhang. The Ignivar ARENA must keep the center-only predicate at its
 *  call site: the lava moat's lethal mask consumes the exact center-test
 *  tile union, so its floor outline is gameplay, not dressing. */
export function floorFootprintTouchesShell(
  poly: readonly { x: number; z: number }[],
  x: number,
  z: number,
  hw: number,
  hd: number,
): boolean {
  return (
    polygonContainsPoint(poly, x, z) ||
    polygonContainsPoint(poly, x - hw, z - hd) ||
    polygonContainsPoint(poly, x + hw, z - hd) ||
    polygonContainsPoint(poly, x - hw, z + hd) ||
    polygonContainsPoint(poly, x + hw, z + hd)
  );
}

/** Whether the Ignivar ARENA's lava-moat stone carve removes the floor cell
 *  centered at (x, z). The carve is arena ROOM geometry, not tile-kit
 *  styling: all three Ignivar interiors share the 'ignivar' kit VARIANT, but
 *  only the arena room (interior 'ignivar') owns the moat, and its playable
 *  polygon is authored in that room's local frame. Keying this off the
 *  variant stamped the arena octagon onto the Halls, Molten Assembly, and
 *  the Inner Crucible, which is exactly the black stair-step floor voids
 *  those rooms shipped with. */
export function ignivarMoatCarvesFloorCell(interior: string, x: number, z: number): boolean {
  return interior === 'ignivar' && !ignivarArenaFloorTileCenterHasStone(x, z);
}

/** The one room-shape gate for a kit floor module (a 4x4 cell, a 4x2 grate
 *  half, or a 2x2 quad sub-tile) centered at (cx, cz) with half-extents
 *  (hw, hd). Rectangle rooms (no shell polygon) place everything, matching
 *  the grid's deliberate end-row overshoot. The Ignivar ARENA (interior
 *  'ignivar') keeps the strict center predicate because its lava moat's
 *  lethal mask consumes the exact center-test tile union: the floor outline
 *  there is gameplay, not dressing. Every other polygon room keeps a
 *  boundary module whenever any corner of its footprint reaches the shell,
 *  so walls and diagonal cuts get no bare undershoot band. */
export function floorModuleTouchesRoomShell(
  interior: string,
  poly: readonly { x: number; z: number }[] | undefined,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
): boolean {
  if (!poly) return true;
  return interior === 'ignivar'
    ? polygonContainsPoint(poly, cx, cz)
    : floorFootprintTouchesShell(poly, cx, cz, hw, hd);
}
