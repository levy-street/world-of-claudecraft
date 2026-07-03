// Unit tests for src/ui/delve_map.ts: pure logic, no DOM/canvas.
import { describe, expect, it } from 'vitest';
import { DELVE_MODULE_LAYOUTS, type DelveModuleId } from '../src/sim/delve_layout';
import { isLitanyModuleId, litanyModuleGeometry } from '../src/sim/delve_litany_layout';
import {
  delveAreaLabel,
  delveSchematicPlayer,
  delveSchematicStatic,
  playerDelveLocal,
} from '../src/ui/delve_map';

// ---- Label composition -------------------------------------------------------

describe('delveAreaLabel', () => {
  it('joins the delve name and the (already localized) module name with a colon', () => {
    const label = delveAreaLabel('The Collapsed Reliquary', 'The Sunken Ossuary');
    expect(label).toBe('The Collapsed Reliquary: The Sunken Ossuary');
  });

  it('returns only the delve name when the module name is empty', () => {
    const label = delveAreaLabel('The Collapsed Reliquary', '');
    expect(label).toBe('The Collapsed Reliquary');
  });
});

// ---- Instance-local coords --------------------------------------------------

describe('playerDelveLocal', () => {
  it('computes local coords relative to origin', () => {
    const origin = { x: 3600, z: -1250 };
    const { localX, localZ } = playerDelveLocal(3608, -1220, origin);
    expect(localX).toBeCloseTo(8, 5);
    expect(localZ).toBeCloseTo(30, 5);
  });

  it('returns (0, 0) when player is exactly at origin', () => {
    const origin = { x: 3600, z: -1250 };
    const { localX, localZ } = playerDelveLocal(3600, -1250, origin);
    expect(localX).toBe(0);
    expect(localZ).toBe(0);
  });
});

// ---- Schematic static primitives -------------------------------------------

describe('delveSchematicStatic', () => {
  const CANVAS_SIZE = 280;
  const PAD = 16;

  for (const moduleId of Object.keys(DELVE_MODULE_LAYOUTS) as DelveModuleId[]) {
    it(`${moduleId}: all primitives are within canvas bounds`, () => {
      const layout = DELVE_MODULE_LAYOUTS[moduleId];
      const prims = delveSchematicStatic(layout, CANVAS_SIZE, PAD);
      expect(prims.length).toBeGreaterThan(0);
      for (const prim of prims) {
        if (prim.kind === 'polygon') {
          for (const point of prim.points) {
            expect(point.cx).toBeGreaterThanOrEqual(-1);
            expect(point.cx).toBeLessThanOrEqual(CANVAS_SIZE + 1);
            expect(point.cy).toBeGreaterThanOrEqual(-1);
            expect(point.cy).toBeLessThanOrEqual(CANVAS_SIZE + 1);
          }
        } else if (prim.kind === 'circle') {
          // True-scale pools can legitimately extend past the walkable outline
          // (authored to bleed under walls); the painter clips them to the
          // outline polygon, whose points are bounds-checked above. Only the
          // CENTER must stay inside for a clipped prim; unclipped prims must
          // fit whole (y extent uses ry: the schematic maps x/z anisotropically).
          const ry = prim.ry ?? prim.r;
          if (prim.clipToOutline) {
            expect(prim.cx).toBeGreaterThanOrEqual(-1);
            expect(prim.cx).toBeLessThanOrEqual(CANVAS_SIZE + 1);
            expect(prim.cy).toBeGreaterThanOrEqual(-1);
            expect(prim.cy).toBeLessThanOrEqual(CANVAS_SIZE + 1);
          } else {
            expect(prim.cx + prim.r).toBeLessThanOrEqual(CANVAS_SIZE + 1);
            expect(prim.cx - prim.r).toBeGreaterThanOrEqual(-1);
            expect(prim.cy + ry).toBeLessThanOrEqual(CANVAS_SIZE + 1);
            expect(prim.cy - ry).toBeGreaterThanOrEqual(-1);
          }
        } else if (prim.kind === 'rect') {
          expect(prim.x).toBeLessThanOrEqual(CANVAS_SIZE);
          expect(prim.y).toBeLessThanOrEqual(CANVAS_SIZE);
          expect(prim.x + prim.w).toBeGreaterThanOrEqual(0);
          expect(prim.y + prim.h).toBeGreaterThanOrEqual(0);
        } else if (prim.kind === 'text') {
          expect(prim.cx).toBeGreaterThanOrEqual(0);
          expect(prim.cx).toBeLessThanOrEqual(CANVAS_SIZE);
        }
      }
    });

    it(`${moduleId}: has at least a floor rect, dais, and exit marker`, () => {
      const layout = DELVE_MODULE_LAYOUTS[moduleId];
      const prims = delveSchematicStatic(layout, CANVAS_SIZE, PAD);
      const rects = prims.filter((p) => p.kind === 'rect');
      const islandRects = prims.filter((p) => p.kind === 'rect' && p.fill === '#203026');
      const circles = prims.filter((p) => p.kind === 'circle');
      const texts = prims.filter((p) => p.kind === 'text');
      if (isLitanyModuleId(moduleId)) expect(islandRects.length).toBeGreaterThanOrEqual(1);
      else expect(rects.length).toBeGreaterThanOrEqual(1); // floor
      expect(circles.length).toBeGreaterThanOrEqual(2); // dais + exit
      expect(texts.length).toBeGreaterThanOrEqual(1); // 'N' exit label
    });
  }

  it('flags the outline polygon and clips pool/island prims (the painter contract)', () => {
    const layout = DELVE_MODULE_LAYOUTS.litany_apse;
    const prims = delveSchematicStatic(layout, CANVAS_SIZE, PAD);
    const outline = prims.find((p) => p.kind === 'polygon' && p.isOutline);
    expect(outline).toBeDefined();
    const pools = prims.filter(
      (p): p is Extract<(typeof prims)[number], { kind: 'circle' }> =>
        p.kind === 'circle' && p.fill === '#071512',
    );
    expect(pools.length).toBeGreaterThan(0);
    for (const p of pools) {
      expect(p.clipToOutline).toBe(true); // pools may bleed past the outline
      expect(typeof p.ry).toBe('number'); // anisotropic: ellipse, not circle
    }
    const islands = prims.filter(
      (p): p is Extract<(typeof prims)[number], { kind: 'rect' }> =>
        p.kind === 'rect' && p.fill === '#203026',
    );
    expect(islands.length).toBeGreaterThan(0);
    for (const p of islands) expect(p.clipToOutline).toBe(true);
    // Islands paint after every pool so the dry stones read on top on the map.
    const lastPool = prims.reduce(
      (last, p, i) => (p.kind === 'circle' && p.fill === '#071512' ? i : last),
      -1,
    );
    const firstIsland = prims.findIndex((p) => p.kind === 'rect' && p.fill === '#203026');
    expect(firstIsland).toBeGreaterThan(lastPool);
  });

  it('litany_sluice draws irregular walkable geometry instead of one full room rectangle', () => {
    const layout = DELVE_MODULE_LAYOUTS.litany_sluice;
    const prims = delveSchematicStatic(layout, CANVAS_SIZE, PAD);
    const islandRects = prims.filter((prim) => prim.kind === 'rect' && prim.fill === '#203026');
    const fullRoomRects = prims.filter(
      (prim) =>
        prim.kind === 'rect' &&
        prim.w > CANVAS_SIZE - PAD * 2 - 2 &&
        prim.h > CANVAS_SIZE - PAD * 2 - 2,
    );
    expect(islandRects.length).toBeGreaterThan(0);
    expect(fullRoomRects).toHaveLength(0);
  });

  it('Litany map primitives include the larger Blackwater hazards', () => {
    const layout = DELVE_MODULE_LAYOUTS.litany_baptistry;
    const geo = litanyModuleGeometry('litany_baptistry');
    expect(geo).toBeDefined();
    if (!geo) return;
    const prims = delveSchematicStatic(layout, CANVAS_SIZE, PAD);
    const blackwater = prims.filter(
      (prim) => prim.kind === 'circle' && prim.fill === '#071512' && prim.stroke === '#65a765',
    );
    expect(blackwater.length).toBeGreaterThanOrEqual(geo.hazards.length);
    expect(geo.hazards[0].r).toBeGreaterThanOrEqual(10);
  });
});

// ---- Player arrow -----------------------------------------------------------

describe('delveSchematicPlayer', () => {
  it('places the arrow within canvas when player is at module centre', () => {
    const layout = DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
    const centreZ = (layout.zMin + layout.zMax) / 2;
    const arrow = delveSchematicPlayer(0, centreZ, 0, layout, 162, 8);
    expect(arrow.kind).toBe('arrow');
    expect(arrow.cx).toBeGreaterThanOrEqual(0);
    expect(arrow.cx).toBeLessThanOrEqual(162);
    expect(arrow.cy).toBeGreaterThanOrEqual(0);
    expect(arrow.cy).toBeLessThanOrEqual(162);
  });

  it('passes facing as negated angle (matches hud.ts -p.facing convention)', () => {
    const layout = DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
    const facing = Math.PI / 4;
    const arrow = delveSchematicPlayer(0, 20, facing, layout, 162, 8);
    expect(arrow.angle).toBeCloseTo(-facing, 5);
  });
});
