// A body glazed whole (characters/surface_response.ts setGlaze: the Guardian of
// the Quench's statue) mounts the surface program's clones, which outrank a glow
// pulse's (glow_pulse.ts). The death fade must still reach their light: the
// statue's own glow (eyes, crown, the chest star) stays dead under the ice
// instead of coming back whole the moment the glaze mounts.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GlowPulse } from '../src/render/characters/glow_pulse';
import { CharacterSurfaceResponse } from '../src/render/characters/surface_response';

describe('the statue: her light stays dead under the glaze', () => {
  it('carries the death fade onto the glaze clones the statue mounts', () => {
    const src = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1 });
    src.emissiveMap = new THREE.Texture();
    const glaze = new CharacterSurfaceResponse();
    glaze.setGlaze({ height: 1.05, glow: 1, bite: 0, alpha: 1 });
    const clone = glaze.material(src) as THREE.MeshStandardMaterial;
    expect(clone).not.toBe(src);
    // A plain emissive material the pulse never flares (no emissive map).
    const plain = new THREE.MeshStandardMaterial({ emissive: 0x335577, emissiveIntensity: 0.7 });
    const plainClone = glaze.material(plain) as THREE.MeshStandardMaterial;
    const pulse = new GlowPulse({ pulses: [], deathFade: 3.5 });
    const takes = (m: THREE.Material) => pulse.takes(m);
    // Alive: the full light.
    pulse.step(0.1, false);
    glaze.emissiveScale(pulse.scale, takes);
    expect(clone.emissiveIntensity).toBe(1);
    // Dead past the fade: dark, though the glaze (not the pulse) owns the mount.
    for (let i = 0; i < 50; i++) pulse.step(0.1, true);
    glaze.emissiveScale(pulse.scale, takes);
    expect(pulse.scale).toBe(0);
    expect(clone.emissiveIntensity).toBe(0);
    // Only the pulse's own materials go dark; the others keep their light.
    expect(plainClone.emissiveIntensity).toBeCloseTo(0.7, 9);
    // The shared source is never written.
    expect(src.emissiveIntensity).toBe(1);
  });
});
