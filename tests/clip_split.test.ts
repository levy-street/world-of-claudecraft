// src/render/characters/clip_split.ts: cutting a clip in two with the exact
// boundary pose in both halves (the dual-wield two-strike split).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dualWieldHalfNames, splitClipAt } from '../src/render/characters/clip_split';

function clip(): THREE.AnimationClip {
  // A sparse linear ramp on position (keys only at 0 and 1 s) and a rotation
  // with keys at 0, 0.5 and 1 s: exactly the shapes a resampled export ships.
  const pos = new THREE.VectorKeyframeTrack('bone.position', [0, 1], [0, 0, 0, 10, 0, 0]);
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const rot = new THREE.QuaternionKeyframeTrack(
    'bone.quaternion',
    [0, 0.5, 1],
    [...q0.toArray(), ...q1.toArray(), ...q2.toArray()],
  );
  return new THREE.AnimationClip('Two', 1, [pos, rot]);
}

describe('splitClipAt', () => {
  it('cuts into two clips whose durations sum to the source and both start at t=0', () => {
    const [head, tail] = splitClipAt(clip(), 0.4, ['Two#main', 'Two#off']);
    expect(head.name).toBe('Two#main');
    expect(tail.name).toBe('Two#off');
    expect(head.duration).toBeCloseTo(0.4, 6);
    expect(tail.duration).toBeCloseTo(0.6, 6);
    for (const c of [head, tail]) for (const t of c.tracks) expect(t.times[0]).toBeCloseTo(0, 6);
  });

  it('samples the exact pose at the cut into both halves (a sparse ramp is not held flat)', () => {
    const [head, tail] = splitClipAt(clip(), 0.4, ['a', 'b']);
    const headPos = head.tracks.find((t) => t.name === 'bone.position') as THREE.KeyframeTrack;
    const tailPos = tail.tracks.find((t) => t.name === 'bone.position') as THREE.KeyframeTrack;
    // the ramp reaches x=4 at 0.4 s: the head ends there, the tail starts there
    expect(headPos.values[headPos.values.length - 3]).toBeCloseTo(4, 5);
    expect(tailPos.values[0]).toBeCloseTo(4, 5);
    expect(tailPos.values[tailPos.values.length - 3]).toBeCloseTo(10, 5);
    // rotations slerp to the boundary: 0.4 s sits 80% of the way to the 90 deg key
    const headRot = head.tracks.find((t) => t.name === 'bone.quaternion') as THREE.KeyframeTrack;
    const n = headRot.values.length;
    const q = new THREE.Quaternion().fromArray(Array.from(headRot.values.subarray(n - 4, n)));
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    expect(angle).toBeCloseTo((Math.PI / 2) * 0.8, 3);
  });

  it('keeps interior keys on their own side and drops none', () => {
    const [head, tail] = splitClipAt(clip(), 0.4, ['a', 'b']);
    const headRot = head.tracks.find((t) => t.name === 'bone.quaternion') as THREE.KeyframeTrack;
    const tailRot = tail.tracks.find((t) => t.name === 'bone.quaternion') as THREE.KeyframeTrack;
    expect(Array.from(headRot.times)).toEqual([0, 0.4].map((v) => expect.closeTo(v, 6)));
    expect(Array.from(tailRot.times)).toEqual([0, 0.1, 0.6].map((v) => expect.closeTo(v, 6)));
  });

  it('names the halves deterministically', () => {
    expect(dualWieldHalfNames('Dual_Chop')).toEqual(['Dual_Chop#main', 'Dual_Chop#off']);
  });
});
