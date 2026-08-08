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
// and says so on the dev channel: a one-off link stall at reveal beats an
// invisible world.

import type * as THREE from 'three';

export const GATED_ATTACH_WATCHDOG_MS = 10_000;

export async function attachSceneGroupGated(
  scene: { add(object: THREE.Object3D): unknown },
  group: THREE.Object3D,
  compileGate?: (target: THREE.Object3D) => Promise<unknown>,
): Promise<void> {
  if (!compileGate) {
    scene.add(group);
    return;
  }
  group.visible = false;
  scene.add(group);
  const watchdog = setTimeout(() => {
    if (group.visible) return;
    group.visible = true;
    console.warn(
      `Gated scene attach never settled after ${GATED_ATTACH_WATCHDOG_MS}ms, revealed anyway`,
      group.name || group.type,
    );
  }, GATED_ATTACH_WATCHDOG_MS);
  try {
    await compileGate(group);
  } catch {
    // Shutdown rejects queued GPU work on purpose; reveal happens either way.
  } finally {
    clearTimeout(watchdog);
    group.visible = true;
  }
}
