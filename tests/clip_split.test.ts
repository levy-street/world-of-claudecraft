// src/render/characters/clip_split.ts: cutting a clip in two with the exact
// boundary pose in both halves (the dual-wield two-strike split).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  dualWieldHalfNames,
  sharedClipSplit,
  splitClipAt,
} from '../src/render/characters/clip_split';

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

// The halves are data like the clip they are cut from, so every rig that asks for the
// same cut of the same clip is handed the same two clips (a mixer binds per root).
describe('sharedClipSplit', () => {
  const NAMES: [string, string] = ['Two#main', 'Two#off'];

  it('mints the halves of one source and cut once, and hands back the same clips after', () => {
    const source = clip();
    const first = sharedClipSplit(source, 0.4, NAMES);
    const again = sharedClipSplit(source, 0.4, ['Two#main', 'Two#off']);
    expect(again[0]).toBe(first[0]);
    expect(again[1]).toBe(first[1]);
    // two halves, never one clip handed back twice
    expect(first[0]).not.toBe(first[1]);
    expect(first[0].uuid).not.toBe(first[1].uuid);
  });

  it('holds exactly what a fresh split would, track for track', () => {
    const source = clip();
    const shared = sharedClipSplit(source, 0.4, NAMES);
    const fresh = splitClipAt(source, 0.4, NAMES);
    for (const half of [0, 1] as const) {
      expect(shared[half].name).toBe(fresh[half].name);
      expect(shared[half].duration).toBe(fresh[half].duration);
      expect(shared[half].blendMode).toBe(fresh[half].blendMode);
      expect(shared[half].tracks).toHaveLength(fresh[half].tracks.length);
      shared[half].tracks.forEach((track, i) => {
        const want = fresh[half].tracks[i];
        expect(track.name).toBe(want.name);
        expect(track.ValueTypeName).toBe(want.ValueTypeName);
        expect(track.getInterpolation()).toBe(want.getInterpolation());
        expect(Array.from(track.times)).toEqual(Array.from(want.times));
        expect(Array.from(track.values)).toEqual(Array.from(want.values));
      });
    }
    // ...and the fresh split is never the cached one: splitClipAt still mints
    expect(fresh[0]).not.toBe(shared[0]);
  });

  it('keeps a different cut of the same source as its own entry', () => {
    const source = clip();
    const at4 = sharedClipSplit(source, 0.4, NAMES);
    // another time...
    const at6 = sharedClipSplit(source, 0.6, NAMES);
    expect(at6[0]).not.toBe(at4[0]);
    expect(at6[0].duration).toBeCloseTo(0.6, 6);
    expect(at4[0].duration).toBeCloseTo(0.4, 6);
    // ...and the same time under other names (the hunter's aim and release halves)
    const renamed = sharedClipSplit(source, 0.4, ['Two#aim', 'Two#release']);
    expect(renamed[0]).not.toBe(at4[0]);
    expect(renamed[0].name).toBe('Two#aim');
    expect(renamed[1].name).toBe('Two#release');
    // each entry is still its own on a repeat
    expect(sharedClipSplit(source, 0.6, NAMES)[0]).toBe(at6[0]);
    expect(sharedClipSplit(source, 0.4, NAMES)[1]).toBe(at4[1]);
    expect(sharedClipSplit(source, 0.4, ['Two#aim', 'Two#release'])[1]).toBe(renamed[1]);
    // either name alone makes another cut: the halves carry their names
    const firstOnly = sharedClipSplit(source, 0.4, ['Two#aim', 'Two#off']);
    const secondOnly = sharedClipSplit(source, 0.4, ['Two#main', 'Two#release']);
    for (const pair of [firstOnly, secondOnly]) {
      expect(pair[0]).not.toBe(at4[0]);
      expect(pair[0]).not.toBe(renamed[0]);
      expect(pair[1]).not.toBe(at4[1]);
      expect(pair[1]).not.toBe(renamed[1]);
    }
    expect(firstOnly[0].name).toBe('Two#aim');
    expect(firstOnly[1].name).toBe('Two#off');
    expect(secondOnly[0].name).toBe('Two#main');
    expect(secondOnly[1].name).toBe('Two#release');
  });

  it('never confuses two cuts whose names only differ in where they are joined', () => {
    // a clip name may hold any character, a separator included: the entry is keyed on the
    // three parameters themselves, never on their concatenation
    const source = clip();
    const a = sharedClipSplit(source, 0.4, ['x|y', 'z']);
    const b = sharedClipSplit(source, 0.4, ['x', 'y|z']);
    const c = sharedClipSplit(source, 0.4, ['x","y', 'z']);
    const d = sharedClipSplit(source, 0.4, ['x', 'y","z']);
    expect(new Set([a[0], b[0], c[0], d[0]]).size).toBe(4);
    expect(a[0].name).toBe('x|y');
    expect(b[0].name).toBe('x');
    expect(c[1].name).toBe('z');
    expect(d[1].name).toBe('y","z');
  });

  it('never shares between two source clips, however alike', () => {
    const a = sharedClipSplit(clip(), 0.4, NAMES);
    const b = sharedClipSplit(clip(), 0.4, NAMES);
    expect(b[0]).not.toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
  });

  it('drives two rigs from one pair of halves, each on its own clock', () => {
    const [head] = sharedClipSplit(clip(), 0.4, NAMES);
    const rigs = [0, 1].map(() => {
      const root = new THREE.Group();
      const bone = new THREE.Object3D();
      bone.name = 'bone';
      root.add(bone);
      const mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(head);
      action.play();
      return { mixer, action, bone };
    });
    expect(rigs[0].action).not.toBe(rigs[1].action);
    expect(rigs[0].action.getClip()).toBe(rigs[1].action.getClip());
    // the ramp reaches x=1 at 0.1 s and x=3 at 0.3 s: each rig is posed by its own mixer
    rigs[0].mixer.update(0.1);
    rigs[1].mixer.update(0.3);
    expect(rigs[0].bone.position.x).toBeCloseTo(1, 5);
    expect(rigs[1].bone.position.x).toBeCloseTo(3, 5);
    // letting one rig go leaves the shared clip whole for the other
    rigs[0].mixer.stopAllAction();
    rigs[0].mixer.uncacheRoot(rigs[0].mixer.getRoot());
    rigs[1].mixer.update(0.05);
    expect(rigs[1].bone.position.x).toBeCloseTo(3.5, 5);
    expect(head.tracks).toHaveLength(2);
  });
});
