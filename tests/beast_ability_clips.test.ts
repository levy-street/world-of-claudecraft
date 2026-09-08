import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { prepareBeastAbilityClips } from '../src/render/characters/beast_ability_clips';

function fixture(wolf: boolean) {
  const tracks = [
    wolf ? 'Head' : 'head',
    wolf ? 'Spine_4' : 'spine',
    'Chin',
    'Front_Leg_Shoulder_L',
    'Front_Leg_Shoulder_R',
    'arm',
  ].map(
    (name) =>
      new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  );
  return new Map([
    [
      'Idle',
      new THREE.AnimationClip('Idle', 1, [
        ...tracks,
        new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 0]),
      ]),
    ],
  ]);
}
describe('anatomical beast actions', () => {
  it('Headbutt moves the head through anticipation and contact without a weapon swing or root teleport', () => {
    const clips = fixture(false);
    prepareBeastAbilityClips('player_druid', clips);
    const clip = clips.get('Signature_skull_bash')!;
    const head = clip.tracks.find((t) => t.name === 'head.quaternion')!;
    expect(head.values[4]).toBeLessThan(0);
    expect(head.values[8]).toBeGreaterThan(0);
    expect(clip.tracks.find((t) => t.name === 'root.position')!.values.every((n) => n === 0)).toBe(
      true,
    );
    expect(clip.tracks.find((t) => t.name === 'arm.quaternion')!.values[8]).toBe(0);
    expect(clip.duration).toBeLessThan(0.75);
  });
  it('keeps world wolves untouched and gives each player wolf action a different pose', () => {
    const world = fixture(true);
    prepareBeastAbilityClips('mob_wolf', world);
    expect(world.size).toBe(1);
    const player = fixture(true);
    prepareBeastAbilityClips('form_cat', player);
    const fingerprints = [...player]
      .filter(([id]) => id.startsWith('Signature_'))
      .map(([, clip]) => JSON.stringify(clip.tracks.map((t) => [...t.values])));
    expect(new Set(fingerprints).size).toBe(7);
    for (const clip of player.values())
      for (const track of clip.tracks) expect([...track.values].every(Number.isFinite)).toBe(true);
  });
});
