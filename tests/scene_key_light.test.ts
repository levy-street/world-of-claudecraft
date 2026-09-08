import * as THREE from 'three';
import { expect, it } from 'vitest';
import { bindSceneSamples, sceneKeyLightUniform } from '../src/render/scene_sampling';

it('binds cloned VFX materials to their own scene lighting without changing another scene', () => {
  const scene = new THREE.Scene(),
    other = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    uniforms: { uSunWorld: { value: new THREE.Vector3() } },
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material.clone());
  const unbind = bindSceneSamples(scene, mesh);
  const otherBefore = sceneKeyLightUniform(other).value.clone();
  sceneKeyLightUniform(scene).value.set(0, 1, 0);
  expect(mesh.material.uniforms.uSunWorld).toBe(sceneKeyLightUniform(scene));
  expect(mesh.material.uniforms.uSunWorld.value.toArray()).toEqual([0, 1, 0]);
  expect(sceneKeyLightUniform(other).value.equals(otherBefore)).toBe(true);
  unbind();
  mesh.geometry.dispose();
  mesh.material.dispose();
  material.dispose();
});
