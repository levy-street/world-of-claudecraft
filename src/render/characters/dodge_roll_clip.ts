import * as THREE from 'three';
import { type DodgeVisualDirection, PLAYER_DODGE_ROLL_CLIPS } from '../dodge_visual_core';

export const PLAYER_DODGE_ROLL_DURATION = 0.75;
export const PLAYER_DODGE_ROLL_TIMES = [0, 0.1, 0.23, 0.39, 0.57, 0.75] as const;

const SOURCE_FRACTIONS = [0, 0.14, 0.32, 0.54, 0.78, 0] as const;
type EulerDegrees = readonly [x: number, y: number, z: number];

// Running_A supplies moving limbs and planted transitions. These local offsets
// turn its torso into a compact forward roll while the sim moves the actor.
const ROTATION_OFFSETS: Readonly<Record<string, readonly EulerDegrees[]>> = {
  hips: [
    [0, 0, 0],
    [-42, 0, 0],
    [-118, 0, 0],
    [-205, 0, 0],
    [-302, 0, 0],
    [-360, 0, 0],
  ],
  spine: [
    [0, 0, 0],
    [-18, 0, 0],
    [-32, 0, 0],
    [-28, 0, 0],
    [-12, 0, 0],
    [0, 0, 0],
  ],
  chest: [
    [0, 0, 0],
    [-16, 0, 0],
    [-27, 0, 0],
    [-24, 0, 0],
    [-10, 0, 0],
    [0, 0, 0],
  ],
  upperarml: [
    [0, 0, 0],
    [-28, 0, -18],
    [-48, 0, -32],
    [-44, 0, -28],
    [-18, 0, -10],
    [0, 0, 0],
  ],
  upperarmr: [
    [0, 0, 0],
    [-28, 0, 18],
    [-48, 0, 32],
    [-44, 0, 28],
    [-18, 0, 10],
    [0, 0, 0],
  ],
  lowerarml: [
    [0, 0, 0],
    [-35, 0, 0],
    [-62, 0, 0],
    [-56, 0, 0],
    [-22, 0, 0],
    [0, 0, 0],
  ],
  lowerarmr: [
    [0, 0, 0],
    [-35, 0, 0],
    [-62, 0, 0],
    [-56, 0, 0],
    [-22, 0, 0],
    [0, 0, 0],
  ],
  upperlegl: [
    [0, 0, 0],
    [30, 0, 0],
    [62, 0, 0],
    [68, 0, 0],
    [26, 0, 0],
    [0, 0, 0],
  ],
  upperlegr: [
    [0, 0, 0],
    [30, 0, 0],
    [62, 0, 0],
    [68, 0, 0],
    [26, 0, 0],
    [0, 0, 0],
  ],
  lowerlegl: [
    [0, 0, 0],
    [-38, 0, 0],
    [-76, 0, 0],
    [-72, 0, 0],
    [-28, 0, 0],
    [0, 0, 0],
  ],
  lowerlegr: [
    [0, 0, 0],
    [-38, 0, 0],
    [-76, 0, 0],
    [-72, 0, 0],
    [-28, 0, 0],
    [0, 0, 0],
  ],
};

const HIPS_Y_OFFSETS = [0, -0.035, -0.08, -0.085, -0.03, 0] as const;
const DIRECTION_YAW: Readonly<Record<DodgeVisualDirection, number>> = {
  forward: 0,
  back: Math.PI,
  left: -Math.PI / 2,
  right: Math.PI / 2,
};

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
  direction: DodgeVisualDirection,
): number[] {
  const values = sampledValues(track, source);
  const offsets = ROTATION_OFFSETS[bone];
  if (!offsets) return values;
  const base = new THREE.Quaternion();
  const offset = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'XYZ');
  const previous = new THREE.Quaternion();
  const directionYaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    DIRECTION_YAW[direction],
  );
  const inverseDirectionYaw = directionYaw.clone().invert();
  for (let key = 0; key < PLAYER_DODGE_ROLL_TIMES.length; key++) {
    const valueOffset = key * 4;
    base.fromArray(values, valueOffset).normalize();
    const degrees = offsets[key];
    euler.set(
      THREE.MathUtils.degToRad(degrees[0]),
      THREE.MathUtils.degToRad(degrees[1]),
      THREE.MathUtils.degToRad(degrees[2]),
    );
    offset.setFromEuler(euler);
    if (direction !== 'forward') {
      offset.premultiply(directionYaw).multiply(inverseDirectionYaw);
    }
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
    for (let key = 1; key < PLAYER_DODGE_ROLL_TIMES.length; key++) {
      values[key * 3] = values[0];
      values[key * 3 + 1] = values[1];
      values[key * 3 + 2] = values[2];
    }
  } else if (bone === 'hips') {
    for (let key = 0; key < PLAYER_DODGE_ROLL_TIMES.length; key++) {
      values[key * 3 + 1] += HIPS_Y_OFFSETS[key];
    }
  }
  return values;
}

/** Builds a KayKit-compatible forward roll without changing the source clip. */
export function createPlayerDodgeRollClip(
  source: THREE.AnimationClip,
  direction: DodgeVisualDirection = 'forward',
): THREE.AnimationClip {
  const sourceNames = new Set(source.tracks.map((track) => track.name));
  for (const bone of Object.keys(ROTATION_OFFSETS)) {
    if (!sourceNames.has(`${bone}.quaternion`)) {
      throw new Error(`Player dodge roll base clip is missing ${bone}.quaternion`);
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
          PLAYER_DODGE_ROLL_TIMES,
          quaternionValues(sourceTrack, source, bone, direction),
        ),
      );
    } else if (sourceTrack.name.endsWith('.position')) {
      const bone = sourceTrack.name.slice(0, -'.position'.length);
      tracks.push(
        new THREE.VectorKeyframeTrack(
          sourceTrack.name,
          PLAYER_DODGE_ROLL_TIMES,
          positionValues(sourceTrack, source, bone),
        ),
      );
    }
  }
  return new THREE.AnimationClip(
    PLAYER_DODGE_ROLL_CLIPS[direction],
    PLAYER_DODGE_ROLL_DURATION,
    tracks,
  );
}
