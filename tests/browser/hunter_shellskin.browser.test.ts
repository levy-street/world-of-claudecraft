import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { gfxInternalsForTest } from '../../src/render/gfx';
import { HunterShellskinVisual } from '../../src/render/hunter_shellskin_visual';

it('fits the active carapace to the native Hunter rig through moving poses', async () => {
  await page.viewport(920, 640);
  const errors = vi.spyOn(console, 'error');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const ktx = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx);
  const body = await loader.loadAsync('/models/chars/players/ranger.glb');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20262c);
  scene.add(new THREE.HemisphereLight(0xd9ecff, 0x705334, 2));
  const sun = new THREE.DirectionalLight(0xffeccb, 3);
  sun.position.set(4, 7, 5);
  scene.add(sun);
  const character = new THREE.Group();
  character.add(body.scene);
  scene.add(character);
  const bounds = new THREE.Box3().setFromObject(body.scene, true);
  const height = bounds.max.y - bounds.min.y;
  body.scene.scale.setScalar(1.8 / height);
  body.scene.position.y = (-bounds.min.y * 1.8) / height;
  const shell = new HunterShellskinVisual();
  character.add(shell.group);
  const mixer = new THREE.AnimationMixer(body.scene);
  renderer.setSize(900, 600);
  document.body.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(40, 1.5, 0.01, 40);
  camera.position.set(2.8, 2.1, 4.6);
  camera.lookAt(0, 0.95, 0);
  const material = shell.plates.material;
  const matrices = shell.plates.instanceMatrix.array;
  try {
    expect(body.scene.getObjectByName('chest')).toBeDefined();
    expect(
      body.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('upperarm.l')),
    ).toBeDefined();
    const clip = body.animations.find((c) => /attack|run|walk/i.test(c.name));
    expect(clip).toBeDefined();
    if (!clip) throw new Error('Native Hunter movement missing');
    mixer.clipAction(clip).play();
    let warmPrograms: number | undefined;
    for (let phase = 0; phase < 5; phase++) {
      mixer.setTime((clip.duration * phase) / 5);
      body.scene.updateMatrixWorld(true);
      shell.update(
        { id: 'shellskin', kind: 'shield_wall', value: 0.6, duration: 8, remaining: 7 },
        1.8,
        body.scene,
      );
      renderer.render(scene, camera);
      if (phase === 0) warmPrograms = renderer.info.programs?.length;
      expect(renderer.info.programs?.length).toBe(warmPrograms);
      expect(shell.plates.material).toBe(material);
      expect(shell.plates.instanceMatrix.array).toBe(matrices);
      expect(Array.from(matrices).every(Number.isFinite)).toBe(true);
    }
    await page.screenshot({ path: '../../docs/screenshots/hunter-shellskin-front.png' });
    camera.position.set(-2.8, 2.1, -4.6);
    camera.lookAt(0, 0.95, 0);
    renderer.render(scene, camera);
    await page.screenshot({ path: '../../docs/screenshots/hunter-shellskin-back.png' });
    shell.update(
      { id: 'shellskin', kind: 'shield_wall', value: 0.4, duration: 8, remaining: 7 },
      1.8,
      body.scene,
    );
    camera.position.set(2.8, 2.1, 4.6);
    camera.lookAt(0, 0.95, 0);
    renderer.render(scene, camera);
    await page.screenshot({ path: '../../docs/screenshots/hunter-shellskin-mobile.png' });
    shell.group.visible = false;
    let warmedCount = 0;
    for (let tier = 0; tier < 6; tier++) {
      const restore = gfxInternalsForTest.overrideSettings({ standardMaterials: tier % 2 === 1 });
      const variant = new HunterShellskinVisual();
      character.add(variant.group);
      try {
        variant.update(
          { id: 'shellskin', kind: 'shield_wall', value: 0.6, duration: 8, remaining: 7 },
          1.8,
          body.scene,
        );
        await renderer.compileAsync(variant.group, camera, scene);
        renderer.render(scene, camera);
        expect((variant.plates.material as THREE.Material).type).toBe(
          tier % 2 === 1 ? 'MeshStandardMaterial' : 'MeshLambertMaterial',
        );
        if (tier === 1) {
          warmedCount = renderer.info.programs?.length ?? 0;
          await page.screenshot({ path: '../../docs/screenshots/hunter-shellskin-high.png' });
        }
        if (tier > 1) expect(renderer.info.programs?.length).toBe(warmedCount);
      } finally {
        variant.dispose();
        restore();
      }
    }
    shell.update(null, 1.8, body.scene);
    renderer.render(scene, camera);
    expect(shell.group.visible).toBe(false);
    expect(errors.mock.calls).toEqual([]);
  } finally {
    shell.dispose();
    mixer.stopAllAction();
    mixer.uncacheRoot(body.scene);
    body.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
    renderer.domElement.remove();
    ktx.dispose();
    renderer.dispose();
    errors.mockRestore();
  }
});
