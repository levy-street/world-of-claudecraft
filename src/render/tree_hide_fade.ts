// The world trees' camera-occluder fade, lifted out of foliage.ts: the
// hideable records, the eye-to-camera hit test against a tree's trunk circle,
// the per-frame swap between instances and pooled ghost stand-ins through the
// gated fade (occluder_fade_gate.ts), and the ghost sources the boot prewarm
// covers.
import type * as THREE from 'three';
import type { InstancedGhostHandle, InstancedOccluderGhosts } from './instanced_occluder_ghosts';
import {
  OCCLUDER_FADE_PREFETCH_YD,
  occluderFadeSettled,
  occluderKeepsInstances,
  stepOccluderFade,
  withinOccluderFadePrefetch,
} from './occluder_fade_core';
import { TreeHideIndex } from './tree_hide_index_core';

export interface TreeHidePart {
  mesh: THREE.InstancedMesh;
  index: number;
  visibleMatrix: THREE.Matrix4;
  hiddenMatrix: THREE.Matrix4;
}

export interface TreeHideable {
  x: number;
  z: number;
  r: number;
  topY: number;
  /** Ghosted (the fade applied), NOT "occluding": a tree that occludes the
   *  camera while its fade program is still gate-held reads false. */
  hidden: boolean;
  /** Animated fade level (1 = opaque instance, 0.2 = occluding ghost). */
  alpha: number;
  /** Live ghost stand-ins while the fade is active (empty = instanced). */
  ghosts: InstancedGhostHandle[];
  parts: TreeHidePart[];
  /** The ghost programs were asked for ahead of the first occlusion. */
  prefetched: boolean;
}

function pointInsideTree(t: TreeHideable, x: number, z: number): boolean {
  const dx = x - t.x,
    dz = z - t.z;
  return dx * dx + dz * dz < t.r * t.r;
}

function segmentCircleEntry(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  const dx = bx - ax,
    dz = bz - az;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return Infinity;
  const fx = ax - cx,
    fz = az - cz;
  const c0 = fx * fx + fz * fz - r * r;
  if (c0 < 0) return 0;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c0;
  if (disc < 0) return Infinity;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

export function cameraSegmentHitsTree(
  t: TreeHideable,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (
    (eyeY < t.topY && pointInsideTree(t, eyeX, eyeZ)) ||
    (camY < t.topY && pointInsideTree(t, camX, camZ))
  ) {
    return true;
  }
  const hitT = segmentCircleEntry(eyeX, eyeZ, camX, camZ, t.x, t.z, t.r);
  if (hitT < 0 || hitT > 1) return false;
  return eyeY + (camY - eyeY) * hitT < t.topY;
}

/** Every InstancedMesh a hideable tree can ghost, repeats included: the ghost
 *  pool clones per SOURCE mesh, so this is the set its programs come from. */
export function* hideableGhostSources(
  trees: readonly TreeHideable[],
): Generator<THREE.InstancedMesh> {
  for (const t of trees) for (const part of t.parts) yield part.mesh;
}

/** One tree, one frame: the swap between instances and pooled ghost stand-ins
 *  through the gated fade, given whether the eye-to-camera segment crosses it.
 *  Returns whether the tree's fade is in flight after this frame (it holds
 *  ghosts), which is what the index keeps it on the active list for. */
export function stepTreeHide(
  t: TreeHideable,
  ghosts: InstancedOccluderGhosts,
  hide: boolean,
  dt: number,
  reducedMotion: boolean,
): boolean {
  if (occluderKeepsInstances(hide, t.ghosts.length > 0, ghosts, t.parts)) {
    t.hidden = false;
    t.alpha = 1;
    return false;
  }
  t.hidden = hide;
  if (t.ghosts.length === 0) {
    for (let j = 0; j < t.parts.length; j++) {
      const part = t.parts[j];
      part.mesh.setMatrixAt(part.index, part.hiddenMatrix);
      part.mesh.instanceMatrix.addUpdateRange(part.index * 16, 16);
      part.mesh.instanceMatrix.needsUpdate = true;
      t.ghosts.push(ghosts.acquire(part.mesh, part.index, part.visibleMatrix));
    }
  }
  t.alpha = stepOccluderFade(t.alpha, hide, dt, reducedMotion);
  for (let j = 0; j < t.ghosts.length; j++) ghosts.setAlpha(t.ghosts[j], t.alpha);
  if (!hide && occluderFadeSettled(t.alpha, false)) {
    for (let j = 0; j < t.parts.length; j++) {
      const part = t.parts[j];
      part.mesh.setMatrixAt(part.index, part.visibleMatrix);
      part.mesh.instanceMatrix.addUpdateRange(part.index * 16, 16);
      part.mesh.instanceMatrix.needsUpdate = true;
    }
    for (let j = 0; j < t.ghosts.length; j++) ghosts.release(t.ghosts[j]);
    t.ghosts.length = 0;
  }
  return t.ghosts.length > 0;
}

// One index per hideable registry (the array identity), rebuilt when the
// registry grew: buildTrees only ever appends to it.
const indexes = new WeakMap<TreeHideable[], TreeHideIndex>();

function indexFor(trees: TreeHideable[]): TreeHideIndex {
  let index = indexes.get(trees);
  if (!index || index.count !== trees.length) {
    index = new TreeHideIndex(trees, undefined, index?.active ?? []);
    indexes.set(trees, index);
  }
  return index;
}

export function updateTreeHides(
  trees: TreeHideable[],
  ghosts: InstancedOccluderGhosts,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
  dt: number,
  reducedMotion: boolean,
): void {
  // The shipped field has 3k+ hideable trees; a frame looks at three sets of
  // them, each a handful: the cells under the eye-to-camera segment (the only
  // trees the segment can cross), the unlatched trees of the cells the
  // prefetch reach touches (only when the camera moved: a still camera brings
  // no tree into reach), and the trees whose fade is already in flight (a
  // ghosted tree keeps stepping toward its rest whether or not the segment
  // still crosses it). Every other tree is untouched, exactly as the linear
  // walk left it: opaque, unfaded, with nothing to update.
  const index = indexFor(trees);
  index.beginFrame();
  if (index.sweepDue(camX, camZ)) {
    index.forEachUnprefetchedWithin(camX, camZ, OCCLUDER_FADE_PREFETCH_YD, (i) => {
      const t = trees[i];
      if (t.prefetched || !withinOccluderFadePrefetch(t.x, t.z, camX, camZ)) return;
      t.prefetched = true;
      ghosts.prefetchAll(t.parts);
      index.notePrefetched(i);
    });
  }
  index.forEachNearSegment(eyeX, eyeZ, camX, camZ, (i) => {
    const t = trees[i];
    const hide = cameraSegmentHitsTree(t, eyeX, eyeY, eyeZ, camX, camY, camZ);
    if (stepTreeHide(t, ghosts, hide, dt, reducedMotion)) index.active.add(i);
    else index.active.delete(i);
  });
  for (const i of index.active) {
    if (index.visitedThisFrame(i)) continue;
    if (!stepTreeHide(trees[i], ghosts, false, dt, reducedMotion)) index.active.delete(i);
  }
}
