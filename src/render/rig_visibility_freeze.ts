import type * as THREE from 'three';

// Hidden-rig matrix freeze. Under r165 a hidden entity view paid almost no
// matrix CPU: setting the group root's matrixWorldAutoUpdate=false pruned the
// whole subtree out of the scene's updateMatrixWorld walk. r185 recurses
// children UNCONDITIONALLY (Object3D.updateMatrixWorld only gates the node's
// OWN compose on the flag), so a hidden 30-60 node rig with default
// matrixAutoUpdate descendants re-dirtied and recomposed every child on every
// frame; the root gate saved one compose out of dozens.
//
// This module restores the r165-scale saving with work on TRANSITIONS only.
// On the hide transition it walks the subtree once, clearing
// matrixAutoUpdate and matrixWorldAutoUpdate and recording exactly the nodes
// it flipped (a descendant some other system already froze, the
// static_matrix flame idiom, keeps its own state). It also prunes the root's
// ordinary matrix walk: flags alone still visit every frozen descendant.
// Explicit forced walks retain the original method and frozen-flag semantics.
// On reveal it restores the method and recorded flags, then forces one update:
// entity loop keeps posing hidden rigs' transform PROPERTIES, so the reveal
// must recompose the current pose before anything reads a matrix. Steady
// state costs one WeakMap lookup per view per frame and allocates nothing.
//
// Contract (inherited from the r165 root gate this replaces): nothing may
// read a hidden view's matrixWorld. pick() skips hidden views, and the
// caller exempts light-owner groups (the light budget ranks by
// light.getWorldPosition, which does not heal through a frozen ancestor).
// Children ADDED while frozen keep their default flags; the reveal's forced
// update composes them against the current parent chain before any draw.

interface RigFreezeState {
  /** Nodes whose matrixAutoUpdate this module set to false. */
  localFrozen: THREE.Object3D[];
  /** Nodes whose matrixWorldAutoUpdate this module set to false. */
  worldFrozen: THREE.Object3D[];
  updateMatrixWorld: THREE.Object3D['updateMatrixWorld'];
  updateDescriptor: PropertyDescriptor | undefined;
  pruned: boolean;
}

// Keyed by the view group root. WeakMap so a view discarded while hidden
// (terminal teardown) cannot leak its state entry.
const frozenRigs = new WeakMap<THREE.Object3D, RigFreezeState>();

function updateFrozenRig(this: THREE.Object3D, force?: boolean): void {
  // Force is also propagated by a moving ancestor. Honor that explicit walk
  // exactly as before; ordinary frames under the identity scene skip it.
  if (force) frozenRigs.get(this)?.updateMatrixWorld.call(this, force);
}

/** Is this group currently hide-frozen? Exposed for tests and diagnostics. */
export function isRigMatrixFrozen(group: THREE.Object3D): boolean {
  return frozenRigs.has(group);
}

function freezeSubtree(group: THREE.Object3D): void {
  const state: RigFreezeState = {
    localFrozen: [],
    worldFrozen: [],
    updateMatrixWorld: group.updateMatrixWorld,
    updateDescriptor: Object.getOwnPropertyDescriptor(group, 'updateMatrixWorld'),
    pruned: false,
  };
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
  // Preserve own methods/accessors and subclass prototypes on restore. An
  // immutable own method can keep the existing flag-only optimization.
  state.pruned = Reflect.defineProperty(group, 'updateMatrixWorld', {
    value: updateFrozenRig,
    configurable: state.updateDescriptor?.configurable ?? true,
    enumerable: state.updateDescriptor?.enumerable ?? false,
    writable: true,
  });
  frozenRigs.set(group, state);
}

function restoreFlags(group: THREE.Object3D, state: RigFreezeState): void {
  for (const node of state.localFrozen) node.matrixAutoUpdate = true;
  for (const node of state.worldFrozen) node.matrixWorldAutoUpdate = true;
  if (state.pruned) {
    if (state.updateDescriptor) {
      Object.defineProperty(group, 'updateMatrixWorld', state.updateDescriptor);
    } else {
      Reflect.deleteProperty(group, 'updateMatrixWorld');
    }
  }
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
