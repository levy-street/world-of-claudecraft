import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GFX } from '../src/render/gfx';
import { WaterSimulation } from '../src/render/water_simulation';

const ORIGINAL_STANDARD_MATERIALS = GFX.standardMaterials;

class FakeRenderer {
  readonly capabilities = { isWebGL2: true, maxVertexTextures: 16 };
  readonly extensions = { has: (name: string) => name === 'EXT_color_buffer_float' };
  readonly boundTargets: Array<THREE.WebGLRenderTarget | null> = [];
  readonly compileTargets: Array<THREE.WebGLRenderTarget | null> = [];
  private currentTarget: THREE.WebGLRenderTarget | null = null;
  private readonly clearColor = new THREE.Color(0x000000);
  private clearAlpha = 1;

  compile(_scene: THREE.Object3D, _camera: THREE.Camera): void {
    this.compileTargets.push(this.currentTarget);
  }

  getRenderTarget(): THREE.WebGLRenderTarget | null {
    return this.currentTarget;
  }

  setRenderTarget(target: THREE.WebGLRenderTarget | null): void {
    this.currentTarget = target;
    this.boundTargets.push(target);
  }

  getClearColor(target: THREE.Color): THREE.Color {
    return target.copy(this.clearColor);
  }

  getClearAlpha(): number {
    return this.clearAlpha;
  }

  setClearColor(color: THREE.ColorRepresentation, alpha = 1): void {
    this.clearColor.set(color);
    this.clearAlpha = alpha;
  }

  clear(): void {}
}

afterEach(() => {
  (GFX as unknown as { standardMaterials: boolean }).standardMaterials =
    ORIGINAL_STANDARD_MATERIALS;
});

describe('WaterSimulation prewarming', () => {
  it('binds a solver render target before compiling the shader program', () => {
    (GFX as unknown as { standardMaterials: boolean }).standardMaterials = true;
    const renderer = new FakeRenderer();
    const simulation = new WaterSimulation(renderer as unknown as THREE.WebGLRenderer, [
      { x: 0, z: 0, radius: 12 },
    ]);

    expect(renderer.compileTargets).toHaveLength(1);
    expect(renderer.compileTargets[0]).not.toBeNull();
    expect(renderer.compileTargets[0]).toBe(renderer.boundTargets[0]);
    simulation.dispose();
  });

  it('does not compile when there are no solver bodies to bind', () => {
    (GFX as unknown as { standardMaterials: boolean }).standardMaterials = true;
    const renderer = new FakeRenderer();
    const simulation = new WaterSimulation(renderer as unknown as THREE.WebGLRenderer, []);

    expect(renderer.compileTargets).toHaveLength(0);
    expect(renderer.boundTargets).toHaveLength(0);
    simulation.dispose();
  });
});
