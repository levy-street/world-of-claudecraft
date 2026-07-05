import { describe, expect, it } from 'vitest';
import {
  IMPACT_SITE_CRACK_COUNT,
  IMPACT_SITE_RIM_PROFILE,
  impactSiteNavigationProbePoints,
  impactSiteVisualY,
  MIREFEN_IMPACT_SITE,
} from '../src/render/impact_site';
import { zoneAt } from '../src/sim/data';
import {
  groundHeight,
  MIREFEN_IMPACT_CRATER,
  mirefenImpactCraterOffset,
  terrainHeight,
  WATER_LEVEL,
} from '../src/sim/world';
import { impactCraterTerrainBlend } from '../src/render/impact_terrain';

const SEED = 42;

describe('Mirefen impact site', () => {
  it('is placed around Brother Aldric\'s reported western Mirefen wall base', () => {
    expect(MIREFEN_IMPACT_SITE.x).toBeGreaterThanOrEqual(148);
    expect(MIREFEN_IMPACT_SITE.x).toBeLessThan(152);
    expect(MIREFEN_IMPACT_SITE.z).toBe(295);
    expect(zoneAt(MIREFEN_IMPACT_SITE.z).id).toBe('mirefen_marsh');

    const impactY = terrainHeight(MIREFEN_IMPACT_SITE.x, MIREFEN_IMPACT_SITE.z, SEED);
    const wallY = terrainHeight(MIREFEN_IMPACT_SITE.x + 4, MIREFEN_IMPACT_SITE.z, SEED);
    expect(wallY).toBeGreaterThan(impactY + 1.5);
  });

  it('keeps the authoritative floor dry and terrain-driven around the crater', () => {
    for (const p of impactSiteNavigationProbePoints()) {
      expect(groundHeight(p.x, p.z, SEED)).toBe(terrainHeight(p.x, p.z, SEED));
      expect(groundHeight(p.x, p.z, SEED)).toBeGreaterThan(WATER_LEVEL + 0.75);
    }
  });

  it('carves a broad authoritative crater depression into the terrain', () => {
    const centerY = groundHeight(MIREFEN_IMPACT_CRATER.x, MIREFEN_IMPACT_CRATER.z, SEED);
    expect(mirefenImpactCraterOffset(MIREFEN_IMPACT_CRATER.x, MIREFEN_IMPACT_CRATER.z)).toBeLessThan(-2);
    expect(centerY).toBeGreaterThan(WATER_LEVEL + 0.75);

    const outerX = MIREFEN_IMPACT_CRATER.x - MIREFEN_IMPACT_CRATER.radius * 1.1;
    expect(Math.abs(mirefenImpactCraterOffset(outerX, MIREFEN_IMPACT_CRATER.z))).toBeLessThan(0.001);

    const leftLipY = terrainHeight(MIREFEN_IMPACT_CRATER.x - MIREFEN_IMPACT_CRATER.bowlRadius, MIREFEN_IMPACT_CRATER.z, SEED);
    const rightLipY = terrainHeight(MIREFEN_IMPACT_CRATER.x + MIREFEN_IMPACT_CRATER.bowlRadius, MIREFEN_IMPACT_CRATER.z, SEED);
    expect(centerY).toBeLessThan(leftLipY - 0.45);
    expect(centerY).toBeLessThan(rightLipY - 0.45);
    expect(mirefenImpactCraterOffset(MIREFEN_IMPACT_CRATER.x + MIREFEN_IMPACT_CRATER.bowlRadius, MIREFEN_IMPACT_CRATER.z)).toBeGreaterThan(0.25);
  });

  it('keeps the crater deformation smooth enough for terrain mesh interpolation', () => {
    const maxLowDetailStep = 4.4;
    const maxVerticalChangeAcrossLowDetailStep = 1.25;
    for (const zStep of [-1, 0, 1]) {
      for (let x = MIREFEN_IMPACT_CRATER.x - MIREFEN_IMPACT_CRATER.radius; x <= MIREFEN_IMPACT_CRATER.x + MIREFEN_IMPACT_CRATER.radius; x += maxLowDetailStep) {
        const a = mirefenImpactCraterOffset(x, MIREFEN_IMPACT_CRATER.z + zStep * maxLowDetailStep);
        const b = mirefenImpactCraterOffset(x + maxLowDetailStep, MIREFEN_IMPACT_CRATER.z + zStep * maxLowDetailStep);
        expect(Math.abs(a - b)).toBeLessThan(maxVerticalChangeAcrossLowDetailStep);
      }
    }
  });

  it('draws visual surfaces from sampled terrain height rather than a hard basin', () => {
    for (const p of impactSiteNavigationProbePoints()) {
      const visualY = impactSiteVisualY(p.x, p.z, SEED);
      expect(visualY).toBeGreaterThan(terrainHeight(p.x, p.z, SEED));
      expect(visualY - terrainHeight(p.x, p.z, SEED)).toBeLessThan(0.12);
    }
  });

  it('uses a render-only rim that tapers down into the terrain', () => {
    for (let i = 1; i < IMPACT_SITE_RIM_PROFILE.length; i++) {
      expect(IMPACT_SITE_RIM_PROFILE[i].band).toBeGreaterThan(IMPACT_SITE_RIM_PROFILE[i - 1].band);
      expect(IMPACT_SITE_RIM_PROFILE[i].lift).toBeLessThan(IMPACT_SITE_RIM_PROFILE[i - 1].lift);
    }

    const outerProfile = IMPACT_SITE_RIM_PROFILE[IMPACT_SITE_RIM_PROFILE.length - 1];
    expect(outerProfile.lift).toBeLessThan(0.05);
  });

  it('uses a denser field of impact cracks for the orange fracture lines', () => {
    expect(IMPACT_SITE_CRACK_COUNT).toBeGreaterThanOrEqual(10);
  });

  it('matches terrain tinting to the physical crater bowl and lip', () => {
    const center = impactCraterTerrainBlend(MIREFEN_IMPACT_CRATER.x, MIREFEN_IMPACT_CRATER.z);
    const lip = impactCraterTerrainBlend(MIREFEN_IMPACT_CRATER.x + MIREFEN_IMPACT_CRATER.bowlRadius, MIREFEN_IMPACT_CRATER.z);
    const outside = impactCraterTerrainBlend(MIREFEN_IMPACT_CRATER.x + MIREFEN_IMPACT_CRATER.radius + 1, MIREFEN_IMPACT_CRATER.z);

    expect(center.ash).toBeGreaterThan(0.75);
    expect(center.scorch).toBeGreaterThan(lip.scorch);
    expect(lip.scorch).toBeGreaterThan(0.25);
    expect(lip.ash).toBeLessThan(center.ash);
    expect(outside.scorch).toBe(0);
    expect(outside.ash).toBe(0);
  });
});
