// The water height-field's construction-time prewarm (src/render/water_simulation.ts):
// both programs link against the float target a live pass renders into, so
// the first wake is a hit and not a cold link on a live frame.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WaterSimulation } from '../src/render/water_simulation';

vi.mock('../src/render/gfx', () => ({
  GFX: { standardMaterials: true, waterTier: 'high' },
}));

interface CompileCall {
  target: THREE.WebGLRenderTarget | null;
  material: THREE.Material;
}

function rendererStub(): { renderer: THREE.WebGLRenderer; compiles: CompileCall[] } {
  const compiles: CompileCall[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    capabilities: { isWebGL2: true, maxVertexTextures: 16 },
    extensions: { has: () => true },
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    compile: (scene: THREE.Scene) => {
      const quad = scene.children[0] as THREE.Mesh;
      compiles.push({ target, material: quad.material as THREE.Material });
    },
    render: () => {},
    clear: () => {},
    getClearColor: (out: THREE.Color) => out,
    getClearAlpha: () => 1,
    setClearColor: () => {},
  } as unknown as THREE.WebGLRenderer;
  return { renderer, compiles };
}

describe('WaterSimulation prewarm', () => {
  it('compiles the step and the scroll programs against the float target, then restores', () => {
    const { renderer, compiles } = rendererStub();
    const simulation = new WaterSimulation(renderer);

    expect(compiles).toHaveLength(2);
    const materials = compiles.map((call) => call.material as THREE.ShaderMaterial);
    expect(materials[0]?.uniforms.uTexel).toBeDefined();
    expect(materials[1]?.uniforms.uShift).toBeDefined();
    expect(materials[0]).not.toBe(materials[1]);
    for (const call of compiles) {
      expect(call.target).not.toBeNull();
      expect(call.target?.texture.type).toBe(THREE.HalfFloatType);
    }
    expect(renderer.getRenderTarget()).toBeNull();
    // The quad wears the step material again: a live step never has to reset it.
    const quad = (simulation as unknown as { quad: THREE.Mesh }).quad;
    expect(quad.material).toBe(materials[0]);
  });

  it('links nothing where the simulation is unsupported', () => {
    const { renderer, compiles } = rendererStub();
    (renderer as unknown as { extensions: { has: () => boolean } }).extensions.has = () => false;
    new WaterSimulation(renderer);
    expect(compiles).toEqual([]);
  });
});
