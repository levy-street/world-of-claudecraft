import * as THREE from 'three';

export const PALADIN_TEMPLARS_VERDICT_CLIP = 'Paladin_Templars_Verdict_1H';
export const PALADIN_TEMPLARS_VERDICT_DURATION = 0.8;
export const PALADIN_TEMPLARS_VERDICT_IMPACT_TIME = 0.4;
export const PALADIN_TEMPLARS_VERDICT_IMPACT_NORMALIZED =
  PALADIN_TEMPLARS_VERDICT_IMPACT_TIME / PALADIN_TEMPLARS_VERDICT_DURATION;

export const PALADIN_TEMPLARS_VERDICT_TIMES = [0, 0.1, 0.22, 0.31, 0.4, 0.47, 0.58, 0.8] as const;

const SOURCE_FRACTIONS = [0, 0.14, 0.28, 0.42, 0.56, 0.56, 0.72, 0] as const;
type EulerDegrees = readonly [x: number, y: number, z: number];

// Additive local-space poses layered over KayKit's strongest overhead clip.
// The source supplies planted feet and natural joint arcs; these offsets rebuild
// the silhouette around a one-handed Templar verdict with a free-hand channel.
const ROTATION_OFFSETS: Readonly<Record<string, readonly EulerDegrees[]>> = {
  hips: [
    [0, 0, 0],
    [-2, -20, 0],
    [-6, -34, -2],
    [5, -5, -2],
    [15, 28, -4],
    [15, 28, -4],
    [12, 36, -7],
    [0, 0, 0],
  ],
  spine: [
    [0, 0, 0],
    [-6, -22, -3],
    [-11, -38, -6],
    [5, 4, -7],
    [15, 31, -10],
    [15, 31, -10],
    [14, 38, -14],
    [0, 0, 0],
  ],
  chest: [
    [0, 0, 0],
    [-3, -12, -4],
    [-6, -20, -8],
    [5, 5, -10],
    [8, 21, -14],
    [8, 21, -14],
    [7, 27, -17],
    [0, 0, 0],
  ],
  head: [
    [0, 0, 0],
    [5, 26, 4],
    [9, 48, 8],
    [2, 12, 5],
    [-7, -28, 5],
    [-7, -28, 5],
    [-5, -32, 7],
    [0, 0, 0],
  ],
  upperarmr: [
    [0, 0, 0],
    [0, 0, 20],
    [0, 0, 35],
    [0, 0, 8],
    [0, 0, -25],
    [0, 0, -25],
    [0, 0, -35],
    [0, 0, 0],
  ],
  lowerarmr: [
    [0, 0, 0],
    [0, 0, 8],
    [0, 0, 15],
    [0, 0, 3],
    [0, 0, -15],
    [0, 0, -15],
    [0, 0, -22],
    [0, 0, 0],
  ],
  upperarml: [
    [0, 0, 0],
    [-14, 10, -14],
    [-29, 22, -28],
    [-8, 5, -5],
    [23, -18, 48],
    [23, -18, 48],
    [28, -24, 57],
    [0, 0, 0],
  ],
  lowerarml: [
    [0, 0, 0],
    [0, 0, -18],
    [0, 0, -38],
    [0, 0, -8],
    [0, 0, 28],
    [0, 0, 28],
    [0, 0, 37],
    [0, 0, 0],
  ],
  upperlegr: [
    [0, 0, 0],
    [7, -4, 1],
    [12, -7, 2],
    [5, -2, 1],
    [-7, 5, -2],
    [-7, 5, -2],
    [-5, 7, -3],
    [0, 0, 0],
  ],
  lowerlegr: [
    [0, 0, 0],
    [-5, 0, 0],
    [-9, 0, 0],
    [-3, 0, 0],
    [3, 0, 0],
    [3, 0, 0],
    [2, 0, 0],
    [0, 0, 0],
  ],
  upperlegl: [
    [0, 0, 0],
    [-5, 3, -1],
    [-9, 5, -2],
    [4, -2, 1],
    [15, -7, 3],
    [15, -7, 3],
    [12, -9, 4],
    [0, 0, 0],
  ],
  lowerlegl: [
    [0, 0, 0],
    [6, 0, 0],
    [11, 0, 0],
    [8, 0, 0],
    [18, 0, 0],
    [18, 0, 0],
    [14, 0, 0],
    [0, 0, 0],
  ],
};

const REQUIRED_QUATERNION_BONES = Object.keys(ROTATION_OFFSETS);
const HIPS_POSITION_OFFSETS = [
  [0, 0, 0],
  [0, -0.012, -0.008],
  [0, -0.024, -0.018],
  [0, -0.01, 0.014],
  [0, -0.016, 0.038],
  [0, -0.016, 0.038],
  [0, -0.006, 0.02],
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
  for (let key = 0; key < PALADIN_TEMPLARS_VERDICT_TIMES.length; key++) {
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
    for (let key = 1; key < PALADIN_TEMPLARS_VERDICT_TIMES.length; key++) {
      values[key * 3] = values[0];
      values[key * 3 + 1] = values[1];
      values[key * 3 + 2] = values[2];
    }
  } else if (bone === 'hips') {
    for (let key = 0; key < PALADIN_TEMPLARS_VERDICT_TIMES.length; key++) {
      const offset = HIPS_POSITION_OFFSETS[key];
      values[key * 3] += offset[0];
      values[key * 3 + 1] += offset[1];
      values[key * 3 + 2] += offset[2];
    }
  }
  return values;
}

/**
 * Builds a separate KayKit-compatible clip without mutating the source.
 * Impact is authored at 0.40 s (normalized 0.5) and held through 0.47 s.
 */
export function createPaladinTemplarsVerdictClip(source: THREE.AnimationClip): THREE.AnimationClip {
  const sourceNames = new Set(source.tracks.map((track) => track.name));
  for (const bone of REQUIRED_QUATERNION_BONES) {
    if (!sourceNames.has(`${bone}.quaternion`)) {
      throw new Error(`Templar Verdict base clip is missing ${bone}.quaternion`);
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
          PALADIN_TEMPLARS_VERDICT_TIMES,
          quaternionValues(sourceTrack, source, bone),
        ),
      );
    } else if (sourceTrack.name.endsWith('.position')) {
      const bone = sourceTrack.name.slice(0, -'.position'.length);
      tracks.push(
        new THREE.VectorKeyframeTrack(
          sourceTrack.name,
          PALADIN_TEMPLARS_VERDICT_TIMES,
          positionValues(sourceTrack, source, bone),
        ),
      );
    }
  }
  return new THREE.AnimationClip(
    PALADIN_TEMPLARS_VERDICT_CLIP,
    PALADIN_TEMPLARS_VERDICT_DURATION,
    tracks,
  );
}
