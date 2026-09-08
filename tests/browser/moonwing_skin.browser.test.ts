import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it, vi } from 'vitest';

it('renders the shipped feathered skin and binds native lunar release gestures on a real GPU', async () => {
  const errors = vi.spyOn(console, 'error');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [body, donor] = await Promise.all([
    loader.loadAsync('/models/chars/forms/moonwing.glb'),
    loader.loadAsync('/models/chars/players/druid_ability_anims.glb'),
  ]);
  const scene = new THREE.Scene();
  scene.add(body.scene, new THREE.HemisphereLight(0xd9ecff, 0x705334, 2));
  const mixer = new THREE.AnimationMixer(body.scene);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(256, 256);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 30);
  camera.position.set(0, 1.2, 4.5);
  camera.lookAt(0, 1, 0);
  const bounds = new THREE.Box3();
  const meshes: THREE.SkinnedMesh[] = [];
  body.scene.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh);
  });
  expect(meshes).toHaveLength(3);
  try {
    const poses: string[] = [];
    for (const name of ['Cast_Starfall', 'Cast_Nature']) {
      const clip = donor.animations.find((c) => c.name === name);
      expect(clip).toBeDefined();
      if (!clip) throw new Error(`Missing ${name}`);
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).play();
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        mixer.setTime(phase * clip.duration);
        body.scene.updateMatrixWorld(true);
        bounds.setFromObject(body.scene, true);
        const size = bounds.getSize(new THREE.Vector3());
        expect(size.toArray().every(Number.isFinite)).toBe(true);
        expect(size.length()).toBeGreaterThan(1);
        expect(size.length()).toBeLessThan(6);
        renderer.render(scene, camera);
        poses.push(meshes[0].skeleton.bones.map((b) => b.quaternion.toArray().join(',')).join('|'));
      }
      action.stop();
    }
    expect(new Set(poses).size).toBeGreaterThan(3);
    expect(renderer.info.render.triangles).toBe(56384);
    expect(errors.mock.calls).toEqual([]);
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(body.scene);
    body.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      }
    });
    renderer.dispose();
    errors.mockRestore();
  }
});
