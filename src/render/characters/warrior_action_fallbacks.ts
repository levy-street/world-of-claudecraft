import * as THREE from 'three';

// Native KayKit axes, rest * Rz * Rx * Ry, matching the shipped punch/throw
// authoring scripts. These clips bind to the real GLB skeleton; no new rig.
type Joint = readonly [number, number, number];
type Pose = Readonly<Record<string, Joint>>;
interface Action {
  gather: Pose;
  contact: Pose;
  follow?: Pose;
}
const GUARD: Pose = {
  upperarmr: [-20, -90, 0],
  lowerarmr: [100, 0, 0],
  upperarml: [55, -125, 0],
  lowerarml: [-65, 0, 0],
  chest: [0, 0, -16],
  spine: [0, -3, -8],
};
const PUNCH: Pose = {
  upperarmr: [46, 4, 0],
  lowerarmr: [12, 0, 0],
  upperarml: [52, -108, 0],
  lowerarml: [-50, 0, 0],
  chest: [0, 7, 25],
  spine: [0, 6, 14],
  hips: [0, 4, 6],
};
const ACTIONS: Readonly<Record<string, Action>> = {
  storm_bolt: {
    gather: { upperarmr: [-35, 85, -15], lowerarmr: [105, 0, 0], chest: [0, -12, -30] },
    contact: { upperarmr: [65, 12, 0], lowerarmr: [8, 0, 0], chest: [0, 18, 28] },
    follow: { upperarmr: [80, -35, 0], lowerarmr: [25, 0, 0], chest: [0, 10, 36] },
  },
  pummel: { gather: GUARD, contact: { ...PUNCH, upperarmr: [65, 5, 0] } },
};
const TIMES = [0, 0.045, 0.1, 0.15, 0.19, 0.32, 0.48, 0.68];

/** Native clips always win; only a missing Warrior gesture uses this prepared fallback. */
export function prepareWarriorActionFallbacks(
  key: string,
  clips: Map<string, THREE.AnimationClip>,
  rig: THREE.Object3D,
): void {
  if (key !== 'player_warrior' && key !== 'player_warrior_modular') return;
  const idle = clips.get('Idle');
  if (!idle) return;
  for (const [id, action] of Object.entries(ACTIONS)) {
    if (clips.has(id === 'pummel' ? 'Warrior_Jawcrack' : 'Warrior_Storm_Bolt')) continue;
    const tracks = idle.tracks.map((t) => t.clone());
    for (const name of new Set([...Object.keys(action.gather), ...Object.keys(action.contact)])) {
      const bone = rig.getObjectByName(name);
      if (!bone) continue;
      const original = idle.tracks.find((t) => t.name === `${name}.quaternion`);
      const ready = original
        ? new THREE.Quaternion().fromArray(original.createInterpolant().evaluate(0))
        : bone.quaternion.clone();
      const make = (pose: Pose) => {
        const a = pose[name] ?? [0, 0, 0];
        return bone.quaternion
          .clone()
          .multiply(
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                THREE.MathUtils.degToRad(a[1]),
                THREE.MathUtils.degToRad(a[2]),
                THREE.MathUtils.degToRad(a[0]),
                'ZXY',
              ),
            ),
          )
          .normalize();
      };
      const gather = make(action.gather),
        contact = make(action.contact),
        follow = make(action.follow ?? action.contact);
      const frames = [
        ready,
        ready.clone().slerp(gather, 0.6),
        gather,
        contact,
        contact,
        follow,
        follow.clone().slerp(ready, 0.7),
        ready,
      ];
      const track = new THREE.QuaternionKeyframeTrack(
        `${name}.quaternion`,
        TIMES,
        frames.flatMap((q) => q.toArray()),
      );
      const index = tracks.findIndex((t) => t.name === track.name);
      if (index < 0) tracks.push(track);
      else tracks[index] = track;
    }
    clips.set(`Signature_${id}`, new THREE.AnimationClip(`Signature_${id}`, 0.68, tracks));
  }
}
