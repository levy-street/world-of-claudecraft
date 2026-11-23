import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  installLabLighting,
  LAB_RIM_MARKER,
  setLabRim,
} from '../src/render/palette_lab/lab_lighting';

describe('palette lab rim light', () => {
  it('does not touch the shipped chunks outside a lab session (Node has no flag)', () => {
    expect(THREE.ShaderChunk.lights_fragment_end).not.toContain(LAB_RIM_MARKER);
    expect(THREE.ShaderChunk.lights_pars_begin).not.toContain(LAB_RIM_MARKER);
    expect(THREE.ShaderLib.physical.uniforms.uWocLabRim).toBeUndefined();
  });

  it('patches both chunks once and gives every lit shader one shared array', () => {
    const chunks = {
      lights_pars_begin: THREE.ShaderChunk.lights_pars_begin,
      lights_fragment_end: THREE.ShaderChunk.lights_fragment_end,
    };
    const lib: Record<string, { uniforms: Record<string, THREE.IUniform> }> = {
      standard: { uniforms: {} },
      physical: { uniforms: {} },
      lambert: { uniforms: {} },
      phong: { uniforms: {} },
      toon: { uniforms: {} },
    };
    expect(installLabLighting(chunks, lib)).toBe(true);
    expect(installLabLighting(chunks, lib)).toBe(false);
    expect(chunks.lights_pars_begin).toContain('uniform vec4 uWocLabRim;');
    expect(chunks.lights_fragment_end).toContain('reflectedLight.directDiffuse +=');
    // The rim runs after the shipped chunk body, never in place of it.
    expect(chunks.lights_fragment_end.startsWith(THREE.ShaderChunk.lights_fragment_end)).toBe(true);

    const shared = lib.physical.uniforms.uWocLabRim.value as Float32Array;
    for (const id of Object.keys(lib)) expect(lib[id].uniforms.uWocLabRim.value).toBe(shared);
    // three's per-material clone passes the typed array by reference, so one
    // write reaches every material.
    const cloned = THREE.UniformsUtils.clone(lib.lambert.uniforms);
    setLabRim(0.4, 3, [1, 0.5, 0.25], 0.85);
    expect((cloned.uWocLabRim.value as Float32Array)[0]).toBeCloseTo(0.4);
    const color = cloned.uWocLabRimColor.value as Float32Array;
    [1, 0.5, 0.25, 0.85].forEach((want, i) => {
      expect(color[i]).toBeCloseTo(want, 6);
    });
    setLabRim(0, 3, [0.8, 0.9, 1], 0.5);
  });
});
