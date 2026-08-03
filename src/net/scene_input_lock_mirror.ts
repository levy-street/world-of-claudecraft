// Immediate mirror of the authoritative scene input lock on receipt. The
// SceneDirector still consumes the queued events on the animation frame; this
// tiny mirror closes the independent network input timer's pre-frame window.

import type { SimEvent } from '../sim/types';

export function sceneInputLockAfterEvent(
  locked: boolean,
  event: SimEvent,
  playerId: number,
): boolean {
  if (event.type === 'sceneSync') return event.state?.inputLocked ?? false;
  if (event.type !== 'scene') return locked;
  if (event.pid !== undefined && event.pid !== playerId) return locked;
  if (event.op.kind === 'inputLock') return event.op.on;
  if (event.op.kind === 'end') return false;
  return locked;
}

/** Immediate mirror of "a scene is active for the local player" on receipt,
 * same contract as the lock mirror above: the frame loop's zone-warmup gate
 * reads it so a fare teleport arriving in the same message as its scene
 * start can never race the event drain into the blocking loading screen. */
export function sceneActiveAfterEvent(active: boolean, event: SimEvent, playerId: number): boolean {
  if (event.type === 'sceneSync') return event.state !== null;
  if (event.type !== 'scene') return active;
  if (event.pid !== undefined && event.pid !== playerId) return active;
  if (event.op.kind === 'start') return true;
  if (event.op.kind === 'end') return false;
  return active;
}
