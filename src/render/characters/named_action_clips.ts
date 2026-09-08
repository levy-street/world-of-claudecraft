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
  shrapnel_charge: {
    gather: { upperarml: [25, -120, 0], lowerarml: [-70, 0, 0], chest: [0, -4, 16] },
    contact: { upperarml: [-42, -10, 0], lowerarml: [-20, 0, 0], chest: [0, 9, -18] },
  },
  trailbreak: {
    gather: {
      hips: [0, 15, 0],
      chest: [0, 18, 0],
      upperlegr: [0, -30, 0],
      upperlegl: [0, -30, 0],
      lowerlegr: [0, 50, 0],
      lowerlegl: [0, 50, 0],
    },
    contact: {
      chest: [0, -13, 0],
      spine: [0, -7, 0],
      upperlegr: [0, 15, 0],
      upperlegl: [0, 15, 0],
      lowerlegr: [0, 10, 0],
      lowerlegl: [0, 10, 0],
    },
  },
  pack_command: {
    gather: GUARD,
    contact: { upperarmr: [55, 0, 0], lowerarmr: [8, 0, 0], head: [0, -5, 10], chest: [0, 3, 14] },
  },
  unleash_beast: {
    gather: { ...GUARD, chest: [0, -8, -15] },
    contact: { upperarmr: [65, 12, 0], lowerarmr: [12, 0, 0], chest: [0, 8, 20] },
  },
  pummel: { gather: GUARD, contact: { ...PUNCH, upperarmr: [65, 5, 0] } },
  frostjaw_trap: {
    gather: {
      chest: [0, 12, 0],
      spine: [0, 10, 0],
      upperarmr: [-15, -80, 0],
      lowerarmr: [75, 0, 0],
    },
    contact: {
      hips: [0, 10, 0],
      spine: [0, 15, 0],
      chest: [0, 12, 0],
      upperarmr: [-15, -150, 0],
      lowerarmr: [18, 0, 0],
      upperlegr: [0, -24, 0],
      lowerlegr: [0, 34, 0],
      upperlegl: [0, -24, 0],
      lowerlegl: [0, 34, 0],
    },
  },
  frost_trap: {
    gather: { chest: [0, 14, 0], upperarmr: [-15, -90, 0], lowerarmr: [85, 0, 0] },
    contact: {
      hips: [0, 12, 0],
      spine: [0, 14, 0],
      chest: [0, 15, 0],
      upperarmr: [-12, -158, 0],
      lowerarmr: [12, 0, 0],
      upperlegr: [0, -26, 0],
      lowerlegr: [0, 38, 0],
      upperlegl: [0, -26, 0],
      lowerlegl: [0, 38, 0],
    },
  },
  body_blow: { gather: GUARD, contact: PUNCH },
  knockout_blow: {
    gather: { ...GUARD, chest: [0, -8, -25] },
    contact: { ...PUNCH, upperarmr: [62, 10, 0], chest: [0, 10, 34] },
    follow: { ...PUNCH, upperarmr: [82, 30, 0], chest: [0, 2, 42] },
  },
  gouge: {
    gather: GUARD,
    contact: { ...PUNCH, upperarmr: [63, 10, 0], chest: [0, 4, 12] },
  },
  cheap_shot: {
    gather: GUARD,
    contact: { ...PUNCH, upperarmr: [24, -12, 0], chest: [0, 12, 17] },
  },
  flurry_of_knives: {
    gather: {
      upperarmr: [-20, -85, 0],
      upperarml: [20, -85, 0],
      lowerarmr: [110, 0, 0],
      lowerarml: [-110, 0, 0],
      chest: [0, -8, -12],
    },
    contact: {
      upperarmr: [58, 8, 0],
      upperarml: [-58, 8, 0],
      lowerarmr: [15, 0, 0],
      lowerarml: [-15, 0, 0],
      chest: [0, 8, 14],
    },
  },
  thieves_chorus: {
    gather: { upperarmr: [-14, -90, 0], lowerarmr: [85, 0, 0] },
    contact: {
      upperarmr: [-8, 75, 0],
      lowerarmr: [150, 0, 0],
      head: [0, -8, 0],
      chest: [0, -4, 0],
    },
  },
  bloodhook: {
    gather: { ...GUARD, upperarmr: [-32, -105, 0], chest: [0, -4, -20] },
    contact: { ...PUNCH, upperarmr: [50, 10, 0], chest: [0, 5, 15] },
    follow: {
      ...GUARD,
      upperarmr: [-12, 70, 0],
      lowerarmr: [130, 0, 0],
      chest: [0, -8, -5],
    },
  },
};
const TIMES = [0, 0.045, 0.1, 0.15, 0.19, 0.32, 0.48, 0.68];

export function prepareNamedActionClips(
  key: string,
  clips: Map<string, THREE.AnimationClip>,
  rig: THREE.Object3D,
): void {
  const rogue = key === 'player_rogue' || key === 'player_rogue_modular';
  const hunter = key === 'player_hunter' || key === 'player_hunter_modular';
  const warrior = key === 'player_warrior' || key === 'player_warrior_modular';
  if (!rogue && !hunter && !warrior && key !== 'player_mech') return;
  const idle = clips.get('Idle');
  if (!idle) return;
  for (const [id, action] of Object.entries(ACTIONS)) {
    const hunterAction = [
      'bloodhook',
      'frostjaw_trap',
      'frost_trap',
      'shrapnel_charge',
      'trailbreak',
      'pack_command',
      'unleash_beast',
    ].includes(id);
    if (warrior && id !== 'pummel' && id !== 'storm_bolt') continue;
    if (!warrior && key !== 'player_mech' && (id === 'pummel' || id === 'storm_bolt')) continue;
    if (hunter && !hunterAction) continue;
    if (rogue && hunterAction) continue;
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
