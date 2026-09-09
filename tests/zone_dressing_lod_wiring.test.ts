import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-scan guard for the renderer WIRING of the lean-tier zone-dressing
// thin (src/render/zone_dressing_lod_core.ts). The pure core is Node-tested
// directly (tests/zone_dressing_lod_core.test.ts), but neither consumer is
// Node-testable end to end (Three-heavy scene building from shipped GLBs), so
// nothing else would catch the one regression that matters: a collider-backed
// family (the fen willows, the Veiled Hollow willows) being routed through the
// thin. Those trunks ARE the sim's colliders, so thinning them would leave a
// lean session walking into something it cannot see, which is precisely what
// docs/design/graphics-settings-fairness.md forbids. Same pattern as
// tests/foliage_decimation_wiring.test.ts.
const read = (file: string): string =>
  readFileSync(path.join(__dirname, '..', 'src', 'render', file), 'utf8');
const fenSource = read('fen_features.ts');
const waterFloraSource = read('water_flora.ts');

describe('zone dressing lean-thin renderer wiring', () => {
  it('routes the fen dressing families through the core, and only those', () => {
    expect(fenSource).toContain('thinLeanDressing(spots, GFX.leanFoliage)');
    for (const family of [
      "'lilies', spots",
      "'reeds', spots",
      "'mushrooms', mushroomSpots",
      "'log', logSpots",
    ]) {
      expect(fenSource).toContain(`instanceDressing(${family});`);
    }
  });

  it('never thins the fen willows: their trunks are the sim colliders', () => {
    expect(fenSource).toContain('fenWillowSpots(seed)');
    expect(fenSource).not.toMatch(/instanceDressing\(\s*'willow'/);
    expect(fenSource).not.toMatch(/thinLeanDressing\(\s*fenWillowSpots/);
  });

  it('routes the water-flora rafts and reeds through the core', () => {
    expect(waterFloraSource).toContain(
      "instanceProp(regionGroup, 'lilies', thinLeanDressing(region.lilies, GFX.leanFoliage))",
    );
    expect(waterFloraSource).toContain(
      "instanceProp(regionGroup, 'reeds', thinLeanDressing(region.reeds, GFX.leanFoliage))",
    );
  });

  it('never thins the Veiled Hollow willows: their trunks are the sim colliders', () => {
    expect(waterFloraSource).toContain('hollowWillowSpots(seed)');
    expect(waterFloraSource).not.toMatch(/thinLeanDressing\(\s*hollowWillowSpots/);
  });

  it('imports thinLeanDressing from the registered pure core in both consumers', () => {
    for (const source of [fenSource, waterFloraSource]) {
      expect(source).toMatch(
        /import\s*\{\s*thinLeanDressing\s*\}\s*from\s*'\.\/zone_dressing_lod_core';/,
      );
    }
  });
});
