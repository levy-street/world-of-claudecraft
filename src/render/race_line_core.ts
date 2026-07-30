import { MOUNT_RACE_COURSE } from '../sim/content/mounts';

export type RaceGateMarkerState = 'cleared' | 'next' | 'pending';

const JUMP_ARC_RADIUS = 4.5;
const JUMP_ARC_HEIGHT = 2.8;

/** Vertical lift for the racing ribbon at one ground-plane point. Each jump
 *  gets a smooth parabolic arc that rises above the physical rail and returns
 *  to ground before the next fixture. */
export function jumpArcLiftAt(x: number, z: number): number {
  let lift = 0;
  for (const jump of MOUNT_RACE_COURSE.jumps) {
    const distance = Math.hypot(x - jump.x, z - jump.z);
    if (distance >= JUMP_ARC_RADIUS) continue;
    const t = distance / JUMP_ARC_RADIUS;
    lift = Math.max(lift, JUMP_ARC_HEIGHT * (1 - t * t));
  }
  return lift;
}

/** Presentation state for one gate marker. Cleared gates stay green; the first
 *  uncleared gate in course order is the active floating light. */
export function raceGateMarkerState(
  clearedMask: number,
  index: number,
  total: number,
): RaceGateMarkerState {
  const bit = 1 << index;
  if ((clearedMask & bit) !== 0) return 'cleared';
  for (let i = 0; i < Math.min(index, total); i++) {
    if ((clearedMask & (1 << i)) === 0) return 'pending';
  }
  return 'next';
}
