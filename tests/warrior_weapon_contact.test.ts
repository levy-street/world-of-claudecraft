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
