// Attach a freshly built world group to the scene hidden until its shader
// programs are linked, then reveal it: the world-content twin of the entity
// view compile gate (gateViewOnCompile). A streamed group added visible links
// its programs synchronously at first draw (the zone-border stall); with a
// gate it pops in a frame or two late instead. Fail-soft on a rejected gate:
// the group always ends visible, matching the view gate's recovery arm.
//
// A gate that never settles is the one failure the promise chain cannot see,
// and here the blast radius is a whole interior or town staying invisible
// with no diagnostic. The watchdog below reveals anyway after a bounded wait
// and says so on the dev channel, plus a machine-readable gpu-prep event a
// capture can read back: a one-off link stall at reveal beats an invisible
// world.

import type * as THREE from 'three';
import { gpuPrepNow, recordGpuPrepEvent } from './gpu_prep_events';

export const GATED_ATTACH_WATCHDOG_MS = 10_000;

/** Raised when a streamed root is retired while its compile gate is pending. */
export class GatedSceneAttachCancelledError extends Error {
  constructor() {
    super('Gated scene attach cancelled');
    this.name = 'GatedSceneAttachCancelledError';
  }
}

export async function attachSceneGroupGated(
  scene: { add(object: THREE.Object3D): unknown },
  group: THREE.Object3D,
  compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  isCancelled?: () => boolean,
): Promise<void> {
  // The cancellation predicate is intentionally supplied by the resource
  // owner, rather than inferred from scene membership. A retired root may be
  // absent from the scene while its compile promise is still alive, and a
  // replacement build can legitimately use the same scene.
  if (isCancelled?.()) throw new GatedSceneAttachCancelledError();
  if (!compileGate) {
    scene.add(group);
    return;
  }
  group.visible = false;
  scene.add(group);
  const attachedAtMs = gpuPrepNow();
  const watchdog = setTimeout(() => {
    if (isCancelled?.()) return;
    if (group.visible) return;
    group.visible = true;
    console.warn(
      `Gated scene attach never settled after ${GATED_ATTACH_WATCHDOG_MS}ms, revealed anyway`,
      group.name || group.type,
    );
    recordGpuPrepEvent({
      kind: 'attach-watchdog',
      key: group.name || group.type,
      ageMs: gpuPrepNow() - attachedAtMs,
    });
  }, GATED_ATTACH_WATCHDOG_MS);
  try {
    await compileGate(group);
    if (isCancelled?.()) throw new GatedSceneAttachCancelledError();
  } catch {
    // Shutdown rejects queued GPU work on purpose; ordinary gate failures still
    // reveal. A retired streamed root is different: its transaction owns the
    // detach and terminal resource release, so preserve cancellation.
    if (isCancelled?.()) throw new GatedSceneAttachCancelledError();
  } finally {
    clearTimeout(watchdog);
    if (!isCancelled?.()) group.visible = true;
  }
}
