import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { PaladinAegisVisual } from '../../src/render/paladin_aegis_visual';
import { SupportRecipientVisual } from '../../src/render/support_recipient_visual';
import { persistentClassVfxCompileTargets } from '../../src/render/ability_vfx/prewarm';

it('renders Aegis channel and distinct support recipients without first-cast shader links', async () => {
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
  const body = await loader.loadAsync('/models/chars/players/paladin.glb');
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
  const fx = new PaladinAegisVisual();
  const recipient = new SupportRecipientVisual();
  const wearer = new THREE.Group();
  scene.remove(body.scene);
  wearer.add(body.scene, recipient.group);
  scene.add(wearer, fx.group);
  try {
    fx.update(true, 0.1, true);
    fx.pulse(false);
    fx.update(true, 0.01, true);
    recipient.update(2, 1.8, body.scene);
    renderer.render(scene, camera);
    expect(renderer.info.programs?.length).toBe(prepared);
    await page.screenshot({ path: '../../docs/screenshots/aegis-channel.png' });
    fx.update(false, 1, true);
    camera.position.set(2.8, 2.3, 3.5);
    camera.lookAt(0, 1, 0);
    for (const [bits, name] of [
      [2, 'protection'],
      [1, 'rune'],
      [4, 'speed'],
      [7, 'combined'],
    ] as const) {
      recipient.update(bits, 1.8, body.scene);
      renderer.render(scene, camera);
      expect(renderer.info.programs?.length).toBe(prepared);
      await page.screenshot({
        path: `../../docs/screenshots/aegis-recipient-${name}.png`,
      });
    }
    fx.pulse(true);
    fx.update(false, 0.15, true);
    expect(fx.group.getObjectByName('paladin-aegis-dome')?.visible).toBe(false);
    camera.position.set(14, 19, 21);
    camera.lookAt(0, 0.2, 0);
    renderer.render(scene, camera);
    await page.screenshot({
      path: '../../docs/screenshots/aegis-completion.png',
    });
    const crowd: SupportRecipientVisual[] = [];
    for (let i = 0; i < 40; i++) {
      const visual = new SupportRecipientVisual();
      visual.group.position.set(
        (i % 8) * 1.4 - 5,
        0,
        Math.floor(i / 8) * 1.4 - 3,
      );
      scene.add(visual.group);
      visual.update(i % 2 ? 2 : 1, 1.8, null);
      crowd.push(visual);
    }
    renderer.render(scene, camera);
    expect(renderer.info.programs?.length).toBe(prepared);
    for (const visual of crowd) visual.dispose();
    expect(errors.mock.calls).toEqual([]);
  } finally {
    recipient.dispose();
    fx.dispose();
    ktx.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    errors.mockRestore();
  }
}, 60000);
