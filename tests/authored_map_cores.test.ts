// The authored-map (Studio) presentation layer's pure cores
// (src/render/authored_map/), moved out of renderer.ts. Each one is the part
// of a Studio change that must stay OFF the built-in world, so every suite
// below pins the built-in arm as well as the authored one.

import { describe, expect, it } from 'vitest';
import {
  BOOM_SOLID_RELEASE,
  createChaseBoomScratch,
  easeBoomSolidLimit,
  LOOKUP_DOLLY,
  lookUpDollyDist,
  solveChaseBoom,
} from '../src/render/authored_map/chase_boom_core';
import {
  clampToGameplayFogBand,
  GAMEPLAY_FOG_FAR,
  GAMEPLAY_FOG_NEAR,
  requestOutdoorFog,
} from '../src/render/authored_map/gameplay_fog_core';
import { authoredSunAnchor, caveLightChanged } from '../src/render/authored_map/lighting_rig_core';
import {
  SHADOW_CACHE_DIR_DOT,
  SHADOW_CACHE_MAX_AGE,
  SHADOW_CACHE_MOVE,
  shadowCacheStale,
} from '../src/render/authored_map/shadow_cache_core';
import { cameraUnderWorld } from '../src/render/authored_map/underworld_core';
import {
  atmosphereResampleDue,
  worldAuthorsAtmosphere,
} from '../src/render/authored_map/zone_atmosphere_core';
import { zoneAllowedByResidencyFilter } from '../src/render/authored_map/zone_residency_core';
import type { EditorLightingProfile } from '../src/render/editor_lighting';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { groundHeight } from '../src/sim/world';

describe('chase boom (authored maps only)', () => {
  it('pulls the boom in on look-up only, squared, to LOOKUP_DOLLY at full', () => {
    expect(lookUpDollyDist(10, 0.3, -1)).toBe(10);
    expect(lookUpDollyDist(10, 0, -1)).toBe(10);
    expect(lookUpDollyDist(10, -1, -1)).toBeCloseTo(10 * (1 - LOOKUP_DOLLY), 9);
    expect(lookUpDollyDist(10, -0.5, -1)).toBeCloseTo(10 * (1 - LOOKUP_DOLLY * 0.25), 9);
    expect(lookUpDollyDist(10, -3, -1)).toBeCloseTo(10 * (1 - LOOKUP_DOLLY), 9);
  });

  it('snaps the asset limit in and eases it back out', () => {
    expect(easeBoomSolidLimit(12, 4, 0.1)).toBe(4);
    expect(easeBoomSolidLimit(4, 12, 0.1)).toBeCloseTo(4 + 0.1 * BOOM_SOLID_RELEASE, 9);
    expect(easeBoomSolidLimit(4, 4.5, 1)).toBe(4.5);
    expect(easeBoomSolidLimit(4, Number.POSITIVE_INFINITY, 0.5)).toBe(4 + 0.5 * BOOM_SOLID_RELEASE);
  });

  it('seats the camera on the solved boom and under the ceiling', () => {
    const { input, out } = createChaseBoomScratch(-1);
    Object.assign(input, {
      seed: 1,
      px: 0,
      pz: 0,
      eyeY: 10,
      yaw: 0.4,
      pitch: -1,
      dist: 12,
      ceilingY: 11,
      dt: 1 / 60,
    });
    solveChaseBoom(input, Number.POSITIVE_INFINITY, out);
    expect(out.dist).toBeLessThanOrEqual(12 * (1 - LOOKUP_DOLLY) + 1e-9);
    expect(out.y).toBeLessThanOrEqual(11);
    expect(out.x).toBeCloseTo(-Math.sin(0.4) * Math.cos(-1) * out.dist, 9);
  });
});

describe('gameplay fog band (authored maps and the editor only)', () => {
  const preset = { near: 300, far: 900 };
  const out = { near: 0, far: 0 };

  it('asks for the shipped envelope on the built-in world', () => {
    // preset far times the grade's farScale, exactly the shipped expression
    expect(requestOutdoorFog(preset, 1.1, false, 4000, null, false, out)).toEqual({
      near: 300,
      far: 900 * 1.1,
    });
    expect(requestOutdoorFog(preset, 1.1, true, 4000, null, false, out)).toEqual({
      near: 300,
      far: 4000,
    });
  });

  it('floors an authored map at the band, and the vista keeps its own far', () => {
    expect(requestOutdoorFog(preset, 1, false, 4000, null, true, out)).toEqual({
      near: GAMEPLAY_FOG_NEAR,
      far: GAMEPLAY_FOG_FAR,
    });
    expect(requestOutdoorFog(preset, 1, true, 4000, null, true, out)).toEqual({
      near: 300,
      far: 4000,
    });
  });

  it('lets the editor sliders drive the envelope (haze 0 late and thin, 1 the preset near)', () => {
    requestOutdoorFog(preset, 1, false, 4000, { distance: 1000, haze: 0 }, true, out);
    expect(out).toEqual({ near: 820, far: 1000 });
    requestOutdoorFog(preset, 1, false, 4000, { distance: 1000, haze: 1 }, true, out);
    expect(out.near).toBeCloseTo(300, 9);
  });

  it('clamps into the band without ever pushing fog out', () => {
    const fog = { near: 2000, far: 4000 };
    clampToGameplayFogBand(fog);
    expect(fog).toEqual({ near: GAMEPLAY_FOG_NEAR, far: GAMEPLAY_FOG_FAR });
    const tight = { near: 100, far: 400 };
    clampToGameplayFogBand(tight);
    expect(tight).toEqual({ near: 100, far: 400 });
  });
});

describe('authored lighting', () => {
  it('seats the authored sun on the anchor sphere, elevation clamped to 5..85', () => {
    const a = authoredSunAnchor(0, 90, 10, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(10, 9);
    expect(a.y).toBeCloseTo(Math.sin((85 * Math.PI) / 180) * 10, 9);
    const b = authoredSunAnchor(90, 0, 10, { x: 0, y: 0, z: 0 });
    expect(b.y).toBeCloseTo(Math.sin((5 * Math.PI) / 180) * 10, 9);
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.z).toBeGreaterThan(0);
  });

  it('re-marches the caves only when the cave light moves', () => {
    const p = { caveLight: 0.5 } as EditorLightingProfile;
    expect(caveLightChanged(null, null)).toBe(false);
    expect(caveLightChanged(null, p)).toBe(true);
    expect(caveLightChanged(p, { ...p })).toBe(false);
    expect(caveLightChanged(p, null)).toBe(true);
    expect(caveLightChanged(null, {} as EditorLightingProfile)).toBe(false);
  });
});

describe('editor shadow cache', () => {
  it('re-renders on a poke, the heartbeat, a drift or a light swing only', () => {
    expect(shadowCacheStale(false, 0, 0, 1)).toBe(false);
    expect(shadowCacheStale(true, 0, 0, 1)).toBe(true);
    expect(shadowCacheStale(false, SHADOW_CACHE_MAX_AGE, 0, 1)).toBe(true);
    expect(shadowCacheStale(false, 0, SHADOW_CACHE_MOVE ** 2 + 0.01, 1)).toBe(true);
    expect(shadowCacheStale(false, 0, SHADOW_CACHE_MOVE ** 2, 1)).toBe(false);
    expect(shadowCacheStale(false, 0, 0, SHADOW_CACHE_DIR_DOT - 1e-6)).toBe(true);
  });
});

describe('underworld test', () => {
  it('is false inside an instance and above the ground', () => {
    const g = groundHeight(0, 0, 1);
    expect(cameraUnderWorld(0, g + 5, 0, 1)).toBe(false);
    expect(cameraUnderWorld(DUNGEON_X_THRESHOLD + 1, -1000, 0, 1)).toBe(false);
  });

  it('is true well under the sheet with no cave or carve in the column', () => {
    const g = groundHeight(0, 0, 1);
    expect(cameraUnderWorld(0, g - 10, 0, 1)).toBe(true);
    expect(cameraUnderWorld(0, g - 2, 0, 1)).toBe(false);
  });
});

describe('zone atmosphere', () => {
  it('resamples every two yards once a zone is adopted', () => {
    expect(atmosphereResampleDue(false, 0, 0, 0, 0)).toBe(true);
    expect(atmosphereResampleDue(true, Number.NaN, 0, 0, 0)).toBe(true);
    expect(atmosphereResampleDue(true, 0, 0, 1, 1)).toBe(false);
    expect(atmosphereResampleDue(true, 0, 0, 2, 0)).toBe(true);
  });

  it('stays off a world that authors nothing unless the editor hosts it', () => {
    expect(worldAuthorsAtmosphere({}, false)).toBe(false);
    expect(worldAuthorsAtmosphere({}, true)).toBe(true);
    expect(worldAuthorsAtmosphere({ timeScale: 1 }, false)).toBe(true);
    expect(worldAuthorsAtmosphere({ skybox: 'aurora' }, false)).toBe(true);
  });
});

describe('zone isolate residency', () => {
  const zone = { xMin: 0, xMax: 100, zMin: 0, zMax: 100 };
  it('admits everything outside isolate mode and only overlaps inside it', () => {
    expect(zoneAllowedByResidencyFilter(null, zone)).toBe(true);
    expect(zoneAllowedByResidencyFilter({ minX: 50, maxX: 60, minZ: 50, maxZ: 60 }, zone)).toBe(
      true,
    );
    expect(zoneAllowedByResidencyFilter({ minX: 100, maxX: 160, minZ: 0, maxZ: 60 }, zone)).toBe(
      false,
    );
    expect(zoneAllowedByResidencyFilter({ minX: 0, maxX: 10, minZ: 200, maxZ: 260 }, zone)).toBe(
      false,
    );
    // a zone with no x extent spans the strip, so only its z band decides
    const band = { zMin: 0, zMax: 100 };
    expect(zoneAllowedByResidencyFilter({ minX: 0, maxX: 1, minZ: 0, maxZ: 10 }, band)).toBe(true);
    expect(zoneAllowedByResidencyFilter({ minX: 0, maxX: 1, minZ: 150, maxZ: 160 }, band)).toBe(
      false,
    );
  });
});
