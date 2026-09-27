import * as THREE from 'three';
import { expect, it } from 'vitest';
import { prepareWarriorAbilityClips } from '../src/render/characters/warrior_ability_clips';
import { prepareWarriorActionFallbacks } from '../src/render/characters/warrior_action_fallbacks';

it('preserves Warrior timing and tracks without changing the cached source', () => {
  const source = new THREE.AnimationClip('Fury_Red_Harvest', 0.82, [
    new THREE.NumberKeyframeTrack('root.position[x]', [0, 0.5, 0.82], [0, 1, 0]),
  ]);
  const clips = new Map([[source.name, source]]);
  prepareWarriorAbilityClips('player_warrior', clips, { red_harvest: source.name });
  const result = clips.get('Signature_red_harvest')!;
  expect(result).not.toBe(source);
  expect(result.duration).toBe(source.duration);
  expect(result.tracks[0].times).toEqual(source.tracks[0].times);
  expect(result.tracks[0].values).toEqual(source.tracks[0].values);
  expect(source.name).toBe('Fury_Red_Harvest');
});

it.each(['player_mage', 'player_rogue', 'player_mech'])('does not alter %s clips', (key) => {
  const source = new THREE.AnimationClip('Warrior_Jawcrack', 0.6, []);
  const clips = new Map([[source.name, source]]);
  prepareWarriorAbilityClips(key, clips, { pummel: source.name });
  expect([...clips.values()]).toEqual([source]);
});

it('handles modular Warriors and ignores absent or generic donor clips', () => {
  const source = new THREE.AnimationClip('Warrior_Jawcrack', 0.6, []);
  const generic = new THREE.AnimationClip('Punch_A', 1, []);
  const clips = new Map([
    [source.name, source],
    [generic.name, generic],
  ]);
  prepareWarriorAbilityClips('player_warrior_modular', clips, {
    pummel: source.name,
    storm_bolt: 'Warrior_Storm_Bolt',
    unknown: generic.name,
  });
  expect(clips.get('Signature_pummel')?.duration).toBe(0.6);
  expect(clips.has('Signature_storm_bolt')).toBe(false);
  expect(clips.has('Signature_unknown')).toBe(false);
});

it.each(['player_mage', 'player_rogue', 'player_mech'])(
  'does not create Warrior fallback gestures for %s',
  (key) => {
    const idle = new THREE.AnimationClip('Idle', 1, []);
    const clips = new Map([[idle.name, idle]]);
    prepareWarriorActionFallbacks(key, clips, new THREE.Group());
    expect([...clips.keys()]).toEqual(['Idle']);
  },
);
