import type * as THREE from 'three';

// Hidden-rig matrix freeze. Under r165 a hidden entity view paid almost no
// matrix CPU: setting the group root's matrixWorldAutoUpdate=false pruned the
// whole subtree out of the scene's updateMatrixWorld walk. r185 recurses
// children UNCONDITIONALLY (Object3D.updateMatrixWorld only gates the node's
// OWN compose on the flag), so a hidden 30-60 node rig with default
// matrixAutoUpdate descendants re-dirtied and recomposed every child on every
// frame; the root gate saved one compose out of dozens.
//
// This module restores the r165-scale saving with flag work on TRANSITIONS
// only. On the hide transition it walks the subtree once, clearing
// matrixAutoUpdate and matrixWorldAutoUpdate and recording exactly the nodes
// it flipped (a descendant some other system already froze, the
// static_matrix flame idiom, keeps its own state). On the reveal transition it
// restores the recorded flags and forces one updateMatrixWorld(true): the
// entity loop keeps posing hidden rigs' transform PROPERTIES, so the reveal
// must recompose the current pose before anything reads a matrix. Steady
// state costs one WeakMap lookup per view per frame and allocates nothing.
//
// Contract (inherited from the r165 root gate this replaces): nothing may
// read a hidden view's matrixWorld. pick() skips hidden views, and the
// caller exempts light-owner groups (the light budget ranks by
// light.getWorldPosition, which does not heal through a frozen ancestor).
// Children ADDED while frozen keep their default flags; they compose against
// a stale parent world until the reveal's forced update heals the chain.

interface RigFreezeState {
  /** Nodes whose matrixAutoUpdate this module set to false. */
  localFrozen: THREE.Object3D[];
  /** Nodes whose matrixWorldAutoUpdate this module set to false. */
  worldFrozen: THREE.Object3D[];
}

// Keyed by the view group root. WeakMap so a view discarded while hidden
// (terminal teardown) cannot leak its state entry.
const frozenRigs = new WeakMap<THREE.Object3D, RigFreezeState>();

/** Is this group currently hide-frozen? Exposed for tests and diagnostics. */
export function isRigMatrixFrozen(group: THREE.Object3D): boolean {
  return frozenRigs.has(group);
}

function freezeSubtree(group: THREE.Object3D): void {
  const state: RigFreezeState = { localFrozen: [], worldFrozen: [] };
  group.traverse((node) => {
    if (node.matrixAutoUpdate) {
      node.matrixAutoUpdate = false;
      state.localFrozen.push(node);
    }
    if (node.matrixWorldAutoUpdate) {
      node.matrixWorldAutoUpdate = false;
      state.worldFrozen.push(node);
    }
  });
  frozenRigs.set(group, state);
}

function restoreFlags(group: THREE.Object3D, state: RigFreezeState): void {
  for (const node of state.localFrozen) node.matrixAutoUpdate = true;
  for (const node of state.worldFrozen) node.matrixWorldAutoUpdate = true;
  frozenRigs.delete(group);
}

/**
 * Per-frame visibility sync for one view group. `live` is "this subtree's
 * matrices must stay current": group.visible, or the caller's light-owner
 * exemption. Acts only on transitions; repeated same-state calls are no-ops.
 */
export function syncRigMatrixFreeze(group: THREE.Object3D, live: boolean): void {
  const state = frozenRigs.get(group);
  if (live) {
    if (state === undefined) return;
    restoreFlags(group, state);
    // Recompose the CURRENT pose immediately: consumers later this frame
    // (nameplate anchors, vfx hand reads) must never see the frozen matrices.
    // View groups are direct scene children, so the parent world is current.
    group.updateMatrixWorld(true);
    return;
  }
  if (state === undefined) freezeSubtree(group);
}

/**
 * Restore flags without the forced recompose, for a view torn down while
 * hidden: a pooled visual must not carry hide-frozen flags into its next
 * view (its restored matrixAutoUpdate self-heals on the next scene walk).
 */
export function unfreezeRigMatrices(group: THREE.Object3D): void {
  const state = frozenRigs.get(group);
  if (state !== undefined) restoreFlags(group, state);
}
