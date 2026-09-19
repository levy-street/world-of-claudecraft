import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import {
  KAYKIT_ONE_HAND_SWORD_GRIP,
  KAYKIT_SHIELD_GRIPS,
} from '../src/render/characters/held_item_grips';

async function gearSurface(model: string) {
  const bytes = readFileSync(`public/models/weapons/${model}.glb`);
  const material = new THREE.MeshBasicMaterial();
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .register(() => ({
      name: 'geometry-only-clearance',
      loadMaterial: () => Promise.resolve(material),
    }))
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      '',
    );
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node);
  });
  // flattenWeaponScene clears this one mesh's original node transform before
  // applyHandGrip supplies its replacement. Fail if that fixture shape changes.
  expect(gltf.scene.children).toHaveLength(1);
  expect(meshes).toHaveLength(1);
  const positions = meshes[0].geometry.getAttribute('position');
  const vertices = Array.from({ length: positions.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(positions, i),
  );
  meshes[0].geometry.dispose();
  material.dispose();
  return vertices;
}

it.each([
  'Warrior_Shieldcrack',
  'Warrior_Revenge',
  'Warrior_Quaking_Blow',
  'Warrior_Faultline',
  'Warrior_Victory_Rush',
  'Warrior_Bladestorm_Loop',
  'Warrior_Iron_Bellow',
  'Warrior_Direhowl',
  'Warrior_Emboldening_Roar',
  'Warrior_Defiant_Bellow',
  'Warrior_Valor_Roar',
  'Warrior_Intimidating_Shout',
  'Warrior_Piercing_Howl',
])('%s keeps its real sword and shield clear throughout the body compression', async (name) => {
  const bytes = readFileSync('public/models/chars/players/warrior_contact_anims.glb');
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      '',
    );
  const clip = gltf.animations.find((candidate) => candidate.name === name);
  if (!clip) throw new Error('Missing native Ironguard performance');
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  for (const [model, hand, grip] of [
    ['sword_1handed', 'handslotr', KAYKIT_ONE_HAND_SWORD_GRIP.r],
    ['shield_round', 'handslotl', KAYKIT_SHIELD_GRIPS.Round_Shield.l],
  ] as const) {
    action.reset().play();
    // This rig omits accessory nodes; use the same authored fallback
    // mounting tables as the renderer, including the actual shield scale.
    const socket = gltf.scene.getObjectByName(hand);
    if (!socket) throw new Error(`Missing actual ${model} mounting socket`);
    // Use every decoded surface vertex, not empty AABB corners around a
    // round shield. Three's attribute access decodes normalized positions.
    const vertices = await gearSurface(model);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(grip.position),
      new THREE.Quaternion().fromArray(grip.quaternion),
      new THREE.Vector3().setScalar(grip.scale),
    );
    const point = new THREE.Vector3();
    for (let i = 0; i <= Math.ceil(clip.duration / 0.002); i++) {
      const time = Math.min(clip.duration, i * 0.002);
      mixer.setTime(time);
      expect(action.time, `${name} ${model} samples the requested pose`).toBeCloseTo(time, 6);
      gltf.scene.updateMatrixWorld(true);
      const held = socket.matrixWorld.clone().multiply(local);
      let minimum = Infinity;
      for (const vertex of vertices) {
        point.copy(vertex).applyMatrix4(held);
        minimum = Math.min(minimum, point.y);
      }
      expect(minimum, `${name} ${model} at ${time}s`).toBeGreaterThanOrEqual(0);
    }
  }
});
