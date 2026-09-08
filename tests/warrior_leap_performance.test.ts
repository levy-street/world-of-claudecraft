import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { prepareMeleeClips } from '../src/render/characters/melee_clips';
import { prepareSignatureClips } from '../src/render/characters/signature_clips';

it('preserves the delivered Leap landing and recovery through actual clip preparation', async () => {
  const bytes = readFileSync('public/models/chars/players/warrior_ability_anims.glb');
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const rush = gltf.animations.find((clip) => clip.name === VISUALS.player_warrior.clips.rush);
  if (!rush) throw new Error('Delivered Warrior rush loop missing');
  expect(rush.duration).toBeCloseTo(0.6, 5);
  for (const track of rush.tracks) {
    expect([...track.values].every(Number.isFinite)).toBe(true);
    const size = track.getValueSize();
    expect([...track.values.slice(0, size)]).toEqual([...track.values.slice(-size)]);
    if (size === 4)
      for (let i = 0; i < track.values.length; i += 4)
        expect(Math.hypot(...track.values.slice(i, i + 4))).toBeCloseTo(1, 5);
  }
  const source = gltf.animations.find((clip) => clip.name === 'Warrior_Heroic_Leap');
  if (!source) throw new Error('Delivered Heroic Leap performance missing');
  const map = VISUALS.player_warrior.clips;
  expect(map.attackByAbility?.heroic_leap).toBe(source.name);
  expect(map.attackTimeScaleByAbility?.heroic_leap).toBe(1);
  const clips = new Map([[source.name, source]]);
  prepareSignatureClips(clips, map.attackByAbility);
  prepareMeleeClips(clips, map.attackByAbility);
  const prepared = clips.get('Signature_heroic_leap');
  if (!prepared) throw new Error('Prepared Heroic Leap performance missing');
  // The generic melee path formerly compressed this to .68 seconds and moved
  // the landing pose away from the simulation's actual .60-second touchdown.
  expect(source.duration).toBeCloseTo(0.96, 5);
  expect(prepared.duration).toBe(source.duration);
  expect(prepared).not.toBe(source);
  expect(prepared.tracks.map((track) => [track.name, track.times, track.values])).toEqual(
    source.tracks.map((track) => [track.name, track.times, track.values]),
  );
  expect(prepared.tracks.length).toBeGreaterThan(60);
  for (let i = 0; i < source.tracks.length; i++) {
    const authored = source.tracks[i].createInterpolant();
    const runtime = prepared.tracks[i].createInterpolant();
    for (const time of [0.55, 0.6, 0.65, 0.84, 0.96])
      expect(Array.from(runtime.evaluate(time))).toEqual(Array.from(authored.evaluate(time)));
  }
});
