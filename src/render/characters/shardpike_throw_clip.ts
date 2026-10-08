import * as THREE from 'three';
import { LANCE_THROW_DURATION, LANCE_THROW_RELEASE } from '../../sim/lance_throw_timing';

export const SHARDPIKE_THROW_CLIP = 'Signature_lance_thrust';
export const SHARDPIKE_THROW_TIMES = [
  0,
  0.14,
  0.29,
  LANCE_THROW_RELEASE,
  0.48,
  0.68,
  0.9,
  LANCE_THROW_DURATION,
];
type Joint = readonly [number, number, number];
// Native KayKit local axes (rest * Rz * Rx * Ry). Coil through hips/chest,
// lead with the elbow, release over the shoulder, then carry through the torso.
const POSES: Readonly<Record<string, readonly [Joint, Joint, Joint]>> = {
  hips: [
    [0, -4, -12],
    [0, 5, 12],
    [0, 8, 16],
  ],
  spine: [
    [0, -8, -14],
    [0, 10, 16],
    [0, 13, 20],
  ],
  chest: [
    [0, -12, -25],
    [0, 16, 25],
    [0, 12, 32],
  ],
  head: [
    [0, 5, 28],
    [0, -5, -28],
    [0, -4, -36],
  ],
  upperarmr: [
    [-30, 135, -15],
    [-50, 75, -30],
    [65, 12, 0],
  ],
  lowerarmr: [
    [60, 0, 0],
    [8, 0, 0],
    [25, 0, 0],
  ],
  // Keep the long shaft above the shoulder and pointing toward the target;
  // the generic empty-hand throwing wrist otherwise buries the spear point.
  handslotr: [
    [-170.3, 59.4, 163.08],
    [-72.82, 21.7, 16.09],
    [-160.71, 47.47, 137.74],
  ],
  upperarml: [
    [55, -45, 0],
    [5, -90, -20],
    [-10, -100, -30],
  ],
  lowerarml: [
    [-30, 0, 0],
    [-85, 0, 0],
    [-60, 0, 0],
  ],
};

/** Prepare on the real rig, never mutate a cached source clip or skeleton. */
export function prepareShardpikeThrowClip(
  key: string,
  clips: Map<string, THREE.AnimationClip>,
  rig: THREE.Object3D,
  idleName: string,
): void {
  if (!key.startsWith('player_')) return;
  const idle = clips.get(idleName);
  if (!idle || !rig.getObjectByName('upperarmr')) return;
  const tracks = idle.tracks.map((track) => {
    const size = track.getValueSize();
    const sample = Array.from(track.createInterpolant().evaluate(0) as ArrayLike<number>);
    const copy = track.clone();
    copy.times = new Float32Array([0, LANCE_THROW_DURATION]);
    copy.values = new Float32Array([...sample.slice(0, size), ...sample.slice(0, size)]);
    return copy;
  });
  for (const [name, poses] of Object.entries(POSES)) {
    const bone = rig.getObjectByName(name);
    if (!bone) continue;
    const index = tracks.findIndex((track) => track.name === `${name}.quaternion`);
    const ready =
      index < 0 ? bone.quaternion.clone() : new THREE.Quaternion().fromArray(tracks[index].values);
    const [coil, release, follow] = poses.map(([z, x, y]) =>
      bone.quaternion
        .clone()
        .multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180, 'ZXY'),
          ),
        )
        .normalize(),
    );
    const frames = [
      ready,
      ready.clone().slerp(coil, 0.7),
      coil,
      release,
      release.clone().slerp(follow, 0.6),
      follow,
      follow.clone().slerp(ready, 0.8),
      ready,
    ];
    const track = new THREE.QuaternionKeyframeTrack(
      `${name}.quaternion`,
      SHARDPIKE_THROW_TIMES,
      frames.flatMap((q) => q.toArray()),
    );
    if (index < 0) tracks.push(track);
    else tracks[index] = track;
  }
  clips.set(
    SHARDPIKE_THROW_CLIP,
    new THREE.AnimationClip(SHARDPIKE_THROW_CLIP, LANCE_THROW_DURATION, tracks),
  );
}
