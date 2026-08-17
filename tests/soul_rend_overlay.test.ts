import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applySoulRendOverlay,
  SOUL_REND_EMISSIVE_HEX,
  SOUL_REND_EMISSIVE_INTENSITY,
  SOUL_REND_OPACITY,
  SOUL_REND_TINT_HEX,
} from '../src/render/characters/soul_rend_overlay';
import { addRimGlow } from '../src/render/gfx';
import { cloneMaterialWithHooks } from '../src/render/material_clone_hooks';
import { applySurfaceDetail } from '../src/render/worn_stone';

describe('applySoulRendOverlay', () => {
  it('pins the overlay values to literals, not to the constants production reads', () => {
    // Both sides of an `expect(overlay.opacity).toBe(SOUL_REND_OPACITY)` move
    // together, so it cannot see a changed value: these four literals ARE the
    // look the extraction from visual.ts had to preserve.
    expect(SOUL_REND_OPACITY).toBe(0.58);
    expect(SOUL_REND_TINT_HEX).toBe(0x4f0505);
    expect(SOUL_REND_EMISSIVE_HEX).toBe(0x2a0000);
    expect(SOUL_REND_EMISSIVE_INTENSITY).toBe(0.35);
  });

  it('flips the transparent program bits and keeps the source shader hooks', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x808080 });
    addRimGlow(source);
    applySurfaceDetail(source, 'fabric', { strength: 0.2, objectSpace: true });
    const overlay = applySoulRendOverlay(source) as THREE.MeshStandardMaterial;
    expect(overlay).not.toBe(source);
    expect(overlay.transparent).toBe(true);
    expect(overlay.depthWrite).toBe(false);
    expect(overlay.opacity).toBe(SOUL_REND_OPACITY);
    expect(overlay.color.getHex()).toBe(SOUL_REND_TINT_HEX);
    expect(overlay.emissive.getHex()).toBe(SOUL_REND_EMISSIVE_HEX);
    expect(overlay.emissiveIntensity).toBeGreaterThanOrEqual(SOUL_REND_EMISSIVE_INTENSITY);
    expect(overlay.customProgramCacheKey()).toBe(source.customProgramCacheKey());
    expect(overlay.customProgramCacheKey()).toBe(
      cloneMaterialWithHooks(source).customProgramCacheKey(),
    );
    expect(source.transparent).toBe(false);
    expect(source.depthWrite).toBe(true);
  });
});
