// The Tidehold town kit's weathering layer (src/render/assets/town_smart_material.ts):
// it must only touch materials that carry BOTH a recipe (glTF extras ->
// userData.townSmart) and a mask (the occlusion slot), chain an existing hook,
// key its program, survive a clone, and splice its GLSL at the two anchors.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyTownSmart,
  patchTownSmartFragment,
  reapplyTownSmartToClone,
} from '../src/render/assets/town_smart_material';

const SPEC = {
  dirt: [0.2, 0.15, 0.1],
  dirtAmt: 0.5,
  moss: [0.3, 0.4, 0.2],
  mossAmt: 0.4,
  edge: [0.9, 0.9, 0.8],
  edgeAmt: 0.3,
  aoDiffuse: 0.6,
};

function smartMat(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.aoMap = new THREE.Texture();
  m.userData.townSmart = SPEC;
  return m;
}

describe('town smart material layer', () => {
  it('patches only materials with a recipe and a mask', () => {
    expect(applyTownSmart(smartMat())).toBe(true);
    const noMask = new THREE.MeshStandardMaterial();
    noMask.userData.townSmart = SPEC;
    expect(applyTownSmart(noMask)).toBe(false);
    const noSpec = new THREE.MeshStandardMaterial();
    noSpec.aoMap = new THREE.Texture();
    expect(applyTownSmart(noSpec)).toBe(false);
    expect(applyTownSmart(new THREE.MeshBasicMaterial())).toBe(false);
  });

  it('chains a previous hook, keys its program and stays merge-eligible', () => {
    const m = smartMat();
    let prevRan = false;
    m.onBeforeCompile = () => {
      prevRan = true;
    };
    applyTownSmart(m);
    expect(m.userData.wocFrameAgnostic).toBe(true);
    expect(m.customProgramCacheKey()).toMatch(/\|townSmart$/);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    m.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );
    expect(prevRan).toBe(true);
    expect(shader.uniforms.tsSmartDirtAmt.value).toBe(0.5);
    expect(shader.fragmentShader).toContain('tsMask');
    expect(shader.fragmentShader).toContain('uniform float tsSmartAoDiffuse;');
  });

  it('splices after color_fragment and normal_fragment_maps, once each', () => {
    const out = patchTownSmartFragment(THREE.ShaderLib.physical.fragmentShader);
    const albedo = out.indexOf('tsSmartDirtAmt, 0.0');
    const colorAt = out.indexOf('#include <color_fragment>');
    const mossAt = out.indexOf('tsSmartMossAmt * 1.4');
    const normalAt = out.indexOf('#include <normal_fragment_maps>');
    expect(albedo).toBeGreaterThan(colorAt);
    expect(mossAt).toBeGreaterThan(normalAt);
    expect(out.split('tsSmartMossAmt * 1.4').length).toBe(2);
    expect(patchTownSmartFragment('void main() {}')).toBe('void main() {}');
  });

  it('re-attaches to a clone (clone() drops onBeforeCompile)', () => {
    const m = smartMat();
    applyTownSmart(m);
    const c = m.clone();
    expect(c.customProgramCacheKey()).not.toMatch(/townSmart/);
    reapplyTownSmartToClone(c);
    expect(c.customProgramCacheKey()).toMatch(/\|townSmart$/);
  });
});
