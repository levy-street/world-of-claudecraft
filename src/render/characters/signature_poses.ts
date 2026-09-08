import * as THREE from 'three';
import { SIGNATURE_ABILITIES, type Signature } from '../ability_vfx/signature_core';

type Angles = readonly [number, number, number];
type Pose = Readonly<Record<string, Angles>>;
interface Performance {
  gather: Pose;
  contact: Pose;
  compress: number;
}

/** Degrees in each native KayKit joint's local XYZ frame. These restrained
 * offsets supplement the rig's own full-body donor, including its planted feet. */
const POSES: Record<Signature, Performance> = {
  pyre: {
    compress: 0.018,
    gather: {
      spine: [-7, 18, -4],
      chest: [-5, 14, -3],
      head: [5, -15, 2],
      upperarml: [-12, 18, -16],
      lowerarml: [-8, 0, -17],
      upperarmr: [8, -14, 8],
      wristr: [0, -10, 12],
    },
    contact: {
      spine: [10, -12, 2],
      chest: [7, -8, 0],
      head: [-5, 8, 0],
      upperarml: [14, -12, 12],
      upperarmr: [-18, 8, -12],
      lowerarmr: [9, 0, 10],
    },
  },
  glacier: {
    compress: 0.022,
    gather: {
      spine: [-10, 0, 0],
      chest: [-7, 0, 0],
      head: [-6, 0, 0],
      upperarml: [-18, 0, -17],
      upperarmr: [-18, 0, 17],
      lowerarml: [8, 0, -10],
      lowerarmr: [8, 0, 10],
    },
    contact: {
      spine: [13, 0, 0],
      chest: [8, 0, 0],
      head: [8, 0, 0],
      upperarml: [17, 0, 22],
      upperarmr: [17, 0, -22],
      wristl: [12, 0, 0],
      wristr: [12, 0, 0],
    },
  },
  thunder: {
    compress: 0.012,
    gather: {
      spine: [-5, -18, 4],
      chest: [-8, -12, 4],
      head: [0, 15, 0],
      upperarmr: [-22, -8, 15],
      lowerarmr: [0, -15, 12],
      upperarml: [10, 8, -7],
    },
    contact: {
      spine: [8, 17, -3],
      chest: [5, 12, -3],
      head: [-3, -10, 0],
      upperarmr: [12, 18, -20],
      lowerarmr: [-9, 12, -14],
      upperarml: [-6, -12, 12],
    },
  },
  tide: {
    compress: 0.009,
    gather: {
      spine: [-4, 0, 0],
      chest: [-5, 0, 0],
      head: [5, 0, 0],
      upperarml: [-8, 12, -13],
      upperarmr: [-8, -12, 13],
      wristl: [-8, 12, -8],
      wristr: [-8, -12, 8],
    },
    contact: {
      spine: [2, 0, 0],
      chest: [-3, 0, 0],
      head: [-5, 0, 0],
      upperarml: [10, -16, 19],
      upperarmr: [10, 16, -19],
      wristl: [-14, -15, 0],
      wristr: [-14, 15, 0],
    },
  },
  judgement: {
    compress: 0.012,
    gather: {
      spine: [-8, -8, 0],
      chest: [-6, -10, 0],
      head: [-5, 8, 0],
      upperarmr: [-18, 0, 10],
      lowerarmr: [8, 0, 8],
      upperarml: [-5, 0, -10],
    },
    contact: {
      spine: [9, 8, 0],
      chest: [7, 8, 0],
      head: [3, -6, 0],
      upperarmr: [16, 4, -14],
      lowerarmr: [-6, 0, -9],
      upperarml: [8, 0, 12],
    },
  },
  rift: {
    compress: 0.015,
    gather: {
      spine: [7, 0, 0],
      chest: [8, 0, 0],
      head: [9, 0, 0],
      upperarml: [8, 15, 15],
      upperarmr: [8, -15, -15],
      lowerarml: [-10, 0, -18],
      lowerarmr: [-10, 0, 18],
    },
    contact: {
      spine: [-9, 0, 0],
      chest: [-12, 0, 0],
      head: [-7, 0, 0],
      upperarml: [-15, -20, -25],
      upperarmr: [-15, 20, 25],
      wristl: [0, 18, -9],
      wristr: [0, -18, 9],
    },
  },
  execution: {
    compress: 0.025,
    gather: {
      spine: [-10, 13, -3],
      chest: [-8, 10, -3],
      head: [5, -8, 0],
      upperarmr: [-16, 0, 10],
      upperarml: [-12, 0, -8],
    },
    contact: {
      spine: [16, -12, 3],
      chest: [11, -8, 3],
      head: [4, 6, 0],
      upperarmr: [18, 0, -12],
      upperarml: [15, 0, 10],
    },
  },
  wolf: {
    compress: 0.014,
    gather: {
      spine: [9, 0, 0],
      chest: [6, 0, 0],
      head: [-5, 0, 0],
      upperarml: [8, 10, -10],
      upperarmr: [8, -10, 10],
    },
    contact: {
      spine: [-5, 0, 0],
      chest: [-7, 0, 0],
      head: [-8, 0, 0],
      upperarml: [-12, -8, 14],
      upperarmr: [-12, 8, -14],
    },
  },
};
const SOURCE_FAMILY: Readonly<Record<string, Signature>> = {
  Cast_Fire: 'pyre',
  Cast_Nova: 'glacier',
  Cast_Bolt: 'thunder',
  Cast_Heal: 'tide',
  Cast_Verdict: 'judgement',
  Warlock_Cast_Shadow: 'rift',
  '2H_Melee_Attack_Chop': 'execution',
};
const GATHER = [0, 0.5, 1, 0, 0, -0.12, 0, 0];
const CONTACT = [0, 0, 0, 1, 1, 0.7, 0.25, 0];

export function poseSignatureTracks(
  tracks: THREE.KeyframeTrack[],
  source: THREE.AnimationClip,
  id: string,
  hold: boolean,
): void {
  const signature = SIGNATURE_ABILITIES[id] ?? SOURCE_FAMILY[source.name];
  if (
    !signature ||
    !source.tracks.some((t) => t.name === 'hips.quaternion') ||
    !source.tracks.some((t) => t.name === 'chest.quaternion')
  )
    return;
  const pose = POSES[signature];
  const q = new THREE.Quaternion(),
    rotation = new THREE.Quaternion(),
    previous = new THREE.Quaternion(),
    euler = new THREE.Euler();
  for (const track of tracks) {
    const bone = track.name.slice(0, track.name.lastIndexOf('.'));
    if (track.name.endsWith('.quaternion')) {
      const gather = pose.gather[bone],
        contact = pose.contact[bone];
      if (!gather && !contact) continue;
      for (let key = 0; key < track.times.length; key++) {
        const g = hold ? [0, 0.45, 0.9, 1, 1][key] : GATHER[key],
          c = hold ? 0 : CONTACT[key];
        euler.set(
          ...([0, 1, 2].map((i) =>
            THREE.MathUtils.degToRad((gather?.[i] ?? 0) * g + (contact?.[i] ?? 0) * c),
          ) as [number, number, number]),
        );
        q.fromArray(track.values, key * 4)
          .normalize()
          .multiply(rotation.setFromEuler(euler))
          .normalize();
        if (key && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        q.toArray(track.values, key * 4);
        previous.copy(q);
      }
    } else if (track.name === 'root.position') {
      for (let key = 1; key < track.times.length; key++)
        for (let axis = 0; axis < 3; axis++) track.values[key * 3 + axis] = track.values[axis];
    } else if (track.name === 'hips.position') {
      for (let key = 0; key < track.times.length; key++) {
        const weight = hold ? [0, 0.45, 0.9, 1, 1][key] : Math.max(GATHER[key], CONTACT[key] * 0.7);
        track.values[key * 3 + 1] -= pose.compress * weight;
      }
    }
  }
}
