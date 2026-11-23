// The ground-decal depth pull (src/render/ground_decal_pull.ts): a flat decal's vertices
// slide toward the eye along their view rays, so tall grass stops hiding it. Pinned here:
// the vertex statement is spliced after project_vertex with its uniform, an existing hook is
// chained (it still runs), and the program key carries both the decal key and the inner
// hook's own key, so two decals with different inner hooks can never share a program.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GROUND_DECAL_PULL, pullDecalTowardCamera } from '../src/render/ground_decal_pull';

function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main() {\n#include <project_vertex>\n}',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    undefined as unknown as THREE.WebGLRenderer,
  );
  return shader;
}

describe('pullDecalTowardCamera', () => {
  it('slides each vertex toward the eye after the projection, by a uniform', () => {
    const m = new THREE.MeshBasicMaterial();
    pullDecalTowardCamera(m, 'test-a');
    const shader = compile(m);
    expect(shader.uniforms.decalPull?.value).toBe(GROUND_DECAL_PULL);
    const at = shader.vertexShader.indexOf('#include <project_vertex>');
    const pull = shader.vertexShader.indexOf('mvPosition.xyz *=');
    expect(pull).toBeGreaterThan(at);
    expect(shader.vertexShader).toContain('gl_Position = projectionMatrix * mvPosition;');
    expect(shader.vertexShader).toContain('uniform float decalPull;');
  });

  it('chains an existing hook and keys the program by both', () => {
    const m = new THREE.MeshBasicMaterial();
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader += '\n// inner';
    };
    m.customProgramCacheKey = () => 'inner-key';
    pullDecalTowardCamera(m, 'test-b', 0.5);
    const shader = compile(m);
    expect(shader.fragmentShader).toContain('// inner');
    expect(shader.uniforms.decalPull?.value).toBe(0.5);
    expect(m.customProgramCacheKey()).toBe('decal-pull:test-b:inner-key');
    // a second decal with a different inner hook keys apart even under the same decal key
    const n = new THREE.MeshBasicMaterial();
    n.customProgramCacheKey = () => 'other-inner';
    pullDecalTowardCamera(n, 'test-b');
    expect(n.customProgramCacheKey()).not.toBe(m.customProgramCacheKey());
  });
});
