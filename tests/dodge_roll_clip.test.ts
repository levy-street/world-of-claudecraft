import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createPlayerDodgeRollClip,
  PLAYER_DODGE_ROLL_DURATION,
} from '../src/render/characters/dodge_roll_clip';
import { PLAYER_DODGE_ROLL_CLIP } from '../src/render/dodge_visual_core';

const BONES = [
  'hips',
  'spine',
  'chest',
  'upperarml',
  'upperarmr',
  'lowerarml',
  'lowerarmr',
  'upperlegl',
  'upperlegr',
  'lowerlegl',
  'lowerlegr',
] as const;

function sourceClip(): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 1]),
    new THREE.VectorKeyframeTrack('hips.position', [0, 1], [0, 1, 0, 0, 1, 0]),
  ];
  for (const bone of BONES) {
    tracks.push(
      new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    );
  }
  return new THREE.AnimationClip('Running_A', 1, tracks);
}

describe('player dodge roll clip', () => {
  it('builds a root-locked full roll for the server dodge window', () => {
    const clip = createPlayerDodgeRollClip(sourceClip());
    expect(clip.name).toBe(PLAYER_DODGE_ROLL_CLIP);
    expect(clip.duration).toBe(PLAYER_DODGE_ROLL_DURATION);

    const root = clip.tracks.find((track) => track.name === 'root.position');
    expect(root && Array.from(root.values)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const hips = clip.tracks.find((track) => track.name === 'hips.quaternion');
    expect(hips?.times.length).toBe(6);
    expect(Array.from(hips?.values ?? [])).not.toEqual(new Array(24).fill(0));
  });
});
