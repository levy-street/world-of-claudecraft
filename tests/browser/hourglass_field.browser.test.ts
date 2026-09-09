import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ABILITY_MATERIAL_SOURCES } from '../../src/render/ability_material_prewarm';
import { gfxInternalsForTest } from '../../src/render/gfx';
import {
  resetTemporalHourglassProfileCaches,
  TemporalHourglassGroundVisuals,
} from '../../src/render/temporal_hourglass_visual';

it('shows distinct clockwork capture states at combat camera and reuses prepared graphics variants', async () => {
  await page.viewport(920, 640);
  const errors = vi.spyOn(console, 'error');
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(900, 600);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222a30);
  scene.add(new THREE.HemisphereLight(0xd5eaff, 0x736045, 2));
  const sun = new THREE.DirectionalLight(0xffe8c9, 2.5);
  sun.position.set(4, 7, 2);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x4c514b }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(40, 1.5, 0.01, 60);
  camera.position.set(5, 6, 7);
  camera.lookAt(0, 0.2, 0);
  const entries = ABILITY_MATERIAL_SOURCES.filter(
    (source) => source.id === 'temporal-hourglass' || source.id === 'hourglass-field',
  );
  let preparedCount = 0;
  try {
    for (let tier = 0; tier < 6; tier++) {
      const restore = gfxInternalsForTest.overrideSettings({
        standardMaterials: tier % 2 === 1,
      });
      resetTemporalHourglassProfileCaches();
      const warm = new THREE.Group();
      for (const entry of entries) warm.add(entry.build());
      warm.traverse((o) => {
        o.visible = true;
      });
      await renderer.compileAsync(warm, camera, scene);
      const fx = new TemporalHourglassGroundVisuals(scene, () => 0);
      try {
        for (const disposition of ['protective', 'hostile', 'unknown'] as const) {
          fx.sync([
            {
              id: 'trap',
              sourceId: 1,
              disposition,
              x: 0,
              z: 0,
              radius: 1.75,
              duration: 30,
              remaining: 18,
            },
          ]);
          fx.update(0);
          renderer.render(scene, camera);
          if (tier === 1 && disposition === 'unknown')
            preparedCount = renderer.info.programs?.length ?? 0;
          if (tier > 1) expect(renderer.info.programs?.length).toBe(preparedCount);
          if (tier === 1)
            await page.screenshot({
              path: `../../docs/screenshots/hourglass-field-${disposition}.png`,
            });
        }
        fx.sync([]);
        renderer.render(scene, camera);
        expect(scene.getObjectByName('temporal-hourglass-visual')).toBeUndefined();
      } finally {
        fx.dispose();
        restore();
      }
    }
    expect(errors.mock.calls).toEqual([]);
  } finally {
    renderer.dispose();
    renderer.domElement.remove();
    errors.mockRestore();
  }
}, 60000);
