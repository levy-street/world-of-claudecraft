// A desktop graphics profile per forced tier, and the switch a profile rebuild
// makes (publish the profile, then drop every profile-derived cache), for the
// suites that walk live draws tier by tier. `afterAll(gfxProfileRestorer())`
// puts back the profile that was active when the suite loaded.

import type { GraphicsSettingsSnapshot } from '../../src/game/graphics_rebuild_core';
import { resetGraphicsProfileDerivedCaches } from '../../src/render/assets/graphics_profile';
import {
  activateGfxProfile,
  type GfxCapabilities,
  type GfxProfile,
  type GfxTier,
  getActiveGfxProfile,
  resolveGfxProfile,
} from '../../src/render/gfx';

const desktopCapabilities: GfxCapabilities = Object.freeze({
  deviceMemory: 8,
  hardwareConcurrency: 12,
  maxTouchPoints: 0,
  coarsePointer: false,
  narrowViewport: false,
  gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
  nativeApp: false,
  tightMemory: false,
  platform: 'other',
  softwareRendering: false,
});

const basePreferences: GraphicsSettingsSnapshot = {
  graphicsPreset: 2,
  terrainDetail: 1,
  foliageDensity: 1,
  surfaceDetail: 1,
  effectsQuality: 1,
  shadowQuality: 1,
  antiAliasing: 1,
  bloomQuality: 1,
  ambientOcclusion: 1,
  viewDistance: 1,
  waterQuality: 1,
  characterDetail: 1,
  dynamicLights: 1,
  particleEffects: 1,
  ghostFade: 1,
};

export function desktopTierProfile(tier: GfxTier): GfxProfile {
  return resolveGfxProfile(desktopCapabilities, basePreferences, `?gfx=${tier}`);
}

export function activateTier(tier: GfxTier): void {
  activateGfxProfile(desktopTierProfile(tier));
  resetGraphicsProfileDerivedCaches();
}

export function gfxProfileRestorer(): () => void {
  const original = getActiveGfxProfile();
  return () => {
    activateGfxProfile(original);
    resetGraphicsProfileDerivedCaches();
  };
}
