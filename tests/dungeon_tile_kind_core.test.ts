// Pins for the pure kit floor/wall pickers (src/render/dungeon_tile_kind_core.ts):
// the drowned-arena temple aliasing, the ignivar tile-kit rerouting, and the
// clean-masonry guarantees the kept-castle variants rely on.
import { describe, expect, it } from 'vitest';
import {
  dungeonFloorKind,
  dungeonFloorQuadKind,
  dungeonWallKind,
  floorFootprintTouchesShell,
  floorModuleTouchesRoomShell,
  ignivarMoatCarvesFloorCell,
} from '../src/render/dungeon_tile_kind_core';
import {
  IGNIVAR_FLOOR_KIND_WEIGHTS,
  IGNIVAR_FLOOR_QUAD_KIND,
} from '../src/render/ignivar_tile_kit';
import { IGNIVAR_SECOND_WING_LAYOUT } from '../src/sim/dungeon_layout';

const sweep = (count = 40): number[] => Array.from({ length: count }, (_, i) => i / count);

describe('dungeonFloorKind', () => {
  it('aliases the drowned arena to the temple mix', () => {
    for (const t of sweep()) {
      expect(dungeonFloorKind('arena_drowned', t, false)).toBe(
        dungeonFloorKind('temple', t, false),
      );
    }
  });

  it('routes ignivar through the tile-kit weights', () => {
    const allowed = IGNIVAR_FLOOR_KIND_WEIGHTS.map(([name]) => name);
    for (const t of sweep()) {
      expect(allowed).toContain(dungeonFloorKind('ignivar', t, false));
    }
  });

  it('keeps the kept-castle floors free of dirt and grates', () => {
    for (const variant of ['lastkeep', 'dawnhold'] as const) {
      for (const t of sweep()) {
        const kind = dungeonFloorKind(variant, t, false);
        expect(kind, `${variant} t=${t}`).not.toMatch(/dirt|grate/);
      }
    }
  });

  it('distinguishes the delve mix from the crypt default', () => {
    const delve = sweep(200).map((t) => dungeonFloorKind('crypt', t, true));
    const crypt = sweep(200).map((t) => dungeonFloorKind('crypt', t, false));
    expect(delve).not.toEqual(crypt);
  });
});

describe('dungeonFloorQuadKind', () => {
  it('returns the fixed ignivar quad and aliases the drowned arena to the temple', () => {
    for (const t of sweep()) {
      expect(dungeonFloorQuadKind('ignivar', t)).toBe(IGNIVAR_FLOOR_QUAD_KIND);
      expect(dungeonFloorQuadKind('arena_drowned', t)).toBe(dungeonFloorQuadKind('temple', t));
    }
  });
});

describe('dungeonWallKind', () => {
  it('aliases the drowned arena to the temple walls', () => {
    for (const t of sweep()) {
      expect(dungeonWallKind('arena_drowned', t, false)).toBe(dungeonWallKind('temple', t, false));
    }
  });

  it('keeps the kept-castle walls free of cracked stone', () => {
    for (const variant of ['lastkeep', 'dawnhold'] as const) {
      for (const t of sweep()) {
        expect(dungeonWallKind(variant, t, false), `${variant} t=${t}`).not.toContain('cracked');
      }
    }
  });
});

describe('floorFootprintTouchesShell', () => {
  // The real crucible shell: a twelve-sided room with 45 degree corner cuts,
  // the shape whose center-only mask left bare undershoot bands (the black
  // floor edges in the Inner Crucible and the two ignivar_approach rooms).
  const poly = IGNIVAR_SECOND_WING_LAYOUT.shellPolygon;
  if (!poly) throw new Error('crucible layout lost its shell polygon');

  it('keeps a fully interior cell', () => {
    expect(floorFootprintTouchesShell(poly, 0, 0, 2, 2)).toBe(true);
  });

  it('keeps a wall-straddling cell whose center is outside the shell', () => {
    // Straight east wall runs x=40 between z -16 and 16: a cell centered a
    // hair past it still has its inner corners inside, so it must tile.
    expect(floorFootprintTouchesShell(poly, 41, 0, 2, 2)).toBe(true);
  });

  it('keeps a diagonal-cut cell whose center is outside the shell', () => {
    // The (32,-32) to (40,-16) corner cut: at z=-28 the edge sits at x=34,
    // so the grid cell centered at (36,-28) center-tests outside while its
    // (34,-26) corner is inside. The center-only mask dropped exactly this
    // cell class and left the stair-step voids along every corner cut.
    expect(floorFootprintTouchesShell(poly, 36, -28, 2, 2)).toBe(true);
  });

  it('drops a cell fully outside the shell', () => {
    expect(floorFootprintTouchesShell(poly, 48, 0, 2, 2)).toBe(false);
    expect(floorFootprintTouchesShell(poly, 40, -40, 2, 2)).toBe(false);
  });

  it('respects the narrower grate-half footprint', () => {
    // A 4x2 grate half two units past the east wall reaches back to x=41 at
    // most... its corners at x=39 land inside; the same half four units out
    // (corners at x=43) does not.
    expect(floorFootprintTouchesShell(poly, 41, 0, 2, 1)).toBe(true);
    expect(floorFootprintTouchesShell(poly, 45, 0, 2, 1)).toBe(false);
  });
});

describe('ignivarMoatCarvesFloorCell', () => {
  // The arena's lava-moat carve is ROOM geometry keyed by interior 'ignivar'.
  // All three Ignivar interiors share the kit VARIANT, and keying the carve
  // off the variant stamped the arena octagon onto the Halls, Molten
  // Assembly, and the Inner Crucible: the shipped black floor-void bug.
  it('keeps the arena carve: moat ring stripped, fighting floor kept', () => {
    // (-13, 31): inside the arena shell, outside the playable octagon (moat).
    expect(ignivarMoatCarvesFloorCell('ignivar', -13, 31)).toBe(true);
    // (-1, -1): mid fighting floor.
    expect(ignivarMoatCarvesFloorCell('ignivar', -1, -1)).toBe(false);
  });

  it('never carves the kit-sibling rooms, even far outside the arena octagon', () => {
    // Grid cells the variant-keyed carve used to strip: the Halls and
    // Assembly nave end, and the Inner Crucible's east wall band.
    expect(ignivarMoatCarvesFloorCell('ignivar_approach', 0, -48)).toBe(false);
    expect(ignivarMoatCarvesFloorCell('ignivar_depths', 36, 2)).toBe(false);
    // The same coordinates DO carve in the arena: the interior key is what
    // separates the rooms, not the coordinates.
    expect(ignivarMoatCarvesFloorCell('ignivar', 0, -48)).toBe(true);
    expect(ignivarMoatCarvesFloorCell('ignivar', 36, 2)).toBe(true);
  });
});

describe('floorModuleTouchesRoomShell', () => {
  const poly = IGNIVAR_SECOND_WING_LAYOUT.shellPolygon;
  if (!poly) throw new Error('crucible layout lost its shell polygon');

  it('places everything in rectangle rooms (no shell polygon)', () => {
    expect(floorModuleTouchesRoomShell('crypt', undefined, 999, 999, 2, 2)).toBe(true);
  });

  it('keys the strict center test to the arena interior only', () => {
    // (41, 0): center outside the shell, inner corners inside. The arena's
    // center-only rule drops it; every other room keeps it. This is the
    // switch that both preserves the arena's lethal-mask tile union and
    // closes the undershoot band everywhere else.
    expect(floorModuleTouchesRoomShell('ignivar', poly, 41, 0, 2, 2)).toBe(false);
    expect(floorModuleTouchesRoomShell('ignivar_depths', poly, 41, 0, 2, 2)).toBe(true);
    expect(floorModuleTouchesRoomShell('ignivar_approach', poly, 41, 0, 2, 2)).toBe(true);
  });
});
