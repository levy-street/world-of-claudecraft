import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import {
  activateGfxProfile,
  captureGfxCapabilities,
  GFX,
  GFX_BUCKET_BANDS,
  GFX_BUDGETS,
  type GfxCapabilities,
  getActiveGfxProfile,
  getGfxProfileEpoch,
  resolveGfxProfile,
} from '../src/render/gfx';

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

const mediumPreferences: GraphicsSettingsSnapshot = {
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
};

describe('GfxProfile resolution and activation', () => {
  it('resolves a deeply immutable profile without touching active state or storage', () => {
    const before = getActiveGfxProfile();
    expect(Object.isFrozen(GFX_BUCKET_BANDS.high)).toBe(false);
    expect(Object.isFrozen(GFX_BUDGETS.high)).toBe(false);
    const storageGet = vi.fn(() => {
      throw new Error('profile resolution must not read storage');
    });
    const storageSet = vi.fn(() => {
      throw new Error('profile resolution must not write storage');
    });
    vi.stubGlobal('localStorage', { getItem: storageGet, setItem: storageSet });

    const profile = resolveGfxProfile(
      desktopCapabilities,
      { ...mediumPreferences, graphicsPreset: 5, foliageDensity: 2 },
      '?gfxo=bladeCarpetRadius:7&governor=0',
    );

    expect(profile.settings.tier).toBe('high');
    expect(profile.settings.bladeCarpetRadius).toBe(7);
    expect(profile.settings.autoGovernor).toBe(false);
    expect(profile.forcedTier).toBeNull();
    expect(profile.softwareRendering).toBe(false);
    expect(profile.epoch).toBe(0);
    expect(profile.fingerprint).toContain('"graphicsConfigVersion"');
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.settings)).toBe(true);
    expect(Object.isFrozen(profile.settings.bucketBands.grass)).toBe(true);
    expect(Object.isFrozen(GFX_BUCKET_BANDS.high)).toBe(false);
    expect(Object.isFrozen(GFX_BUDGETS.high)).toBe(false);
    expect(getActiveGfxProfile()).toBe(before);
    expect(storageGet).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('preserves URL force over preferences and software safety', () => {
    const profile = resolveGfxProfile(
      { ...desktopCapabilities, softwareRendering: true },
      { ...mediumPreferences, graphicsPreset: 1 },
      '?gfx=ultra&governor=1',
    );

    expect(profile.settings.tier).toBe('ultra');
    expect(profile.forcedTier).toBe('ultra');
    expect(profile.softwareRendering).toBe(true);
    expect(profile.settings.autoGovernor).toBe(true);
  });

  it('applies startup safety before Advanced derivation while preserving forced dev authority', () => {
    const nativeIos = Object.freeze({
      ...desktopCapabilities,
      nativeApp: true,
      platform: 'ios' as const,
    });
    const advanced = { ...mediumPreferences, graphicsPreset: 5, foliageDensity: 2 };

    const safe = resolveGfxProfile(nativeIos, advanced, '');
    expect(safe.settings.tier).toBe('high');
    expect(safe.settings.bladeCarpetRadius).toBe(0);
    expect(safe.settings.nativeIosMemoryProfile).toBe(true);

    const forced = resolveGfxProfile(nativeIos, advanced, '?gfx=ultra&gfxo=bladeCarpetRadius:7');
    expect(forced.settings.tier).toBe('ultra');
    expect(forced.settings.bladeCarpetRadius).toBe(7);
    expect(forced.forcedTier).toBe('ultra');
  });

  it('uses a complete stable settings fingerprint and advances epoch only on change', () => {
    const one = resolveGfxProfile(desktopCapabilities, mediumPreferences, '');
    const duplicate = resolveGfxProfile(
      Object.freeze({ ...desktopCapabilities }),
      { ...mediumPreferences },
      '',
    );
    const changed = resolveGfxProfile(
      desktopCapabilities,
      { ...mediumPreferences, graphicsPreset: 3 },
      '',
    );

    expect(duplicate.fingerprint).toBe(one.fingerprint);
    expect(changed.fingerprint).not.toBe(one.fingerprint);

    const activeBefore = getActiveGfxProfile();
    const epochBefore = getGfxProfileEpoch();
    const expectedFirstEpoch =
      activeBefore.fingerprint === one.fingerprint ? epochBefore : epochBefore + 1;
    const activatedOne = activateGfxProfile(one);
    expect(activatedOne.epoch).toBe(expectedFirstEpoch);

    const activatedDuplicate = activateGfxProfile(duplicate);
    expect(activatedDuplicate.epoch).toBe(activatedOne.epoch);

    const activatedChanged = activateGfxProfile(changed);
    expect(activatedChanged.epoch).toBe(activatedOne.epoch + 1);
    expect(getActiveGfxProfile()).toBe(activatedChanged);
    expect(getGfxProfileEpoch()).toBe(activatedChanged.epoch);
    expect(GFX).toBe(activatedChanged.settings);
  });

  it('captures a frozen live adapter and device capability snapshot', () => {
    const getParameter = vi.fn(() => 'Google SwiftShader');
    const getExtension = vi.fn((name: string) =>
      name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
    );
    const webgl = {
      getContext: () => ({ getExtension, getParameter }),
    } as unknown as THREE.WebGLRenderer;
    vi.stubGlobal('navigator', {
      deviceMemory: 4,
      hardwareConcurrency: 6,
      maxTouchPoints: 2,
      userAgent: 'Android',
      platform: 'Linux armv8l',
    });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('pointer: coarse'),
    }));

    const capabilities = captureGfxCapabilities(webgl);

    expect(capabilities).toMatchObject({
      deviceMemory: 4,
      hardwareConcurrency: 6,
      maxTouchPoints: 2,
      coarsePointer: true,
      gpuRenderer: 'Google SwiftShader',
      platform: 'android',
      softwareRendering: true,
    });
    expect(Object.isFrozen(capabilities)).toBe(true);

    vi.unstubAllGlobals();
  });
});
