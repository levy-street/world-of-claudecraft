import type * as THREE from 'three';

// Static-matrix freeze. Three recomposes every Object3D's local matrix and
// re-multiplies its world matrix EVERY frame while matrixAutoUpdate is true (the
// default); on this scene that is thousands of never-moving prop/terrain nodes
// paying real per-frame CPU (updateMatrixWorld + multiplyMatrices dominate the
// walk profile). Freezing a fully-built static subtree computes its world
// matrices once and stops the per-frame churn. Children ADDED to a frozen
// parent later keep their default auto-update and compose against the parent's
// (already final) matrixWorld, so lazily-streamed content under a frozen root
// still behaves normally.
//
// r185 semantics shift: updateMatrixWorld/updateWorldMatrix now gate the
// node's OWN compose on matrixWorldAutoUpdate (r165 used the flag only to
// skip child recursion and the renderer's per-pass camera refresh), and the
// child walk recurses unconditionally. Frozen nodes still skip both compose
// and multiply, but the branch-skip traversal saving is gone upstream, and an
// explicit refresh of a frozen node must go through
// refreshFrozenWorldMatrix below (a plain updateMatrixWorld() call no longer
// composes it, it only clears the dirty bit).
//
// Contract for callers: only freeze a subtree whose node TRANSFORMS never
// change after build (visibility toggles, uniform animation, and attribute
// rewrites are all fine; they do not touch the matrix). Any transform-animated
// descendant (campfire flames) must be re-enabled by the caller right after
// the freeze: `node.matrixAutoUpdate = true`.
export function freezeStaticMatrices(root: THREE.Object3D): void {
  // r185: updateMatrixWorld's force bypasses only the dirty check, never the
  // matrixWorldAutoUpdate gate, so a RE-freeze of a root that was previously
  // subtree-frozen would silently skip the root's own compose. Bake with the
  // flag held true and restore it (this deliberately does not heal a NESTED
  // subtree-frozen descendant; no caller nests subtree freezes today, and
  // the traverse below warns if one ever does).
  const worldAuto = root.matrixWorldAutoUpdate;
  root.matrixWorldAutoUpdate = true;
  root.updateMatrixWorld(true);
  root.matrixWorldAutoUpdate = worldAuto;
  root.traverse((o) => {
    // No-nesting contract guard: inside a static prop subtree the only thing
    // that sets matrixWorldAutoUpdate=false is a subtree freeze, and the bake
    // above skipped that nested root's own compose, so everything under it may
    // now be composed against a stale world. One warn per nested root (only
    // the nested ROOT carries the flag); freezes run at build time, so this
    // stays off the frame path.
    if (o !== root && !o.matrixWorldAutoUpdate) {
      console.warn(
        'static_matrix: nested subtree freeze under a freeze root; its world compose was not healed',
        o.name || o.type,
      );
    }
    o.matrixAutoUpdate = false;
  });
}

/**
 * Freeze a subtree whose complete membership and transforms are final.
 *
 * matrixAutoUpdate=false avoids local recomposition. Under r165 the root
 * matrixWorldAutoUpdate=false additionally let the parent scene skip the
 * whole static branch; r185 recurses children unconditionally, so the flag
 * now only skips the root's own compose and the traversal saving is gone
 * upstream. Kept because it is still a correct, slightly stronger freeze.
 * Callers must not add transform-bearing descendants after it.
 */
export function freezeStaticSubtreeMatrices(root: THREE.Object3D): void {
  freezeStaticMatrices(root);
  root.matrixWorldAutoUpdate = false;
}

/**
 * Recompose a frozen (matrixWorldAutoUpdate=false) node's world matrix on
 * demand. r185 gates updateMatrixWorld's own compose on that flag, so a plain
 * updateMatrixWorld() call on a frozen node clears matrixWorldNeedsUpdate
 * WITHOUT composing (under r165 it composed; the flag only gated child
 * recursion and the renderer's per-pass camera refresh). Flipping the flag
 * around the stock walk restores the r165 explicit-refresh contract for the
 * frozen camera and any other manually refreshed frozen node.
 */
export function refreshFrozenWorldMatrix(object: THREE.Object3D): void {
  object.matrixWorldAutoUpdate = true;
  object.updateMatrixWorld();
  object.matrixWorldAutoUpdate = false;
}
