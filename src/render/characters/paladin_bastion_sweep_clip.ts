import * as THREE from 'three';

export const PALADIN_BASTION_SWEEP_CLIP = 'Paladin_Bastion_Sweep';
export const PALADIN_BASTION_SWEEP_DURATION = 0.72;
export const PALADIN_BASTION_SWEEP_IMPACT_TIME = 0.32;
export const PALADIN_BASTION_SWEEP_TIMES = [
  0, 0.08, 0.16, 0.24, 0.32, 0.37, 0.48, 0.6, 0.72,
] as const;

const SOURCE_FRACTIONS = [0, 0.08, 0.18, 0.34, 0.52, 0.52, 0.68, 0.82, 0] as const;
type EulerDegrees = readonly [x: number, y: number, z: number];

// Additive local-space poses laid over KayKit's planted one-handed slice.
// The left arm owns the shield sweep while the right arm counters the weight.
const ROTATION_OFFSETS: Readonly<Record<string, readonly EulerDegrees[]>> = {
  hips: [
    [0, 0, 0],
    [-2, 14, 0],
    [-5, 28, -2],
    [0, 2, -2],
    [5, -36, -4],
    [5, -36, -4],
    [7, -44, -6],
    [3, -18, -3],
    [0, 0, 0],
  ],
  spine: [
    [0, 0, 0],
    [-5, 18, -3],
    [-9, 34, -6],
    [-2, 3, -7],
    [9, -43, -10],
    [9, -43, -10],
    [11, -52, -13],
    [5, -21, -7],
    [0, 0, 0],
  ],
  chest: [
    [0, 0, 0],
    [-3, 12, -3],
    [-6, 25, -6],
    [-1, 2, -8],
    [7, -35, -12],
    [7, -35, -12],
    [9, -43, -15],
    [4, -17, -8],
    [0, 0, 0],
  ],
  head: [
    [0, 0, 0],
    [2, -10, 2],
    [5, -21, 4],
    [2, -3, 3],
    [-4, 25, 5],
    [-4, 25, 5],
    [-5, 31, 7],
    [-2, 12, 3],
    [0, 0, 0],
  ],
  upperarml: [
    [0, 0, 0],
    [-8, 18, -12],
    [-19, 39, -29],
    [-4, 7, -8],
    [31, -45, 65],
    [31, -45, 65],
    [36, -60, 79],
    [15, -24, 34],
    [0, 0, 0],
  ],
  lowerarml: [
    [0, 0, 0],
    [-3, 5, -15],
    [-8, 12, -34],
    [-2, 3, -9],
    [10, -17, 36],
    [10, -17, 36],
    [13, -23, 49],
    [5, -9, 20],
    [0, 0, 0],
  ],
  upperarmr: [
    [0, 0, 0],
    [4, -12, 17],
    [9, -24, 33],
    [2, -4, 9],
    [-11, 25, -27],
    [-11, 25, -27],
    [-15, 34, -38],
    [-6, 14, -16],
    [0, 0, 0],
  ],
  lowerarmr: [
    [0, 0, 0],
    [0, -4, 8],
    [0, -9, 17],
    [0, -2, 4],
    [0, 11, -16],
    [0, 11, -16],
    [0, 15, -23],
    [0, 6, -9],
    [0, 0, 0],
  ],
  upperlegl: [
    [0, 0, 0],
    [5, 2, -1],
    [10, 5, -2],
    [7, 2, -1],
    [14, -5, 3],
    [14, -5, 3],
    [11, -7, 4],
    [5, -3, 2],
    [0, 0, 0],
  ],
  lowerlegl: [
    [0, 0, 0],
    [5, 0, 0],
    [10, 0, 0],
    [8, 0, 0],
    [15, 0, 0],
    [15, 0, 0],
    [12, 0, 0],
    [5, 0, 0],
    [0, 0, 0],
  ],
  upperlegr: [
    [0, 0, 0],
    [4, -2, 1],
    [8, -5, 2],
    [5, -2, 1],
    [-8, 5, -2],
    [-8, 5, -2],
    [-6, 7, -3],
    [-3, 3, -1],
    [0, 0, 0],
  ],
  lowerlegr: [
    [0, 0, 0],
    [4, 0, 0],
    [8, 0, 0],
    [5, 0, 0],
    [3, 0, 0],
    [3, 0, 0],
    [2, 0, 0],
    [1, 0, 0],
    [0, 0, 0],
  ],
};

const HIPS_POSITION_OFFSETS = [
  [0, 0, 0],
  [0, -0.008, -0.005],
  [0, -0.018, -0.012],
  [0, -0.012, 0.006],
  [0, -0.016, 0.032],
  [0, -0.016, 0.032],
  [0, -0.009, 0.02],
  [0, -0.004, 0.008],
  [0, 0, 0],
] as const;

function sampledValues(track: THREE.KeyframeTrack, source: THREE.AnimationClip): number[] {
  const valueSize = track.getValueSize();
  const interpolant = track.createInterpolant();
  const values: number[] = [];
  for (const fraction of SOURCE_FRACTIONS) {
    const sample = interpolant.evaluate(source.duration * fraction);
    for (let component = 0; component < valueSize; component++) values.push(sample[component]);
  }
  return values;
}

function quaternionValues(
  track: THREE.KeyframeTrack,
  source: THREE.AnimationClip,
  bone: string,
): number[] {
  const values = sampledValues(track, source);
  const offsets = ROTATION_OFFSETS[bone];
  if (!offsets) return values;
  const base = new THREE.Quaternion();
  const offset = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'XYZ');
  const previous = new THREE.Quaternion();
  for (let key = 0; key < PALADIN_BASTION_SWEEP_TIMES.length; key++) {
    const valueOffset = key * 4;
    base.fromArray(values, valueOffset).normalize();
    const degrees = offsets[key];
    euler.set(
      THREE.MathUtils.degToRad(degrees[0]),
      THREE.MathUtils.degToRad(degrees[1]),
      THREE.MathUtils.degToRad(degrees[2]),
    );
    offset.setFromEuler(euler);
    base.multiply(offset).normalize();
    if (key > 0 && previous.dot(base) < 0) base.set(-base.x, -base.y, -base.z, -base.w);
    base.toArray(values, valueOffset);
    previous.copy(base);
  }
  return values;
}

function positionValues(
  track: THREE.KeyframeTrack,
  source: THREE.AnimationClip,
  bone: string,
): number[] {
  const values = sampledValues(track, source);
  if (bone === 'root') {
    for (let key = 1; key < PALADIN_BASTION_SWEEP_TIMES.length; key++) {
      values[key * 3] = values[0];
      values[key * 3 + 1] = values[1];
      values[key * 3 + 2] = values[2];
    }
  } else if (bone === 'hips') {
    for (let key = 0; key < PALADIN_BASTION_SWEEP_TIMES.length; key++) {
      const offset = HIPS_POSITION_OFFSETS[key];
      values[key * 3] += offset[0];
      values[key * 3 + 1] += offset[1];
      values[key * 3 + 2] += offset[2];
    }
  }
  return values;
}

/** Builds a separate KayKit-compatible shield-sweep clip without mutating its source. */
export function createPaladinBastionSweepClip(source: THREE.AnimationClip): THREE.AnimationClip {
  const sourceNames = new Set(source.tracks.map((track) => track.name));
  for (const bone of Object.keys(ROTATION_OFFSETS)) {
    if (!sourceNames.has(`${bone}.quaternion`)) {
      throw new Error(`Bastion Sweep base clip is missing ${bone}.quaternion`);
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (const sourceTrack of source.tracks) {
    if (sourceTrack.name.endsWith('.scale')) continue;
    if (sourceTrack.name.endsWith('.quaternion')) {
      const bone = sourceTrack.name.slice(0, -'.quaternion'.length);
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          sourceTrack.name,
          PALADIN_BASTION_SWEEP_TIMES,
          quaternionValues(sourceTrack, source, bone),
        ),
      );
    } else if (sourceTrack.name.endsWith('.position')) {
      const bone = sourceTrack.name.slice(0, -'.position'.length);
      tracks.push(
        new THREE.VectorKeyframeTrack(
          sourceTrack.name,
          PALADIN_BASTION_SWEEP_TIMES,
          positionValues(sourceTrack, source, bone),
        ),
      );
    }
  }
  return new THREE.AnimationClip(
    PALADIN_BASTION_SWEEP_CLIP,
    PALADIN_BASTION_SWEEP_DURATION,
    tracks,
  );
}
