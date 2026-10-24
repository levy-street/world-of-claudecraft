import * as THREE from 'three';

/**
 * A Group whose per-frame world-matrix walk skips its HIDDEN children.
 *
 * three r185's Object3D.updateMatrixWorld recurses into every child whether
 * it is visible or not, and every auto-update node it reaches recomposes its
 * local matrix and re-multiplies its world matrix. A pool of parked effect
 * slots (sentence_vfx, needle_of_fate_vfx: ~700 nodes between them) and the
 * far, distance-hidden fire emitters under the placed assets were paying that
 * on every frame while drawing nothing, the renderer's projectObject already
 * skips an invisible object, so the walk was the only cost they still had.
 *
 * Contract: a hidden child's subtree matrices go STALE while it is hidden.
 * That is safe when nothing reads a hidden child's matrixWorld (true for the
 * pools and the fire groups: hidden means "not drawn", and picking targets
 * the placement proxies, which stay visible), and when its transforms are
 * re-posed by ordinary property writes, which its first visible walk composes
 * fresh because the nodes keep matrixAutoUpdate. A FROZEN child
 * (matrixAutoUpdate=false, static_matrix.ts) refreshes itself explicitly
 * whenever it moves, exactly as it must under the stock walk, so it is
 * unaffected. Should this group's OWN world matrix change while a child is
 * hidden, the child is marked dirty so its first visible walk re-multiplies
 * against the new parent instead of trusting a pre-move world matrix.
 */
export class VisibleChildrenGroup extends THREE.Group {
  updateMatrixWorld(force?: boolean): void {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) {
      const child = children[i];
      if (child.visible) child.updateMatrixWorld(force);
      else if (force) child.matrixWorldNeedsUpdate = true;
    }
  }
}
