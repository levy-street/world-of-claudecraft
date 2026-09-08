import * as THREE from 'three';
import { ABILITIES } from '../../sim/data';
import { CAST_PERFORMANCES, type CastPurpose, castClass } from './cast_performance';

type Joint = readonly [number, number, number];
type Pose = Readonly<Record<string, Joint>>;
interface Performance {
  gather: Pose;
  release: Pose;
}
// Z / X / Y degrees relative to the shipped KayKit joint rest frame.
// Feet and root translations remain native; no presentation-driven movement.
const POSES: Record<CastPurpose, Performance> = {
  brace: {
    gather: { chest: [0, 8, -6], upperarmr: [-10, -80, 0], lowerarmr: [90, 0, 0], upperarml: [25, -75, 0], lowerarml: [-85, 0, 0] },
    release: { chest: [0, -5, 6], upperarmr: [-18, -55, 0], lowerarmr: [110, 0, 0], upperarml: [35, -45, 0], lowerarml: [-100, 0, 0] },
  },
  smear: {
    gather: { upperarmr: [-25, -50, -25], lowerarmr: [110, 0, 0], chest: [0, 8, -18] },
    release: { upperarmr: [48, 12, 20], lowerarmr: [18, 0, 0], chest: [0, 13, 24] },
  },
  lowstrike: {
    gather: { upperarmr: [-20, -80, 0], lowerarmr: [90, 0, 0], chest: [0, 16, -20] },
    release: { upperarmr: [15, -100, 0], lowerarmr: [10, 0, 0], chest: [0, 28, 22] },
  },
  bolt: {
    gather: { upperarmr: [-30, -85, 0], lowerarmr: [105, 0, 0], chest: [0, -4, -18] },
    release: { upperarmr: [45, 8, 0], lowerarmr: [15, 0, 0], chest: [0, 7, 16] },
  },
  lance: {
    gather: {
      upperarmr: [-45, -105, 0],
      lowerarmr: [115, 0, 0],
      upperarml: [25, -55, 0],
      lowerarml: [-60, 0, 0],
      chest: [0, -8, -24],
    },
    release: {
      upperarmr: [60, 8, 0],
      lowerarmr: [8, 0, 0],
      upperarml: [-38, -10, 0],
      lowerarml: [-25, 0, 0],
      chest: [0, 12, 22],
    },
  },
  flick: {
    gather: { upperarmr: [15, -60, 0], lowerarmr: [95, 0, 0] },
    release: { upperarmr: [42, 0, 0], lowerarmr: [25, 0, 0], wristr: [0, -25, 10] },
  },
  call: {
    gather: { upperarmr: [8, 55, 0], lowerarmr: [75, 0, 0], head: [0, -10, 0], chest: [0, -6, 0] },
    release: { upperarmr: [55, -25, 0], lowerarmr: [12, 0, 0], chest: [0, 10, 8] },
  },
  place: {
    gather: {
      upperarml: [25, -80, 0],
      lowerarml: [-95, 0, 0],
      upperarmr: [-15, -60, 0],
      lowerarmr: [90, 0, 0],
    },
    release: { upperarmr: [-10, -132, 0], lowerarmr: [20, 0, 0], chest: [0, 16, 10] },
  },
  shape: {
    gather: {
      upperarmr: [-18, -60, 0],
      lowerarmr: [90, 0, -15],
      upperarml: [18, -60, 0],
      lowerarml: [-90, 0, 15],
    },
    release: {
      upperarmr: [35, -8, 0],
      lowerarmr: [38, 0, 0],
      upperarml: [-35, -8, 0],
      lowerarml: [-38, 0, 0],
      chest: [0, 6, 0],
    },
  },
  ward: {
    gather: {
      upperarml: [35, -70, 0],
      lowerarml: [-95, 0, 0],
      upperarmr: [-30, -75, 0],
      lowerarmr: [100, 0, 0],
      chest: [0, -4, 0],
    },
    release: {
      upperarml: [-40, 4, 0],
      lowerarml: [-48, 0, 0],
      upperarmr: [35, 5, 0],
      lowerarmr: [52, 0, 0],
      chest: [0, 5, 0],
    },
  },
  self: {
    gather: { upperarmr: [-20, -72, 0], lowerarmr: [125, 0, 0], head: [0, 9, 0] },
    release: {
      upperarmr: [-40, -20, 0],
      lowerarmr: [45, 0, 0],
      chest: [0, -7, 0],
      head: [0, -8, 0],
    },
  },
  offer: {
    gather: { upperarml: [22, -80, 0], lowerarml: [-115, 0, 0], head: [0, 7, 0] },
    release: { upperarml: [-32, -28, 0], lowerarml: [-55, 0, 0], chest: [0, 4, -5] },
  },
  embrace: {
    gather: {
      upperarmr: [-15, -75, 0],
      lowerarmr: [120, 0, 0],
      upperarml: [15, -75, 0],
      lowerarml: [-120, 0, 0],
      head: [0, 5, 0],
    },
    release: {
      upperarmr: [-65, -8, 0],
      lowerarmr: [30, 0, 0],
      upperarml: [65, -8, 0],
      lowerarml: [-30, 0, 0],
      chest: [0, -5, 0],
      head: [0, -7, 0],
    },
  },
  pray: {
    gather: {
      upperarmr: [-10, -75, 0],
      lowerarmr: [145, 0, 0],
      upperarml: [10, -75, 0],
      lowerarml: [-145, 0, 0],
      head: [0, 12, 0],
    },
    release: {
      upperarml: [-28, -15, 0],
      lowerarml: [-55, 0, 0],
      upperarmr: [-12, -70, 0],
      lowerarmr: [100, 0, 0],
      head: [0, -4, 0],
    },
  },
  mark: {
    gather: { upperarmr: [-12, -80, 0], lowerarmr: [135, 0, 0], chest: [0, 0, -8] },
    release: {
      upperarmr: [40, -4, 0],
      lowerarmr: [32, 0, 0],
      wristr: [0, 18, -10],
      chest: [0, 3, 6],
    },
  },
  mind: {
    gather: { upperarmr: [-8, 75, 0], lowerarmr: [145, 0, 0], head: [0, 8, -7] },
    release: {
      upperarmr: [20, 50, 0],
      lowerarmr: [85, 0, 0],
      upperarml: [-40, 5, 0],
      lowerarml: [-30, 0, 0],
      head: [0, 3, 7],
    },
  },
  hush: {
    gather: { upperarmr: [-8, 55, 0], lowerarmr: [145, 0, 0] },
    release: { upperarmr: [34, 15, 0], lowerarmr: [55, 0, 0], head: [0, -3, 0] },
  },
  drain: {
    gather: {
      upperarmr: [42, 2, 0],
      lowerarmr: [20, 0, 0],
      upperarml: [-38, 0, 0],
      lowerarml: [-30, 0, 0],
      chest: [0, 5, 0],
    },
    release: {
      upperarmr: [-18, -70, 0],
      lowerarmr: [130, 0, 0],
      upperarml: [18, -70, 0],
      lowerarml: [-130, 0, 0],
      chest: [0, -8, 0],
    },
  },
  raise: {
    gather: {
      upperarmr: [-35, -140, 0],
      lowerarmr: [35, 0, 0],
      upperarml: [35, -140, 0],
      lowerarml: [-35, 0, 0],
      chest: [0, 12, 0],
    },
    release: {
      upperarmr: [-45, 20, 0],
      lowerarmr: [90, 0, 0],
      upperarml: [45, 20, 0],
      lowerarml: [-90, 0, 0],
      chest: [0, -7, 0],
    },
  },
  command: {
    gather: { upperarmr: [-15, -72, 0], lowerarmr: [110, 0, 0], head: [0, -4, -10] },
    release: { upperarmr: [55, 0, 0], lowerarmr: [8, 0, 0], chest: [0, 3, 12] },
  },
  rend: {
    gather: {
      upperarmr: [45, 8, 0],
      lowerarmr: [30, 0, 0],
      upperarml: [-45, 8, 0],
      lowerarml: [-30, 0, 0],
      chest: [0, 8, 0],
    },
    release: {
      upperarmr: [-65, -50, 0],
      lowerarmr: [100, 0, 0],
      upperarml: [65, -50, 0],
      lowerarml: [-100, 0, 0],
      chest: [0, -10, 0],
    },
  },
  breath: {
    gather: {
      upperarmr: [-45, -100, 0],
      lowerarmr: [65, 0, 0],
      upperarml: [45, -100, 0],
      lowerarml: [-65, 0, 0],
      chest: [0, -15, 0],
      spine: [0, -8, 0],
      head: [0, -12, 0],
    },
    release: {
      upperarmr: [-50, -65, 0],
      lowerarmr: [35, 0, 0],
      upperarml: [50, -65, 0],
      lowerarml: [-35, 0, 0],
      chest: [0, 18, 0],
      spine: [0, 9, 0],
      head: [0, 12, 0],
    },
  },
  wave: {
    gather: { upperarmr: [-55, -65, 0], lowerarmr: [100, 0, 0], chest: [0, -3, -18] },
    release: { upperarmr: [65, -20, 0], lowerarmr: [20, 0, 0], chest: [0, 8, 22] },
  },
  cultivate: {
    gather: { upperarml: [20, -115, 0], lowerarml: [-75, 0, 0], head: [0, 8, 0] },
    release: {
      upperarml: [45, -5, 0],
      lowerarml: [-90, 0, 0],
      upperarmr: [-25, -55, 0],
      lowerarmr: [70, 0, 0],
      chest: [0, -4, 0],
    },
  },
  imbue: {
    gather: { upperarml: [15, -70, 0], lowerarml: [-100, 0, 0], head: [0, 8, -10] },
    release: { upperarml: [-10, -90, 0], lowerarml: [-35, 0, 0], chest: [0, 5, -12] },
  },
};
const REWORK = new Set([
  'dragons_breath',
  'moonseed',
  'moonlash',
  'sunlance',
  'holy_light',
  'renew',
  'rejuvenation',
  'healing_touch',
  'regrowth',
  'drain_life',
]);
const RELEASE_TIMES = [0, 0.045, 0.1, 0.15, 0.19, 0.32, 0.48, 0.68];
const HOLD_TIMES = [0, 0.2, 0.46, 0.72, 1.1];

/** Preparation-time native tracks, reused by every instance of this visual key.
 * Success events own releases; an interrupted hold never plays a release tail. */
export function prepareCasterClips(
  key: string,
  clips: Map<string, THREE.AnimationClip>,
  rig: THREE.Object3D,
): void {
  const cls = castClass(key),
    idle = clips.get('Idle');
  if ((!cls && key !== 'player_mech') || !idle || !rig.getObjectByName('chest')) return;
  for (const [id, purpose] of Object.entries(CAST_PERFORMANCES)) {
    const def = ABILITIES[id];
    if (!def || def.passive || (key !== 'player_mech' && def.class !== cls)) continue;
    const bearing = def.class;
    const performance = POSES[purpose];
    // Preserve already authored successful releases except confirmed purpose mismatches.
    if (!clips.has('Signature_' + id) || REWORK.has(id))
      clips.set(
        'Signature_' + id,
        makeClip('Signature_' + id, performance, bearing, idle, rig, 'release'),
      );
    if (def.channel)
      clips.set(
        'Signature_Channel_' + id,
        makeClip('Signature_Channel_' + id, performance, bearing, idle, rig, 'channel'),
      );
    else if (def.castTime > 0)
      clips.set(
        'Signature_Hold_' + id,
        makeClip('Signature_Hold_' + id, performance, bearing, idle, rig, 'hold'),
      );
  }
}
function makeClip(
  name: string,
  p: Performance,
  cls: string,
  idle: THREE.AnimationClip,
  rig: THREE.Object3D,
  mode: 'release' | 'hold' | 'channel',
): THREE.AnimationClip {
  const times =
    mode === 'release' ? RELEASE_TIMES : mode === 'hold' ? HOLD_TIMES : [0, 0.4, 0.8, 1.2, 1.6];
  const tracks = idle.tracks.map((t) => {
    const c = t.clone(),
      v = Array.from(t.createInterpolant().evaluate(0) as ArrayLike<number>);
    c.times = new Float32Array([0, times[times.length - 1]]);
    c.values = new Float32Array([...v, ...v]);
    return c;
  });
  for (const joint of new Set([...Object.keys(p.gather), ...Object.keys(p.release)])) {
    const bone = rig.getObjectByName(joint);
    if (!bone) continue;
    const original = idle.tracks.find((t) => t.name === joint + '.quaternion');
    const ready = original
      ? new THREE.Quaternion().fromArray(original.createInterpolant().evaluate(0))
      : bone.quaternion.clone();
    const pose = (spec: Pose) => {
      const a = [...(spec[joint] ?? [0, 0, 0])];
      // Different class bearing: measured priest, grounded shaman, predatory
      // warlock and broad wing/shoulder druid. This affects posture, not timing.
      if (joint === 'chest') {
        a[1] += cls === 'warlock' ? 5 : cls === 'priest' ? -3 : cls === 'shaman' ? 3 : 0;
        a[2] *= cls === 'priest' ? 0.45 : 1;
      }
      if (joint.startsWith('upperarm') && cls === 'druid') a[0] *= 1.18;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          (a[1] * Math.PI) / 180,
          (a[2] * Math.PI) / 180,
          (a[0] * Math.PI) / 180,
          'ZXY',
        ),
      );
      return bone.quaternion.clone().multiply(q).normalize();
    };
    const gather = pose(p.gather),
      release = pose(p.release);
    const frames =
      mode === 'release'
        ? [
            ready,
            ready.clone().slerp(gather, 0.6),
            gather,
            release,
            release,
            release.clone().slerp(ready, 0.2),
            release.clone().slerp(ready, 0.75),
            ready,
          ]
        : mode === 'hold'
          ? [ready, ready.clone().slerp(gather, 0.45), gather, gather, gather]
          : [
              gather,
              gather.clone().slerp(release, 0.1),
              gather,
              gather.clone().slerp(release, 0.055),
              gather,
            ];
    const track = new THREE.QuaternionKeyframeTrack(
      joint + '.quaternion',
      times,
      frames.flatMap((q) => q.toArray()),
    );
    const index = tracks.findIndex((t) => t.name === track.name);
    if (index < 0) tracks.push(track);
    else tracks[index] = track;
  }
  return new THREE.AnimationClip(name, times[times.length - 1], tracks);
}
