// Two small helpers the renderer coordinator uses, moved out of renderer.ts
// under the monolith ratchet: gathering a subtree's shadow casters, and a
// timer-backed pause for the staged boot and compile waits.

import type * as THREE from 'three';

/** Push every shadow-casting mesh under `root` into `into`. */
export function collectCasters(root: THREE.Object3D, into: THREE.Object3D[]): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) into.push(o);
  });
}

/** Resolve after `ms` milliseconds (never negative). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}
