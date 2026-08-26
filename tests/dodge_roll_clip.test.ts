import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createPlayerDodgeRollClip,
  PLAYER_DODGE_ROLL_DURATION,
} from '../src/render/characters/dodge_roll_clip';
import { PLAYER_DODGE_ROLL_CLIP, PLAYER_DODGE_ROLL_CLIPS } from '../src/render/dodge_visual_core';

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

  it('synthesizes a distinct full roll for every movement direction', () => {
    const source = sourceClip();
    const clips = (['forward', 'back', 'left', 'right'] as const).map((direction) =>
      createPlayerDodgeRollClip(source, direction),
    );

    expect(clips.map((clip) => clip.name)).toEqual([
      PLAYER_DODGE_ROLL_CLIPS.forward,
      PLAYER_DODGE_ROLL_CLIPS.back,
      PLAYER_DODGE_ROLL_CLIPS.left,
      PLAYER_DODGE_ROLL_CLIPS.right,
    ]);
    const hipRotations = clips.map((clip) =>
      JSON.stringify(clip.tracks.find((track) => track.name === 'hips.quaternion')?.values),
    );
    expect(new Set(hipRotations).size).toBe(4);
    expect(clips.every((clip) => clip.duration === PLAYER_DODGE_ROLL_DURATION)).toBe(true);
  });

  it('rolls forward and backward around the matching KayKit pitch axis', () => {
    const source = sourceClip();
    const forward = createPlayerDodgeRollClip(source, 'forward');
    const back = createPlayerDodgeRollClip(source, 'back');
    const forwardHips = forward.tracks.find((track) => track.name === 'hips.quaternion');
    const backHips = back.tracks.find((track) => track.name === 'hips.quaternion');

    // Key 2 is inside the tuck, before the full turn crosses the quaternion
    // half-way point. KayKit faces +Z, where a forward somersault is +X.
    expect(forwardHips?.values[2 * 4]).toBeGreaterThan(0);
    expect(backHips?.values[2 * 4]).toBeLessThan(0);
  });
});
