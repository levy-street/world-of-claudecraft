import * as THREE from 'three';

/** The weapon arm's two absolute shoulder rotations for Valkyr's Calling. */
export interface ValkyrArmTargets {
  /** Thrust straight overhead, the weapon head to the sky. */
  overhead: THREE.Quaternion;
  /** Brought down hard in front, the weapon head into the ground. */
  strike: THREE.Quaternion;
}

// The KayKit Rig_Medium solve: overhead puts the hand above the shoulder at full
// reach, the strike puts it forward at hip height with the weapon head on the
// ground. The arm pose is an OVERRIDE toward these (the base under it is the jump
// loop in the air and the idle on landing, so an additive offset would land
// somewhere different on each).
const KAYKIT_ARM_TARGETS: ValkyrArmTargets = {
  overhead: new THREE.Quaternion().setFromEuler(new THREE.Euler(-3.32, -0.65, 2.41, 'XYZ')),
  strike: new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 1.2, 2.4, 'XYZ')),
};

const ARM_TRACK = 'upperarmr.quaternion';
/** The WOC library's arms-raised cast and heavy chop, and where in each the
 * weapon arm holds the overhead and the strike. */
const WOC_OVERHEAD = { clip: 'Cast_Raise', phase: 0.42 } as const;
const WOC_STRIKE = { clip: '2H_Chop', phase: 0.8 } as const;

function armPose(
  clips: ReadonlyMap<string, THREE.AnimationClip>,
  name: string,
  phase: number,
): THREE.Quaternion | null {
  const clip = clips.get(name);
  const track = clip?.tracks.find((t) => t.name === ARM_TRACK);
  if (!clip || !track) return null;
  return new THREE.Quaternion().fromArray(
    track.createInterpolant().evaluate(clip.duration * phase),
  );
}

/**
 * The Valkyr's Calling arm targets for a rig. The WOC body shares KayKit's bone
 * names but not its bind pose, so absolute rotations solved on one pose the
 * other wrong: a rig whose library carries the WOC raise and chop takes its
 * targets from those clips' own weapon-arm keys; any other rig keeps the KayKit
 * solve. Called once per Paladin visual at construction.
 */
export function valkyrArmTargetsFor(
  clips: ReadonlyMap<string, THREE.AnimationClip>,
): ValkyrArmTargets {
  const overhead = armPose(clips, WOC_OVERHEAD.clip, WOC_OVERHEAD.phase);
  const strike = armPose(clips, WOC_STRIKE.clip, WOC_STRIKE.phase);
  return overhead && strike ? { overhead, strike } : KAYKIT_ARM_TARGETS;
}
