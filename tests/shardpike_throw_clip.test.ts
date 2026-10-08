import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  prepareShardpikeThrowClip,
  SHARDPIKE_THROW_CLIP,
} from '../src/render/characters/shardpike_throw_clip';
import { LANCE_THROW_DURATION, LANCE_THROW_RELEASE } from '../src/sim/lance_throw_timing';

describe('Shardpike rig compatibility and authored timing', () => {
  it('pins release and recovery independently of the implementation', () => {
    expect(LANCE_THROW_RELEASE).toBe(0.4);
    expect(LANCE_THROW_DURATION).toBe(1.1);
  });
  const players = Object.entries(VISUALS).filter(([key]) => key.startsWith('player_'));
  it('includes fixed, modular and mech bodies', () => {
    expect(players.length).toBeGreaterThan(15);
    expect(players.some(([key]) => key === 'player_mech')).toBe(true);
  });
  it.each(players)(
    'binds a normalized throw to the shipped %s skeleton without changing its source',
    (key, def) => {
      const bytes = readFileSync(`public/${def.url}`);
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
      const rig = new THREE.Group();
      for (const node of json.nodes) {
        const bone = new THREE.Bone();
        bone.name = THREE.PropertyBinding.sanitizeNodeName(node.name ?? '');
        if (node.rotation) bone.quaternion.fromArray(node.rotation);
        rig.add(bone);
      }
      const tracks = ['upperarmr', 'lowerarmr', 'spine', 'hips'].map((name) => {
        const bone = rig.getObjectByName(name);
        expect(bone, `${key}:${name}`).toBeDefined();
        const q = bone?.quaternion.toArray() ?? [0, 0, 0, 1];
        return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [...q, ...q]);
      });
      tracks.push(
        new THREE.QuaternionKeyframeTrack('root.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      );
      const idle = new THREE.AnimationClip(def.clips.idle, 1, tracks);
      const before = THREE.AnimationClip.toJSON(idle);
      const clips = new Map([[idle.name, idle]]);
      prepareShardpikeThrowClip(key, clips, rig, idle.name);
      const clip = clips.get(SHARDPIKE_THROW_CLIP);
      expect(clip).toBeDefined();
      expect(clip?.duration).toBe(LANCE_THROW_DURATION);
      expect(THREE.AnimationClip.toJSON(idle)).toEqual(before);
      for (const track of clip?.tracks ?? []) {
        for (let i = 0; i < track.values.length; i += 4) {
          expect(new THREE.Quaternion().fromArray(track.values, i).length()).toBeCloseTo(1, 5);
        }
        expect(Array.from(track.values.slice(0, 4))).toEqual(Array.from(track.values.slice(-4)));
      }
      const arm = clip?.tracks.find((track) => track.name === 'upperarmr.quaternion');
      const sample = arm?.createInterpolant();
      const windup = new THREE.Quaternion().fromArray(sample?.evaluate(0.29));
      const release = new THREE.Quaternion().fromArray(sample?.evaluate(LANCE_THROW_RELEASE));
      expect(windup.angleTo(release)).toBeGreaterThan(1);
    },
  );
});
