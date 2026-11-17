import * as THREE from 'three';

/** Stamped on a child the first time a walkHiddenOnce group walks it. */
const WALKED = Symbol('visibleChildrenGroupWalked');
type WalkStamped = THREE.Object3D & { [WALKED]?: true };

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
 *
 * `walkHiddenOnce` (the props root): a child is skipped only once it has been
 * walked at least once, so a child attached hidden (a far prop the cull hid
 * before the first render, a group a lazy build adds already culled) still
 * gets one walk, its world matrices composed exactly as the stock walk's first
 * frame would have composed them, and a reader of a hidden child's matrixWorld
 * never sees the identity a never-walked node carries. Off by default: the
 * pools park their slots from birth and refresh a slot themselves on reuse.
 */
export class VisibleChildrenGroup extends THREE.Group {
  private readonly walkHiddenOnce: boolean;

  constructor(opts?: { walkHiddenOnce?: boolean }) {
    super();
    this.walkHiddenOnce = opts?.walkHiddenOnce === true;
  }

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
      const child = children[i] as WalkStamped;
      if (child.visible) child.updateMatrixWorld(force);
      else if (this.walkHiddenOnce && child[WALKED] !== true) {
        child.updateMatrixWorld(force);
        child[WALKED] = true;
      } else if (force) child.matrixWorldNeedsUpdate = true;
    }
  }
}

/**
 * A Group whose per-frame world-matrix walk skips its WHOLE subtree while the
 * group itself is hidden: VisibleChildrenGroup one level up, for a root the
 * scene walks directly (the scene's own walk visits every child, hidden or
 * not).
 *
 * Built for the zone prewarm grids (zone_prewarm_groups.ts): a hidden grid of
 * creature rigs waits in the scene for the length of its background warm-up
 * (paced links, idle slots), and the walk recomposed every one of its nodes
 * on every frame, the largest share of the matrix pass a town frame paid on
 * the desktop phone proxy (1,653 of 9,700 visits, all recomposed). The warm
 * pass shows the group before it renders it, and that render's own walk
 * composes the grid fresh.
 *
 * Contract: while hidden, the subtree's matrices go stale and nothing may read
 * them (true for the prewarm grids: hidden means not drawn, never picked). A
 * forced walk (a moving ancestor, an explicit freeze) is honored as before.
 * Skipping marks the group dirty, so its first visible walk re-multiplies the
 * whole subtree against the current parent chain.
 */
export class HiddenSubtreeGroup extends THREE.Group {
  updateMatrixWorld(force?: boolean): void {
    if (!this.visible && !force) {
      this.matrixWorldNeedsUpdate = true;
      return;
    }
    super.updateMatrixWorld(force);
  }
}
