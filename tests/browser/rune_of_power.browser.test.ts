import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { RunesOfPowerVisuals } from '../../src/render/rune_of_power_visual';
import { persistentClassVfxCompileTargets } from '../../src/render/ability_vfx/prewarm';

it('renders Rune states around the native Mage without first-field shader links', async () => {
  await page.viewport(1040, 740);
  const errors = vi.spyOn(console, 'error');
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(1020, 700);
  document.body.appendChild(renderer.domElement);
  const ktx = new KTX2Loader()
    .setTranscoderPath('/basis/')
    .detectSupport(renderer);
  const loader = new GLTFLoader()
    .setKTX2Loader(ktx)
    .setMeshoptDecoder(MeshoptDecoder);
  const body = await loader.loadAsync('/models/chars/players/mage.glb');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a202b);
  scene.add(new THREE.HemisphereLight(0xe2e5ff, 0x3a253e, 2));
  const sun = new THREE.DirectionalLight(0xffeacc, 3);
  sun.position.set(3, 8, 4);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 150),
    new THREE.MeshStandardMaterial({ color: 0x414a43 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  scene.add(ground);
  const bounds = new THREE.Box3().setFromObject(body.scene, true),
    height = bounds.max.y - bounds.min.y;
  body.scene.scale.setScalar(1.8 / height);
  body.scene.position.y = (-bounds.min.y * 1.8) / height;
  scene.add(body.scene);
  const camera = new THREE.PerspectiveCamera(40, 1020 / 700, 0.01, 150);
  camera.position.set(14, 19, 21);
  camera.lookAt(0, 0.2, 0);
  // Compile the exact boot targets, including instanced color attributes.
  const warm = new THREE.Group();
  for (const target of persistentClassVfxCompileTargets())
    warm.add(target.object.clone());
  warm.traverse((o) => {
    o.visible = true;
  });
  await renderer.compileAsync(warm, camera, scene);
  renderer.render(scene, camera);
  const prepared = renderer.info.programs?.length;
  const fx = new RunesOfPowerVisuals(scene, () => 0);
  try {
    for (const disposition of [
      'eligible',
      'opponent',
      'inactive',
      'unknown',
    ] as const) {
      fx.sync([
        {
          id: 'rune',
          sourceId: 1,
          disposition,
          x: 0,
          z: 0,
          radius: 8,
          duration: 15,
          remaining: 10,
        },
      ]);
      fx.update(0.2, true);
      renderer.render(scene, camera);
      expect(renderer.info.programs?.length).toBe(prepared);
      await page.screenshot({
        path: `../../docs/screenshots/rune-power-${disposition}.png`,
      });
    }
    fx.sync(
      Array.from({ length: 20 }, (_, i) => ({
        id: `rune${i}`,
        sourceId: i + 1,
        disposition: i % 2 ? ('eligible' as const) : ('opponent' as const),
        x: (i % 5) * 6 - 12,
        z: Math.floor(i / 5) * 6 - 9,
        radius: 8,
        duration: 15,
        remaining: 8,
      })),
    );
    fx.update(0.1);
    renderer.render(scene, camera);
    expect(renderer.info.programs?.length).toBe(prepared);
    await page.screenshot({
      path: '../../docs/screenshots/rune-power-overlap.png',
    });
    fx.sync([]);
    expect(scene.getObjectByName('rune-of-power-inscription')).toBeUndefined();
    expect(errors.mock.calls).toEqual([]);
  } finally {
    fx.dispose();
    ktx.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    errors.mockRestore();
  }
}, 60000);
