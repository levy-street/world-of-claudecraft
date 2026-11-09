// A glow set with no gesture pulses still fades its light out on death (VisualDef.glowPulses with an
// empty `pulses` and a `deathFade`: the Quench trash). CharacterVisual builds the GlowPulse for such a
// set (visual.ts), and the GlowPulse mounts its clones and dims them over the fade.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GlowPulse } from '../src/render/characters/glow_pulse';

describe('a death fade with no gesture pulses', () => {
  it('mounts its clones on death and dims them to dark over the fade', () => {
    const pulse = new GlowPulse({ pulses: [], deathFade: 2 });
    const src = new THREE.MeshStandardMaterial({ emissiveMap: new THREE.Texture() });
    src.emissiveIntensity = 1;
    expect(pulse.step(0.1, false)).toBe(false);
    expect(pulse.active).toBe(false);
    // Dead: the clones go on, and the light falls away.
    expect(pulse.step(0.5, true)).toBe(true);
    const clone = pulse.material(src) as THREE.MeshStandardMaterial;
    expect(clone).not.toBe(src);
    expect(clone.emissiveIntensity).toBeLessThan(1);
    pulse.step(1.6, true);
    expect(clone.emissiveIntensity).toBeCloseTo(0, 5);
    // The shared material is never written.
    expect(src.emissiveIntensity).toBe(1);
  });

  it('is built by the visual for a set that only fades', () => {
    const src = readFileSync('src/render/characters/visual.ts', 'utf8');
    expect(src).toMatch(
      /glowPulses\?\.pulses\.length \|\| this\.def\.glowPulses\?\.deathFade !== undefined/,
    );
  });
});
