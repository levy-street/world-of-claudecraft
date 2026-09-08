import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { SignatureCrests } from '../../src/render/ability_vfx/signature_crests';
import {
  createSurfaceResponseMaterial,
  surfaceResponseUniforms,
} from '../../src/render/characters/surface_response';
import { PaladinAegisVisual } from '../../src/render/paladin_aegis_visual';

it('compiles and draws the solar vault and all body-response branches on the real WebGL driver', () => {
  const errors = vi.spyOn(console, 'error');
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const aegis = new PaladinAegisVisual();
  const crests = new SignatureCrests(scene);
  crests.spawn(0, 2, 0, 1.15, 1.15, 0x8f8374, 0xf2d5ad, 'hook');
  crests.update(0.1, false);
  const source = new THREE.MeshStandardMaterial({ color: 0x778899 });
  const uniforms = surfaceResponseUniforms();
  const material = createSurfaceResponseMaterial(source, uniforms);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), material);
  body.position.y = 1;
  scene.add(aegis.group, body, new THREE.AmbientLight(0xffffff, 2));
  camera.position.set(12, 8, 14);
  camera.lookAt(0, 3, 0);
  renderer.setSize(256, 256);
  aegis.update(true, 0.2, false);
  try {
    renderer.compile(scene, camera);
    for (const kind of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      uniforms.uSurfaceKind.value = kind;
      uniforms.uSurfaceAge.value = 0.25;
      uniforms.uSurfaceAmount.value = 0.9;
      renderer.render(scene, camera);
    }
    expect(
      errors.mock.calls.filter((call) =>
        /shader|compile|VALIDATE_STATUS|WebGLProgram/i.test(call.join(' ')),
      ),
    ).toEqual([]);
    expect(renderer.info.render.calls).toBeGreaterThan(0);
  } finally {
    errors.mockRestore();
    aegis.dispose();
    crests.dispose();
    body.geometry.dispose();
    material.dispose();
    source.dispose();
    renderer.dispose();
  }
});
