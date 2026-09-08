import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { prepareMeleeClips } from '../src/render/characters/melee_clips';
import { prepareSignatureClips } from '../src/render/characters/signature_clips';

async function fixture() {
  const bytes = readFileSync('public/models/chars/players/warrior_contact_anims.glb');
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const clip = gltf.animations.find((c) => c.name === 'Warrior_Shieldcrack');
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

it('ships complete normalized native tracks and preserves every value through both preparation stages', async () => {
  const { gltf, clip } = await fixture();
  expect(clip.duration).toBeCloseTo(0.68, 6);
  expect(clip.duration).toBeLessThan(0.75);
  const names = clip.tracks.map((t) => t.name);
  for (const bone of [
    'root',
    'hips',
    'upperlegl',
    'lowerlegl',
    'footl',
    'toesl',
    'upperlegr',
    'lowerlegr',
    'footr',
    'toesr',
  ])
    for (const path of ['position', 'quaternion', 'scale'])
      expect(names).toContain(`${bone}.${path}`);
  for (const track of clip.tracks) {
    expect(Array.from(track.values).every(Number.isFinite)).toBe(true);
    expect(Array.from(track.times).some((t) => Math.abs(t - 0.15) < 1e-6)).toBe(true);
    const stride = track.getValueSize();
    if (track.name.endsWith('.quaternion')) {
      // q and -q encode the same pose; compare rotation, not storage sign.
      const first = new THREE.Quaternion().fromArray(track.values).normalize();
      const last = new THREE.Quaternion()
        .fromArray(track.values, track.values.length - stride)
        .normalize();
      expect(last.angleTo(first)).toBeLessThan(1e-5);
    } else {
      for (let i = 0; i < stride; i++)
        expect(track.values[track.values.length - stride + i]).toBeCloseTo(track.values[i], 5);
    }
    if (track.name.endsWith('.quaternion'))
      for (let i = 0; i < track.values.length; i += 4)
        expect(Math.hypot(...track.values.slice(i, i + 4))).toBeCloseTo(1, 5);
    if (track.name === 'root.position')
      for (let i = 3; i < track.values.length; i++)
        expect(track.values[i]).toBe(track.values[i % 3]);
  }
  const clips = new Map(gltf.animations.map((c) => [c.name, c]));
  const overrides = { shield_slam: 'Warrior_Shieldcrack' };
  prepareSignatureClips(clips, overrides);
  const prepared = clips.get('Signature_shield_slam');
  expect(prepared).toBeDefined();
  expect(prepared).not.toBe(clip);
  prepareMeleeClips(clips, overrides);
  expect(clips.get('Signature_shield_slam')).toBe(prepared);
  if (!prepared) throw new Error('Prepared contact missing');
  expect(prepared.duration).toBe(clip.duration);
  expect(prepared.tracks).toHaveLength(clip.tracks.length);
  prepared.tracks.forEach((track, i) => {
    expect(track).not.toBe(clip.tracks[i]);
    expect(track.name).toBe(clip.tracks[i].name);
    expect(track.times).toEqual(clip.tracks[i].times);
    expect(track.values).toEqual(clip.tracks[i].values);
  });
});

it('keeps both feet and toes planted between baked frames while driving the shield ahead of the sword', async () => {
  const f = await fixture();
  const feet = ['footl', 'footr', 'toesl', 'toesr'].map(f.bone);
  const root = f.bone('root');
  f.pose(0);
  const initial = feet.map((b) => ({ position: position(b), rotation: rotation(b) }));
  const rootPosition = position(root),
    rootRotation = rotation(root);
  for (let sample = 0; sample <= 136; sample++) {
    f.pose(sample * 0.005);
    for (let i = 0; i < feet.length; i++) {
      expect(
        position(feet[i]).distanceTo(initial[i].position),
        `${feet[i].name} at ${sample * 0.005}`,
      ).toBeLessThanOrEqual(0.0005);
      expect(rotation(feet[i]).angleTo(initial[i].rotation)).toBeLessThanOrEqual(0.005);
    }
    expect(position(root).distanceTo(rootPosition)).toBeLessThan(1e-8);
    expect(rotation(root).angleTo(rootRotation)).toBeLessThan(1e-7);
  }
  const shield = f.bone('handslotl'),
    sword = f.bone('handslotr');
  f.pose(0.085);
  const chamber = position(shield);
  f.pose(0.15);
  expect(position(shield).z - chamber.z).toBeGreaterThan(0.25);
  expect(position(shield).z).toBeGreaterThan(position(sword).z);
  // Hold the actual striking limb and torso, not just the feet that stay still anyway.
  const holdBones = ['hips', 'chest', 'upperarml', 'lowerarml', 'handslotl'].map(f.bone);
  const held = holdBones.map((b) => ({ position: position(b), rotation: rotation(b) }));
  for (let sample = 1; sample <= 6; sample++) {
    f.pose(0.15 + sample * 0.005);
    holdBones.forEach((b, i) => {
      expect(position(b).distanceTo(held[i].position)).toBeLessThan(1e-5);
      expect(rotation(b).angleTo(held[i].rotation)).toBeLessThan(1e-5);
    });
  }
});

it('loads the authored source through the Warrior manifest and retains legacy donor preparation', () => {
  const visual = VISUALS.player_warrior;
  expect(visual.animUrls?.some((url) => url.endsWith('/warrior_contact_anims.glb'))).toBe(true);
  expect(visual.clips.attackByAbility?.shield_slam).toBe('Warrior_Shieldcrack');
  const donor = new THREE.AnimationClip('Shield_Bash', 0.7, [
    new THREE.VectorKeyframeTrack(
      'handslotl.position',
      [0, 0.32, 0.7],
      [0, 0, 0, 0, 0, 0.8, 0, 0, 0],
    ),
  ]);
  const clips = new Map([[donor.name, donor]]);
  prepareSignatureClips(clips, { shield_slam: 'Shield_Bash' });
  prepareMeleeClips(clips, { shield_slam: 'Shield_Bash' });
  const prepared = clips.get('Signature_shield_slam');
  expect(prepared).toBeDefined();
  expect(prepared?.duration).toBeCloseTo(0.68);
  const sample = prepared?.tracks[0].createInterpolant().evaluate(0.15);
  expect(sample?.[2]).toBeCloseTo(0.8, 5);
});
