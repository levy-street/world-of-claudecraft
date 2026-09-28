// The blade carpet writes its fade ring into the vertex shader as literals
// (GFX.bladeCarpetRadius and the meadow fade start), so the ring must key the
// program. Without a customProgramCacheKey three keys it on the hook's source
// text, which holds the template and not the value: two carpets of different
// radii in one renderer would share the first one's program and fade at its
// radius. Small radii keep the real carpet builds cheap: the key logic does
// not depend on which radius a tier picks.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBladeGrass } from '../src/render/blade_grass';
import { gfxInternalsForTest } from '../src/render/gfx';
import { MEADOW_CARPET_FADE_START } from '../src/render/meadow_tuning';

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

function carpetMaterial(radius: number): THREE.Material {
  restores.push(gfxInternalsForTest.overrideSettings({ bladeCarpetRadius: radius }));
  const view = buildBladeGrass(1337, 0, 0);
  restores.pop()?.();
  let material: THREE.Material | null = null;
  view.group.traverse((child) => {
    if (!material && child instanceof THREE.Mesh) material = child.material as THREE.Material;
  });
  if (!material) throw new Error(`no carpet mesh built at radius ${radius}`);
  return material;
}

function vertexShaderOf(material: THREE.Material): string {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as Parameters<THREE.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.vertexShader;
}

describe('blade carpet program key', () => {
  it('differs between two carpets built with different radii', () => {
    const narrow = carpetMaterial(3);
    const wide = carpetMaterial(4);
    expect(narrow.customProgramCacheKey()).not.toBe(wide.customProgramCacheKey());
  });

  it('carries the exact fade ring the shader templates', () => {
    const material = carpetMaterial(4);
    const from = (4 * MEADOW_CARPET_FADE_START).toFixed(1);
    expect(vertexShaderOf(material)).toContain(`smoothstep(${from}, 4.0,`);
    expect(material.customProgramCacheKey()).toContain(`|${from}|4.0`);
  });

  it('is stable for one radius, so a rebuilt carpet reuses its program', () => {
    expect(carpetMaterial(3).customProgramCacheKey()).toBe(
      carpetMaterial(3).customProgramCacheKey(),
    );
  });
});
