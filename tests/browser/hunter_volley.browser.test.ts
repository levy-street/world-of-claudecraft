import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { AbilityVfxFx } from '../../src/render/ability_vfx/fx';
import { drawHunterVolley } from '../../src/render/ability_vfx/hunter_volley';

it('renders the downward arrow silhouette at normal combat distance without new programs per pulse', async () => {
  await page.viewport(920, 640);
  const errors = vi.spyOn(console, 'error');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151b23);
  const camera = new THREE.PerspectiveCamera(48, 1.5, 0.1, 100);
  camera.position.set(14, 15, 19);
  camera.lookAt(0, 1.8, 0);
  renderer.setSize(900, 600);
  document.body.appendChild(renderer.domElement);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 28),
    new THREE.MeshBasicMaterial({ color: 0x34332d }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor, new THREE.GridHelper(28, 28, 0x625b49, 0x484539));
  const dummy = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1, 4, 10),
    new THREE.MeshBasicMaterial({ color: 0x777566 }),
  );
  dummy.position.y = 1;
  scene.add(dummy);
  const fx = new AbilityVfxFx(
    scene,
    camera,
    () => null,
    () => 0,
  );
  try {
    drawHunterVolley(fx, 0, 0, 8, 1, 0, 0);
    fx.update(0.085);
    renderer.render(scene, camera);
    const programs = renderer.info.programs?.length;
    expect(renderer.info.render.triangles).toBeGreaterThan(100);
    await page.screenshot({ path: '../../docs/screenshots/hunter-volley-flight.png' });
    fx.update(0.12);
    renderer.render(scene, camera);
    await page.screenshot({ path: '../../docs/screenshots/hunter-volley-landing.png' });
    for (let pulse = 0; pulse < 6; pulse++) {
      fx.clear();
      drawHunterVolley(fx, 0, 0, 8, 1 + pulse, pulse * 0.5, pulse % 3);
      fx.update(0.12);
      renderer.render(scene, camera);
      expect(renderer.info.programs?.length).toBe(programs);
    }
    expect(errors.mock.calls).toEqual([]);
  } finally {
    fx.dispose();
    floor.geometry.dispose();
    floor.material.dispose();
    dummy.geometry.dispose();
    dummy.material.dispose();
    renderer.domElement.remove();
    renderer.dispose();
    errors.mockRestore();
  }
});
