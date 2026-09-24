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
