import type * as THREE from 'three';

// Static-matrix freeze. Three r165 recomposes every Object3D's local matrix and
// re-multiplies its world matrix EVERY frame while matrixAutoUpdate is true (the
// default); on this scene that is thousands of never-moving prop/terrain nodes
// paying real per-frame CPU (updateMatrixWorld + multiplyMatrices dominate the
// walk profile). Freezing a fully-built static subtree computes its world
// matrices once and stops the per-frame churn. Children ADDED to a frozen
// parent later keep their default auto-update and compose against the parent's
// (already final) matrixWorld, so lazily-streamed content under a frozen root
// still behaves normally.
//
// Contract for callers: only freeze a subtree whose node TRANSFORMS never
// change after build (visibility toggles, uniform animation, and attribute
// rewrites are all fine; they do not touch the matrix). Any transform-animated
// descendant (campfire flames) must be re-enabled by the caller right after
// the freeze: `node.matrixAutoUpdate = true`.
export function freezeStaticMatrices(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
  });
}
