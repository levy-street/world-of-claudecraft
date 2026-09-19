import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { variantGripTransform } from '../src/render/characters/weapon_grip';

// Use the shipped greatblade's actual geometry bounds, not the hand's position.
// A forward hand can still hold a sword pointing behind the Warrior.
const weapon = readFileSync('public/models/weapons/adv_sword_2handed_color.glb');
const json = JSON.parse(weapon.toString('utf8', 20, 20 + weapon.readUInt32LE(12)));
const bounds = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];

it.each([
  ['warrior_contact_anims', 'Warrior_Maiming_Strike', 'r'],
  ['warrior_contact_anims', 'Warrior_Early_Grave', 'r'],
  ['warrior_contact_anims', 'Warrior_Brute_Swing', 'r'],
  ['warrior_contact_anims', 'Warrior_Redhand', 'r'],
  ['warrior_contact_anims', 'Warrior_Reaping_Arc', 'r'],
  ['warrior_contact_anims', 'Warrior_Breachmaker', 'r'],
  ['warrior_contact_anims', 'Warrior_Victory_Rush', 'r'],
  ['warrior_contact_anims', 'Warrior_Victory_Rush', 'l'],
  ['warrior_contact_anims', 'Warrior_Bloodletting', 'r'],
  ['warrior_contact_anims', 'Warrior_Bloodletting', 'l'],
  ['warrior_contact_anims', 'Warrior_Reaver_Strike', 'r'],
  ['warrior_contact_anims', 'Warrior_Reaver_Strike', 'l'],
  ['warrior_contact_anims', 'Warrior_Bladestorm_Loop', 'r'],
  ['warrior_contact_anims', 'Warrior_Bladestorm_Loop', 'l'],
  ['warrior_contact_anims', 'Warrior_Iron_Bellow', 'r'],
  ['warrior_contact_anims', 'Warrior_Iron_Bellow', 'l'],
  ['warrior_contact_anims', 'Warrior_Emboldening_Roar', 'r'],
  ['warrior_contact_anims', 'Warrior_Emboldening_Roar', 'l'],
  ['warrior_contact_anims', 'Warrior_Valor_Roar', 'r'],
  ['warrior_contact_anims', 'Warrior_Valor_Roar', 'l'],
  ['warrior_contact_anims', 'Warrior_Intimidating_Shout', 'r'],
  ['warrior_contact_anims', 'Warrior_Intimidating_Shout', 'l'],
  ['warrior_contact_anims', 'Warrior_Piercing_Howl', 'r'],
  ['warrior_contact_anims', 'Warrior_Piercing_Howl', 'l'],
  ['warrior_fury_anims', 'Fury_Twinstrike', 'r'],
  ['warrior_fury_anims', 'Fury_Twinstrike', 'l'],
])('%s %s keeps its %s blade above the floor throughout recovery', async (file, name, side) => {
  const bytes = readFileSync(`public/models/chars/players/${file}.glb`);
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      '',
    );
  const clip = gltf.animations.find((candidate) => candidate.name === name);
  const socket = gltf.scene.getObjectByName(`handslot${side}`);
  if (!clip || !socket) throw new Error('Missing native blade performance or socket');
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const grip = variantGripTransform(bounds.max[1] - bounds.min[1], side === 'l', 0.04, 2);
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(grip.position),
    new THREE.Quaternion().fromArray(grip.quaternion),
    new THREE.Vector3().setScalar(grip.scale),
  );
  // All corners of the real mesh bounds: a centreline-only test can miss a
  // wide blade clipping the floor. Sample interpolated frames, not just keys.
  const point = new THREE.Vector3();
  for (let i = 0; i <= Math.ceil(clip.duration / 0.002); i++) {
    const time = Math.min(clip.duration, i * 0.002);
    mixer.setTime(time);
    expect(action.time).toBeCloseTo(time, 6);
    gltf.scene.updateMatrixWorld(true);
    const held = socket.matrixWorld.clone().multiply(local);
    for (const x of [bounds.min[0], bounds.max[0]])
      for (const y of [bounds.min[1], bounds.max[1]])
        for (const z of [bounds.min[2], bounds.max[2]]) {
          point.set(x, y, z).applyMatrix4(held);
          expect(point.y, `${name} blade floor clearance at ${time}s`).toBeGreaterThanOrEqual(0);
        }
  }
});

it.each([
  ['warrior_fury_anims', 'Fury_Twinstrike', 0.15, 'r'],
  ['warrior_fury_anims', 'Fury_Twinstrike', 0.34, 'l'],
  ['warrior_fury_anims', 'Fury_Red_Harvest', 0.15, 'r'],
  ['warrior_fury_anims', 'Fury_Red_Harvest', 0.32, 'l'],
  ['warrior_fury_anims', 'Fury_Red_Harvest', 0.49, 'r'],
  ['warrior_fury_anims', 'Fury_Red_Harvest', 0.49, 'l'],
  ['warrior_contact_anims', 'Warrior_Maiming_Strike', 0.15, 'r'],
  ['warrior_contact_anims', 'Warrior_Early_Grave', 0.15, 'r'],
  ['warrior_contact_anims', 'Warrior_Bloodletting', 0.15, 'r'],
  ['warrior_contact_anims', 'Warrior_Victory_Rush', 0.15, 'r'],
  ['warrior_contact_anims', 'Warrior_Brute_Swing', 0.15, 'r'],
  ['warrior_contact_anims', 'Warrior_Redhand', 0.15, 'r'],
])(
  '%s %s at %s puts the %s blade through the forward torso region',
  async (file, name, time, side) => {
    const bytes = readFileSync(`public/models/chars/players/${file}.glb`);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) throw new Error(`Missing shipped performance ${name}`);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    mixer.setTime(time);
    gltf.scene.updateMatrixWorld(true);
    const socket = gltf.scene.getObjectByName(`handslot${side}`);
    if (!socket) throw new Error('Missing native weapon socket');
    const grip = variantGripTransform(bounds.max[1] - bounds.min[1], side === 'l', 0.04, 2);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(grip.position),
      new THREE.Quaternion().fromArray(grip.quaternion),
      new THREE.Vector3().setScalar(grip.scale),
    );
    const held = socket.matrixWorld.clone().multiply(local);
    const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(held);
    const tip = new THREE.Vector3(0, bounds.max[1], 0).applyMatrix4(held);
    // This is a representative torso plane in native rig space, not a sim hitbox.
    // The segment must reach it facing forward and cross between waist and shoulders.
    const fraction = (0.9 - origin.z) / (tip.z - origin.z);
    expect(tip.z - origin.z).toBeGreaterThan(0.4);
    expect(fraction).toBeGreaterThanOrEqual(0);
    expect(fraction).toBeLessThanOrEqual(1);
    const crossing = origin.lerp(tip, fraction);
    expect(Math.abs(crossing.x)).toBeLessThan(0.8);
    expect(crossing.y).toBeGreaterThanOrEqual(0.4);
    expect(crossing.y).toBeLessThanOrEqual(1.2);
  },
);
