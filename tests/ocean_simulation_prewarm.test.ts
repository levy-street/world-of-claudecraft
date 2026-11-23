// The ocean simulation's construction-time prewarm (src/render/ocean/ocean_simulation.ts):
// every pass program links against the kind of target its live pass draws
// into, under the construction curtain, and the bound target is restored, so
// the first live step links nothing (the twin of water_simulation_prewarm).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OceanSimulation } from '../src/render/ocean/ocean_simulation';
import { DEFAULT_SEA_STATE, oceanPlanForTier } from '../src/render/ocean/ocean_spectrum_core';

interface CompileCall {
  target: THREE.WebGLRenderTarget | null;
  material: THREE.Material;
}

function rendererStub(floatTargets: boolean) {
  const compiles: CompileCall[] = [];
  const renders: CompileCall[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    capabilities: { isWebGL2: true, maxVertexTextures: 16, getMaxAnisotropy: () => 8 },
    extensions: { has: () => floatTargets },
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      target = next;
    },
    compile: (scene: THREE.Scene) => {
      const quad = scene.children[0] as THREE.Mesh;
      compiles.push({ target, material: quad.material as THREE.Material });
    },
    render: (scene: THREE.Scene) => {
      const quad = scene.children[0] as THREE.Mesh;
      renders.push({ target, material: quad.material as THREE.Material });
    },
    clear: () => {},
    getClearColor: (out: THREE.Color) => out,
    getClearAlpha: () => 1,
    setClearColor: () => {},
  } as unknown as THREE.WebGLRenderer & { autoClear: boolean };
  return { renderer, compiles, renders };
}

const plan = () => {
  const p = oceanPlanForTier('medium');
  if (!p) throw new Error('medium has a plan');
  return p;
};

describe('OceanSimulation prewarm', () => {
  it('links every pass against its own float target and restores the bound target', () => {
    const { renderer, compiles } = rendererStub(true);
    const sim = new OceanSimulation(renderer, plan(), DEFAULT_SEA_STATE, 7);
    expect(sim.enabled).toBe(true);
    const names = compiles.map((c) => c.material.name);
    expect(names).toEqual(['ocean:evolve', 'ocean:fft', 'ocean:assemble']);
    // The transform passes draw into the float atlas, the assemble pass into a
    // cascade's mipmapped half-float output.
    expect(compiles[0].target?.texture.type).toBe(THREE.FloatType);
    expect(compiles[1].target?.texture.type).toBe(THREE.FloatType);
    expect(compiles[2].target?.texture.type).toBe(THREE.HalfFloatType);
    expect(renderer.getRenderTarget()).toBeNull();
    sim.dispose();
  });

  it('builds nothing on a context with no float render targets, and stays calm', () => {
    const { renderer, compiles } = rendererStub(false);
    const sim = new OceanSimulation(renderer, plan(), DEFAULT_SEA_STATE, 7);
    expect(sim.enabled).toBe(false);
    expect(compiles).toHaveLength(0);
    expect(sim.update(1)).toBe(0);
    sim.dispose();
  });

  it('steps at the plan rate, skips the redundant clear, and restores the renderer', () => {
    const { renderer, renders } = rendererStub(true);
    const p = plan();
    const sim = new OceanSimulation(renderer, p, DEFAULT_SEA_STATE, 7);
    const passes = sim.update(10);
    // evolve + 2 log2(N) Stockham passes + one assemble per cascade
    expect(passes).toBe(1 + 2 * Math.log2(p.resolution) + p.cascades.length);
    expect(renders).toHaveLength(passes);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.getRenderTarget()).toBeNull();
    // Inside one step interval nothing more runs.
    expect(sim.update(10 + 0.5 / p.stepHz)).toBe(0);
    expect(sim.update(10 + 1.01 / p.stepHz)).toBe(passes);
    // The surface reads the cascade the last assemble wrote.
    expect(sim.uniforms.shade[0].value).not.toBeNull();
    sim.dispose();
  });
});
