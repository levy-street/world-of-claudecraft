import { readFileSync } from 'node:fs';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { createGlbIO, stripToAnimationsOnly } from '../scripts/anim/pose_blend.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { prepareWarriorAbilityClips } from '../src/render/characters/warrior_ability_clips';
import { prepareWarriorActionFallbacks } from '../src/render/characters/warrior_action_fallbacks';

it('keeps the native control poses and timing through actual clip preparation', async () => {
  const bytes = readFileSync('public/models/chars/players/warrior_contact_anims.glb');
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const io = await createGlbIO();
  const donor = await io.read('public/models/chars/players/knight.glb');
  const idle = donor
    .getRoot()
    .listAnimations()
    .find((clip) => clip.getName() === 'Idle');
  if (!idle) throw new Error('The real Knight idle donor is missing');
  stripToAnimationsOnly(donor, [idle]);
  await donor.transform(prune());
  const knightBytes = await io.writeBinary(donor);
  const knight = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      knightBytes.buffer.slice(
        knightBytes.byteOffset,
        knightBytes.byteOffset + knightBytes.byteLength,
      ) as ArrayBuffer,
      '',
    );
  const map = VISUALS.player_warrior.clips;
  const clips = new Map(
    [...knight.animations, ...gltf.animations].map((clip) => [clip.name, clip]),
  );
  prepareWarriorAbilityClips('player_warrior', clips, map.attackByAbility);
  prepareWarriorActionFallbacks('player_warrior', clips, knight.scene);
  for (const id of [
    'heroic_strike',
    'hamstring',
    'sunder_armor',
    'storm_bolt',
    'pummel',
    'sanguine_aura',
    'sweeping_strikes',
    'battle_stance',
    'defensive_stance',
    'berserker_stance',
  ]) {
    const source = gltf.animations.find((clip) => clip.name === map.attackByAbility?.[id]);
    const prepared = clips.get(`Signature_${id}`);
    expect(source, id).toBeDefined();
    expect(prepared, id).toBeDefined();
    if (id === 'storm_bolt') expect(source!.duration).toBeCloseTo(0.82, 6);
    else expect(source!.duration).toBeLessThan(0.7);
    expect(prepared!.duration).toBe(source!.duration);
    expect(prepared!.tracks.map((track) => [track.name, track.times, track.values])).toEqual(
      source!.tracks.map((track) => [track.name, track.times, track.values]),
    );
    for (const track of source!.tracks) {
      expect([...track.values].every(Number.isFinite)).toBe(true);
      if (track.getValueSize() === 4)
        for (let i = 0; i < track.values.length; i += 4)
          expect(Math.hypot(...track.values.slice(i, i + 4))).toBeCloseTo(1, 5);
    }
  }
  for (const [id, native] of [
    ['pummel', 'Warrior_Jawcrack'],
    ['storm_bolt', 'Warrior_Storm_Bolt'],
  ]) {
    const fallback = new Map(clips);
    fallback.delete(native);
    fallback.delete(`Signature_${id}`);
    prepareWarriorActionFallbacks('player_warrior', fallback, knight.scene);
    expect(fallback.get(`Signature_${id}`)?.duration).toBeCloseTo(0.68, 5);
    expect(fallback.get(`Signature_${id}`)?.tracks.length).toBeGreaterThan(0);
  }
  expect(map.attackByAbility?.pummel).toBe('Warrior_Jawcrack');
});
