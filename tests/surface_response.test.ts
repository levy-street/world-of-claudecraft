import * as THREE from 'three';
import { expect, it } from 'vitest';
import { CharacterSurfaceResponse } from '../src/render/characters/surface_response';

it('gives physical and holy contacts different body treatments with bounded recovery', () => {
  const response = new CharacterSurfaceResponse(),
    root = new THREE.Group();
  expect(response.trigger('physical', 0.8)).toBe(true);
  expect(response.uniforms.uSurfaceKind.value).toBe(5);
  response.update(0.23, root, 1.8);
  expect(response.active).toBe(false);
  expect(response.trigger('holy', 0.9)).toBe(true);
  expect(response.uniforms.uSurfaceKind.value).toBe(6);
  response.update(0.56, root, 1.8);
  expect(response.active).toBe(false);
  expect(response.trigger('physical', Number.NaN)).toBe(false);
});

it('holds a frost glaze on the same program: one edge on, none while a hit comes and goes', () => {
  const response = new CharacterSurfaceResponse(),
    root = new THREE.Group();
  const glaze = { height: 0.5, glow: 0.8, bite: 0, alpha: 0.9 };
  // On: one edge (the rig re-mounts), then only the uniform moves.
  expect(response.setGlaze(glaze)).toBe(true);
  expect(response.active).toBe(true);
  expect(response.setGlaze({ ...glaze, height: 0.7 })).toBe(false);
  expect(response.uniforms.uSurfaceGlaze.value.x).toBeCloseTo(0.7);
  // A hit's treatment under the glaze needs no re-mount, nor does its end.
  expect(response.trigger('physical', 0.8)).toBe(false);
  expect(response.update(0.3, root, 1.8)).toBe(false);
  expect(response.active).toBe(true);
  // The glaze keeps following the body.
  root.position.set(4, 0, 2);
  root.updateMatrixWorld();
  response.update(0.016, root, 1.8);
  expect(response.uniforms.uSurfaceOrigin.value.x).toBe(4);
  // Off: one edge, back to the rig's own materials.
  expect(response.setGlaze(null)).toBe(true);
  expect(response.active).toBe(false);
  expect(response.uniforms.uSurfaceGlaze.value.w).toBe(0);
});

it("paints the glaze on the body's own material: a chilled film, a rim and glints, never a shell", () => {
  const response = new CharacterSurfaceResponse();
  const material = response.material(new THREE.MeshStandardMaterial()) as THREE.Material;
  const shader = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader:
      '#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>\n#include <lights_fragment_end>',
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('uniform vec4 uSurfaceGlaze;');
  expect(shader.fragmentShader).toContain('glazeCoat');
  expect(shader.fragmentShader).toContain('glazeRim');
  expect(shader.fragmentShader).toContain('glazeGlint');
  // Its light joins after the lights: the hit response's emissive line stays exactly as it was.
  expect(shader.fragmentShader).toContain(
    '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=surfaceEmission;\n#include <lights_fragment_end>',
  );
  expect((shader.uniforms as Record<string, unknown>).uSurfaceGlaze).toBe(
    response.uniforms.uSurfaceGlaze,
  );
});
