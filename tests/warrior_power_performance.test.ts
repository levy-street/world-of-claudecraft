import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { prepareMeleeClips } from '../src/render/characters/melee_clips';
import { prepareSignatureClips } from '../src/render/characters/signature_clips';

async function fixture(name = 'Warrior_Shieldcrack') {
  const bytes = readFileSync('public/models/chars/players/warrior_contact_anims.glb');
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const clip = gltf.animations.find((c) => c.name === name);
  if (!clip) throw new Error('Delivered Shieldcrack clip missing');
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const pose = (time: number) => {
    mixer.setTime(time);
    gltf.scene.updateMatrixWorld(true);
  };
  const bone = (name: string) => {
    const found = gltf.scene.getObjectByName(name);
    if (!found) throw new Error(`Required delivered bone missing: ${name}`);
    return found;
  };
  return { gltf, clip, mixer, pose, bone };
}
const position = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
const rotation = (bone: THREE.Object3D) =>
  bone.getWorldQuaternion(new THREE.Quaternion()).normalize();

it.each([
  ['avatar', 'Warrior_Avatar'],
  ['recklessness', 'Warrior_Recklessness'],
  ['bloodrage', 'Warrior_Blood_Toll'],
  ['berserker_rage', 'Warrior_Seething_Fury'],
])('preserves native %s loading, contact and planted recovery', async (id, name) => {
  const f = await fixture(name);
  const bones = ['footl', 'footr', 'toesl', 'toesr', 'root'].map(f.bone);
  f.pose(0);
  const initial = bones.map((b) => ({ position: position(b), rotation: rotation(b) }));
  for (let i = 0; i <= Math.ceil(f.clip.duration / 0.005); i++) {
    f.pose(Math.min(f.clip.duration, i * 0.005));
    bones.forEach((b, j) => {
      expect(position(b).distanceTo(initial[j].position)).toBeLessThan(0.0005);
      expect(rotation(b).angleTo(initial[j].rotation)).toBeLessThan(0.005);
    });
  }
  for (const track of f.clip.tracks) {
    expect(Array.from(track.values).every(Number.isFinite)).toBe(true);
    if (track.name.endsWith('.quaternion'))
      for (let i = 0; i < track.values.length; i += 4)
        expect(Math.hypot(...track.values.slice(i, i + 4))).toBeCloseTo(1, 5);
  }
  const clips = new Map([[name, f.clip]]);
  prepareSignatureClips(clips, { [id]: name });
  prepareMeleeClips(clips, { [id]: name });
  const prepared = clips.get(`Signature_${id}`);
  expect(prepared).toBeDefined();
  expect(prepared).not.toBe(f.clip);
  expect(prepared?.duration).toBeLessThan(0.75);
  expect(prepared?.tracks.map((t) => [t.name, t.times, t.values])).toEqual(
    f.clip.tracks.map((t) => [t.name, t.times, t.values]),
  );
  expect(VISUALS.player_warrior.clips.attackByAbility?.[id]).toBe(name);
});
