import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { HunterTrapVisuals } from '../../src/render/hunter_trap_visual';
import { persistentClassVfxPrewarmGroup } from '../../src/render/ability_vfx/prewarm';
import { gfxInternalsForTest } from '../../src/render/gfx';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

it('renders readable hinged trap phases and victim restraints with stable warmed programs', async () => {
  await page.viewport(920, 640);
  const errors = vi.spyOn(console, 'error');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(900, 600);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202a2b);
  scene.add(new THREE.HemisphereLight(0xd8efff, 0x736044, 2));
  const sun = new THREE.DirectionalLight(0xffedcd, 3);
  sun.position.set(4, 8, 2);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x3b4640, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(40, 1.5, 0.01, 100);
  camera.position.set(7, 8, 9);
  camera.lookAt(0, 0, 0);
  const fx = new HunterTrapVisuals(scene, () => 0);
  const state = {
    id: 'trap',
    sourceId: 1,
    abilityId: 'frostjaw_trap',
    x: 0,
    z: 0,
    radius: 4,
    duration: 30,
    remaining: 30,
    armTime: 0.75,
    armRemaining: 0.75,
  };
  try {
    const warm = persistentClassVfxPrewarmGroup();
    warm.visible = true;
    await renderer.compileAsync(warm, camera, scene);
    warm.visible = false;
    let programCount = 0;
    for (let phase = 0; phase < 3; phase++) {
      fx.sync([{ ...state, armRemaining: 0.75 * (1 - phase / 2) }]);
      renderer.render(scene, camera);
      if (phase === 0) programCount = renderer.info.programs?.length ?? 0;
      expect(renderer.info.programs?.length).toBe(programCount);
      await page.screenshot({ path: `../../docs/screenshots/hunter-trap-phase-${phase}.png` });
    }
    camera.position.set(2.6, 2.1, 3.4);
    camera.lookAt(0, 0.25, 0);
    renderer.render(scene, camera);
    await page.screenshot({ path: '../../docs/screenshots/hunter-trap-detail.png' });
    const body = new THREE.Group();
    scene.add(body);
    const ktx = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
    const native = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(ktx)
      .loadAsync('/models/chars/players/ranger.glb');
    const box = new THREE.Box3().setFromObject(native.scene, true);
    native.scene.scale.setScalar(1.8 / (box.max.y - box.min.y));
    native.scene.position.y = -box.min.y * native.scene.scale.y;
    body.add(native.scene);
    fx.sync(
      [],
      new Map([
        [2, { dead: false, auras: [{ id: 'frostjaw_trap_freeze', kind: 'root', remaining: 2 }] }],
      ]),
      new Map([[2, { group: body, height: 1.8 }]]),
    );
    camera.lookAt(0, 0.7, 0);
    renderer.render(scene, camera);
    await page.screenshot({ path: '../../docs/screenshots/hunter-trap-restraint.png' });
    fx.clear();
    body.visible = false;
    camera.position.set(15, 24, 25);
    camera.lookAt(0, 0, 0);
    let warmed = 0;
    for (let tier = 0; tier < 6; tier++) {
      const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: tier % 2 === 1 });
      const variant = new HunterTrapVisuals(scene, () => 0);
      try {
        const prepared = persistentClassVfxPrewarmGroup();
        prepared.visible = true;
        await renderer.compileAsync(prepared, camera, scene);
        prepared.visible = false;
        variant.sync(
          Array.from({ length: 40 }, (_, i) => ({
            ...state,
            id: `raid:${i}`,
            x: ((i % 8) - 3.5) * 4,
            z: (Math.floor(i / 8) - 2) * 4,
            armRemaining: 0,
          })),
        );
        renderer.render(scene, camera);
        expect(renderer.info.render.calls).toBe(4);
        if (tier === 1) warmed = renderer.info.programs?.length ?? 0;
        if (tier > 1) expect(renderer.info.programs?.length).toBe(warmed);
        if (tier === 1)
          await page.screenshot({ path: '../../docs/screenshots/hunter-trap-raid.png' });
      } finally {
        variant.dispose();
        restore();
      }
    }
    ktx.dispose();
    expect(errors.mock.calls).toEqual([]);
  } finally {
    fx.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    errors.mockRestore();
  }
}, 60000);
