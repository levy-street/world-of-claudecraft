import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eastbrookGrassExclusions } from '../src/render/foliage_core';
import {
  buildingFootprintEdgeTaper,
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
  grassClearEdgeTaper,
  grassEdgeCoverageScale,
  grassEdgeHeightScale,
  grassEdgeTaperAt,
  grassEdgeWidthScale,
  hubEdgeTaper,
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
    expect(foliage).toContain('taperTuftScales(edgeTaperCtx, x, z, rd, r, lush, lushness)');
  });
});
