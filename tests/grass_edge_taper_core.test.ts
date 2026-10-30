import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eastbrookGrassExclusions } from '../src/render/foliage_core';
import {
  buildingFootprintEdgeTaper,
  createGrassClearanceIndex,
  createGrassEdgeTaperContext,
  createWorldGrassEdgeTaperContext,
  GRASS_EDGE_MIN_COVERAGE_SCALE,
  GRASS_EDGE_MIN_HEIGHT_SCALE,
  GRASS_EDGE_MIN_WIDTH_SCALE,
  GRASS_EXCLUSION_TAPER_SPAN,
  GRASS_HUB_INNER_RADIUS,
  GRASS_HUB_TAPER_SPAN,
  GRASS_ROAD_INNER_RADIUS,
  GRASS_ROAD_TAPER_SPAN,
  grassClearanceAt,
  grassClearEdgeTaper,
  grassEdgeCoverageScale,
  grassEdgeHeightScale,
  grassEdgeTaperAt,
  grassEdgeWidthScale,
  hubEdgeTaper,
  meadowScopedEdgeTaper,
  roadEdgeTaper,
  taperTuftScales,
  townExclusionEdgeTaper,
} from '../src/render/grass_edge_taper_core';
import { BUILTIN_WORLD, PROPS } from '../src/sim/data';
import { roadDistance } from '../src/sim/world';

describe('grass edge taper core', () => {
  it('tapers road edges smoothly from the inner verge cutoff to full meadow height', () => {
    expect(roadEdgeTaper(0)).toBe(0);
    expect(roadEdgeTaper(GRASS_ROAD_INNER_RADIUS)).toBe(0);
    const quarter = roadEdgeTaper(GRASS_ROAD_INNER_RADIUS + GRASS_ROAD_TAPER_SPAN * 0.25);
    const half = roadEdgeTaper(GRASS_ROAD_INNER_RADIUS + GRASS_ROAD_TAPER_SPAN * 0.5);
    const threeQuarters = roadEdgeTaper(GRASS_ROAD_INNER_RADIUS + GRASS_ROAD_TAPER_SPAN * 0.75);
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(half);
    expect(half).toBeCloseTo(0.5, 5);
    expect(threeQuarters).toBeGreaterThan(half);
    expect(threeQuarters).toBeLessThan(1);
    expect(roadEdgeTaper(GRASS_ROAD_INNER_RADIUS + GRASS_ROAD_TAPER_SPAN)).toBe(1);
    expect(roadEdgeTaper(25)).toBe(1);
  });

  it('tapers settlement hub clearings smoothly across the outer verge ring', () => {
    const zones = [{ hub: { x: -14, z: -100 } }];
    expect(hubEdgeTaper(zones, -14, -100)).toBe(0);
    expect(hubEdgeTaper(zones, -14 + GRASS_HUB_INNER_RADIUS - 0.05, -100)).toBe(0);
    const nearVerge = hubEdgeTaper(zones, -14 + GRASS_HUB_INNER_RADIUS + 1.0, -100);
    const midVerge = hubEdgeTaper(
      zones,
      -14 + GRASS_HUB_INNER_RADIUS + GRASS_HUB_TAPER_SPAN * 0.5,
      -100,
    );
    const farVerge = hubEdgeTaper(
      zones,
      -14 + GRASS_HUB_INNER_RADIUS + GRASS_HUB_TAPER_SPAN + 0.1,
      -100,
    );
    expect(nearVerge).toBeGreaterThan(0);
    expect(nearVerge).toBeLessThan(midVerge);
    expect(midVerge).toBeCloseTo(0.5, 5);
    expect(farVerge).toBe(1);
  });

  it('tapers both circle and rotated OBB town exclusions smoothly outside their padding', () => {
    const circleExclusion = [{ kind: 'circle' as const, id: 'apron', x: 10, z: 20, radius: 1.5 }];
    const padding = 0.85;
    expect(townExclusionEdgeTaper(circleExclusion, 10 + 2.3, 20, padding)).toBe(0);
    const circleMid = townExclusionEdgeTaper(
      circleExclusion,
      10 + 1.5 + padding + GRASS_EXCLUSION_TAPER_SPAN * 0.5,
      20,
      padding,
    );
    expect(circleMid).toBeCloseTo(0.5, 5);
    expect(
      townExclusionEdgeTaper(
        circleExclusion,
        10 + 1.5 + padding + GRASS_EXCLUSION_TAPER_SPAN + 0.1,
        20,
        padding,
      ),
    ).toBe(1);

    const rot = Math.PI / 4;
    const obbExclusion = [
      {
        kind: 'obb' as const,
        id: 'stall',
        x: 0,
        z: 0,
        halfWidth: 2,
        halfDepth: 1,
        rotation: rot,
      },
    ];
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const alongLocalX = (distFromCenter: number) => ({
      x: distFromCenter * cos,
      z: -distFromCenter * sin,
    });
    const insidePt = alongLocalX(2 + padding - 0.05);
    const midPt = alongLocalX(2 + padding + GRASS_EXCLUSION_TAPER_SPAN * 0.5);
    const farPt = alongLocalX(2 + padding + GRASS_EXCLUSION_TAPER_SPAN + 0.2);
    expect(townExclusionEdgeTaper(obbExclusion, insidePt.x, insidePt.z, padding)).toBe(0);
    expect(townExclusionEdgeTaper(obbExclusion, midPt.x, midPt.z, padding)).toBeCloseTo(0.5, 5);
    expect(townExclusionEdgeTaper(obbExclusion, farPt.x, farPt.z, padding)).toBe(1);
  });

  it('tapers placed building footprints and painted grass-clear discs', () => {
    const buildings = [{ id: 'cottage', kind: 'house' as const, x: 50, z: 50, w: 6, d: 4, rot: 0 }];
    expect(buildingFootprintEdgeTaper(buildings, 50 + 3.8, 50, 0.85)).toBe(0);
    const bldgMid = buildingFootprintEdgeTaper(
      buildings,
      50 + 3 + 0.85 + GRASS_EXCLUSION_TAPER_SPAN * 0.5,
      50,
      0.85,
    );
    expect(bldgMid).toBeCloseTo(0.5, 5);
    expect(
      buildingFootprintEdgeTaper(
        buildings,
        50 + 3 + 0.85 + GRASS_EXCLUSION_TAPER_SPAN + 0.1,
        50,
        0.85,
      ),
    ).toBe(1);

    const stamps = [{ x: -40, z: 30, r: 5 }];
    expect(grassClearEdgeTaper(stamps, -35.1, 30)).toBe(0);
    expect(grassClearEdgeTaper(stamps, -40 + 5 + GRASS_EXCLUSION_TAPER_SPAN * 0.5, 30)).toBeCloseTo(
      0.5,
      5,
    );
    expect(grassClearEdgeTaper(stamps, -40 + 5 + GRASS_EXCLUSION_TAPER_SPAN + 0.1, 30)).toBe(1);
  });

  it('gradually steps grass height down approaching Eastbrook road and Trader Wilkes', () => {
    const exclusions = eastbrookGrassExclusions(
      PROPS.buildings,
      true,
      BUILTIN_WORLD.services?.noticeboards ?? [],
    );
    const ctx = createGrassEdgeTaperContext(
      BUILTIN_WORLD.zones,
      exclusions,
      PROPS.buildings,
      BUILTIN_WORLD.grassClear,
    );
    // Moving from open turf at (-45, -80) and (-32, -94) toward the Eastbrook hub/road near Trader Wilkes (z = -94)
    expect(grassEdgeTaperAt(ctx, -45, -80, roadDistance(-45, -80))).toBe(1);
    const samples = [-32, -30, -28, -26.8].map((x) => {
      const z = -94;
      const taper = grassEdgeTaperAt(ctx, x, z, roadDistance(x, z));
      return {
        x,
        taper,
        heightScale: grassEdgeHeightScale(taper),
        widthScale: grassEdgeWidthScale(taper),
        coverageScale: grassEdgeCoverageScale(taper),
      };
    });
    expect(samples[0].heightScale).toBeGreaterThan(0.8);
    // At x = -28 (just outside the old r=15 cliff), grass is now tapered down instead of 100% height
    expect(samples[2].heightScale).toBeLessThan(0.55);
    expect(samples[2].heightScale).toBeGreaterThan(GRASS_EDGE_MIN_HEIGHT_SCALE);
    // Monotonically decreasing height as we approach the clearing
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].heightScale).toBeLessThanOrEqual(samples[i - 1].heightScale);
      expect(samples[i].widthScale).toBeLessThanOrEqual(samples[i - 1].widthScale);
    }
    expect(grassEdgeHeightScale(0)).toBeCloseTo(GRASS_EDGE_MIN_HEIGHT_SCALE, 6);
    expect(grassEdgeWidthScale(0)).toBeCloseTo(GRASS_EDGE_MIN_WIDTH_SCALE, 6);
    expect(grassEdgeCoverageScale(0)).toBeCloseTo(GRASS_EDGE_MIN_COVERAGE_SCALE, 6);

    const worldCtx = createWorldGrassEdgeTaperContext(BUILTIN_WORLD, exclusions, 0.35, 2.2, 15);
    const [sxNear, syNear] = taperTuftScales(
      worldCtx,
      -28,
      -94,
      roadDistance(-28, -94),
      0.5,
      true,
      0.8,
      null,
      [0, 0],
    );
    const [sxFar, syFar] = taperTuftScales(
      worldCtx,
      -36,
      -94,
      roadDistance(-36, -94),
      0.5,
      true,
      0.8,
      null,
      [0, 0],
    );
    expect(syNear).toBeLessThan(syFar);
    expect(sxNear).toBeLessThan(sxFar);
  });

  it('wires gradual edge taper into blade carpet, mid band, and streamed card tufts', () => {
    for (const file of ['blade_grass.ts', 'blade_grass_band.ts']) {
      const src = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(src, file).toContain('grassEdgeTaperAt(edgeTaperCtx, x, z, rd)');
      expect(src, file).toContain('grassEdgeHeightScale(edgeTaper)');
      expect(src, file).toContain('grassEdgeWidthScale(edgeTaper)');
    }
    const foliage = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
    // the trailing argument is the meadow patch sample (meadow_patch_core.ts)
    expect(foliage).toContain(
      'taperTuftScales(edgeTaperCtx, x, z, rd, r, lush, lushness, patch.sample)',
    );
  });

  it('answers clearance to any exclusion and to built edges only, out to its reach', () => {
    const exclusions = [
      { kind: 'obb' as const, id: 'wall', x: 0, z: 0, halfWidth: 4, halfDepth: 1, rotation: 0 },
      { kind: 'circle' as const, id: 'house:serviceApron', x: 20, z: 0, radius: 1.5 },
    ];
    const index = createGrassClearanceIndex(exclusions, [], [{ x: -20, z: 0, r: 2 }], 0.5, 4);
    const out: [number, number] = [0, 0];
    // inside the padded wall box: zero to both
    expect(grassClearanceAt(index, 0, 1.2, 4, out)).toEqual([0, 0]);
    // 1.5 past the wall's padded long side (halfDepth 1 + padding 0.5)
    const [any, edge] = grassClearanceAt(index, 1, 3, 4, out);
    expect(any).toBeCloseTo(1.5, 9);
    expect(edge).toBeCloseTo(1.5, 9);
    // an apron clears but grows no edge: its clearance reads on [0] only
    const nearApron = grassClearanceAt(index, 20 + 1.5 + 0.5 + 1, 0, 4, out);
    expect(nearApron[0]).toBeCloseTo(1, 9);
    expect(nearApron[1]).toBe(4);
    // a painted no-grass disc likewise
    const nearDisc = grassClearanceAt(index, -20 + 2 + 1.25, 0, 4, out);
    expect(nearDisc[0]).toBeCloseTo(1.25, 9);
    expect(nearDisc[1]).toBe(4);
    // past the reach both cap there, and a span over the reach is clamped to it
    expect(grassClearanceAt(index, 0, 30, 4, out)).toEqual([4, 4]);
    expect(grassClearanceAt(index, 0, 30, 9, out)).toEqual([4, 4]);
  });

  it('steps the stock taper aside in proportion to the meadow scope weight', () => {
    for (const stock of [0, 0.2, 0.7, 1]) {
      expect(meadowScopedEdgeTaper(0, stock)).toBe(stock);
      expect(meadowScopedEdgeTaper(1, stock)).toBe(1);
      const half = meadowScopedEdgeTaper(0.5, stock);
      expect(half).toBeCloseTo(1 - (1 - stock) * 0.5, 12);
      expect(half).toBeGreaterThanOrEqual(stock);
    }
  });

  it('sizes a card tuft from the meadow patch sample when one is given', () => {
    const exclusions = eastbrookGrassExclusions(
      PROPS.buildings,
      true,
      BUILTIN_WORLD.services?.noticeboards ?? [],
    );
    const worldCtx = createWorldGrassEdgeTaperContext(BUILTIN_WORLD, exclusions, 0.35, 2.2, 15);
    const x = -28;
    const z = -94;
    const rd = roadDistance(x, z);
    const stock = [...taperTuftScales(worldCtx, x, z, rd, 0.5, true, 0.8, null, [0, 0])];
    // scope 0: exactly the stock answer, whatever the multipliers say
    const outside = taperTuftScales(
      worldCtx,
      x,
      z,
      rd,
      0.5,
      true,
      0.8,
      { scope: 0, width: 1, height: 1 },
      [0, 0],
    );
    expect(outside).toEqual(stock);
    // scope 1: the stock taper steps aside and the clump size applies
    const untapered = taperTuftScales(worldCtx, 60, 60, Infinity, 0.5, true, 0.8, null, [0, 0]);
    const inside = taperTuftScales(
      worldCtx,
      x,
      z,
      rd,
      0.5,
      true,
      0.8,
      { scope: 1, width: 0.95, height: 1.3 },
      [0, 0],
    );
    expect(inside[0]).toBeCloseTo(untapered[0] * 0.95, 9);
    expect(inside[1]).toBeCloseTo(untapered[1] * 1.3, 9);
  });
});
