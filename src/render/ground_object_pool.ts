import type * as THREE from 'three';

// Ground-object pool: Renderer.createView's generic ground-quest-object branch
// (the `e.kind === 'object'` arm past the bespoke door/rift/mailbox/noticeboard/
// delve cases) reuses a previously-removed group by item id instead of paying a
// full build on every spawn. Pulled out of the renderer coordinator so the
// miss-path decision, which is where a real bug lived, is unit-testable
// without a WebGL context: THREE.Group/Mesh/Geometry all construct and mutate
// fine in plain Node, only WebGLRenderer needs a live canvas.
//
// The invariant this module holds: `takeOrBuildGroundObject`'s `poolKey` is
// ALWAYS the key that was looked up, whether the pool hit or missed.
// Renderer.removeView only returns a view to the pool when its stored
// objectPoolKey is truthy; nulling the key on a miss sent every freshly-built
// object down removeView's non-pooled disposal path instead (see PR "stop
// ground-object pooling from nulling its own key on a fresh build"). That path
// disposes any non-shared mesh geometry on the view, but buildGroundQuestObject
// (quest_objects.ts) clones a per-itemId FOREVER-CACHED template with
// `clone(true)`, which shares geometry/material BY REFERENCE (never marked via
// markSharedGeometry): disposing it tore down the GPU buffer the cached
// template still points at, corrupting every future object built from it. This
// mirrors the character-visual pool's documented "Pool MISS: build a fresh
// visual but KEEP its pool key" pattern in Renderer.createView.

export interface PooledObjectView {
  group: THREE.Group;
  height: number;
}

export function takePooledObject(
  pool: Map<string, PooledObjectView[]>,
  key: string,
): PooledObjectView | null {
  const bucket = pool.get(key);
  const object = bucket?.pop() ?? null;
  if (!object) return null;
  object.group.removeFromParent();
  object.group.visible = true;
  object.group.position.set(0, 0, 0);
  object.group.rotation.set(0, 0, 0);
  object.group.scale.set(1, 1, 1);
  return object;
}

export function storePooledObject(
  pool: Map<string, PooledObjectView[]>,
  key: string,
  object: PooledObjectView,
): void {
  object.group.removeFromParent();
  object.group.visible = false;
  object.group.position.set(0, 0, 0);
  object.group.rotation.set(0, 0, 0);
  object.group.scale.set(1, 1, 1);
  let bucket = pool.get(key);
  if (!bucket) {
    bucket = [];
    pool.set(key, bucket);
  }
  bucket.push(object);
}

export interface GroundObjectPoolResult {
  object: PooledObjectView;
  poolKey: string | null;
  reused: boolean;
}

/**
 * Take a ground object from the pool on a hit, or build a fresh one via
 * `buildFresh` on a miss. Either way `poolKey` echoes the key that was looked
 * up, never nulled just because this particular call missed: that is what
 * lets a fresh build return to the pool the next time it is removed instead
 * of being disposed.
 */
export function takeOrBuildGroundObject(
  pool: Map<string, PooledObjectView[]>,
  key: string | null,
  buildFresh: () => PooledObjectView,
): GroundObjectPoolResult {
  const pooled = key ? takePooledObject(pool, key) : null;
  if (pooled) return { object: pooled, poolKey: key, reused: true };
  return { object: buildFresh(), poolKey: key, reused: false };
}
