import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { createGlbIO } from '../scripts/anim/pose_blend.mjs';

it.each(['Warrior_Quaking_Blow', 'Warrior_Faultline'])(
  '%s keeps the equipped buckler above ground through contact and recovery',
  async (name) => {
    const bytes = readFileSync('public/models/chars/players/warrior_contact_anims.glb');
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const clip = gltf.animations.find((c) => c.name === name)!;
    expect(clip).toBeDefined();
    const shield = await createGlbIO().read('public/models/weapons/shield_round.glb');
    // The equipment adapter resets the GLB root transform before applying the
    // authored shield grip. Do not apply its source scale a second time.
    const points: THREE.Vector3[] = [];
    for (const mesh of shield.getRoot().listMeshes())
      for (const primitive of mesh.listPrimitives()) {
        const attribute = primitive.getAttribute('POSITION')!;
        for (let i = 0; i < attribute.getCount(); i++)
          points.push(
            new THREE.Vector3()
              .fromArray(attribute.getElement(i, []))
              .multiplyScalar(0.4413)
              .add(new THREE.Vector3(0, 0.017, 0.1771)),
          );
      }
    expect(points.length).toBeGreaterThan(300);
    const slot = gltf.scene.getObjectByName('handslotl')!;
    const mixer = new THREE.AnimationMixer(gltf.scene),
      action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const p = new THREE.Vector3();
    for (let i = 0; i <= Math.ceil(clip.duration / 0.005); i++) {
      const time = Math.min(clip.duration, i * 0.005);
      mixer.setTime(time);
      gltf.scene.updateMatrixWorld(true);
      let minimum = Infinity;
      for (const point of points)
        minimum = Math.min(minimum, p.copy(point).applyMatrix4(slot.matrixWorld).y);
      expect(minimum, `lowest equipped shield vertex at ${time}s`).toBeGreaterThan(0.01);
    }
  },
);
