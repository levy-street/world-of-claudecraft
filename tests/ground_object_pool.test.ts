// Regression coverage for src/render/ground_object_pool.ts. THREE.Group/Mesh/
// Geometry construct and mutate fine under plain Node (see quest_objects.test.ts),
// so this exercises the real pool cycle without a WebGL context.
//
// The bug: Renderer.createView's generic ground-object branch nulled its own
// computed pool key on a pool MISS, before ever storing anything, so the pool
// never populated and every spawn rebuilt from scratch. Worse, because
// buildGroundQuestObject clones a per-itemId forever-cached template with
// `clone(true)` (sharing geometry/material BY REFERENCE, never marked via
// markSharedGeometry), a null pool key sent every removed view down
// Renderer.removeView's non-pooled disposal path, which disposes non-shared
// mesh geometry: that tore down the cached template's GPU buffer, corrupting
// every future object built from it.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  type PooledObjectView,
  storePooledObject,
  takeOrBuildGroundObject,
  takePooledObject,
} from '../src/render/ground_object_pool';
import { buildGroundQuestObject } from '../src/render/quest_objects';

const rendererSource = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

describe('takePooledObject / storePooledObject', () => {
  it('misses on an empty pool and returns null', () => {
    const pool = new Map<string, PooledObjectView[]>();
    expect(takePooledObject(pool, 'object:royal_seal')).toBeNull();
  });

  it('stores and recycles the exact same group reference', () => {
    const pool = new Map<string, PooledObjectView[]>();
    const built = buildGroundQuestObject('royal_seal', 1);
    storePooledObject(pool, 'object:royal_seal', built);
    expect(pool.get('object:royal_seal')).toHaveLength(1);

    const taken = takePooledObject(pool, 'object:royal_seal');
    expect(taken?.group).toBe(built.group);
    expect(taken?.height).toBe(built.height);
    // the bucket is drained, so a second take misses again
    expect(pool.get('object:royal_seal')).toHaveLength(0);
    expect(takePooledObject(pool, 'object:royal_seal')).toBeNull();
  });
});

describe('takeOrBuildGroundObject', () => {
  it('keeps the pool key on a MISS instead of nulling it', () => {
    const pool = new Map<string, PooledObjectView[]>();
    const key = 'object:royal_seal';
    const result = takeOrBuildGroundObject(pool, key, () => buildGroundQuestObject(key, 1));
    expect(result.reused).toBe(false);
    // This is the regression: the old code forced poolKey to null right here,
    // on every miss, so removeView could never return the build to the pool.
    expect(result.poolKey).toBe(key);
  });

  it('a pool-missed build returns to the pool and is reused by the next spawn', () => {
    const pool = new Map<string, PooledObjectView[]>();
    const key = 'object:royal_seal';
    const build = vi.fn(() => buildGroundQuestObject(key, 1));

    // Spawn 1: pool is empty, so this is a MISS.
    const first = takeOrBuildGroundObject(pool, key, build);
    expect(first.reused).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);

    // Despawn: mirrors Renderer.removeView, which only pools a view when its
    // stored objectPoolKey survived the miss (v.objectPoolKey is truthy).
    expect(first.poolKey).toBeTruthy();
    storePooledObject(pool, first.poolKey as string, first.object);
    expect(pool.get(key)).toHaveLength(1);

    // Spawn 2: same item id, pool now has one entry, so this is a HIT that
    // recycles spawn 1's group instead of paying for another clone.
    const second = takeOrBuildGroundObject(pool, key, build);
    expect(second.reused).toBe(true);
    expect(second.object.group).toBe(first.object.group);
    expect(build).toHaveBeenCalledTimes(1);
    expect(pool.get(key)).toHaveLength(0);
  });

  it('a null key (no reusable template) never calls takePooledObject and stays null throughout', () => {
    const pool = new Map<string, PooledObjectView[]>();
    const build = vi.fn(() => buildGroundQuestObject('royal_seal', 1));
    const result = takeOrBuildGroundObject(pool, null, build);
    expect(result.poolKey).toBeNull();
    expect(result.reused).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);
  });
});

describe('Renderer.createView object branch (source pin)', () => {
  it('routes the generic ground-object branch through takeOrBuildGroundObject and never re-nulls the key', () => {
    const objectBranch = rendererSource.slice(
      rendererSource.indexOf("} else if (e.kind === 'object') {"),
      rendererSource.indexOf(
        "} else if (e.kind === 'mob' && e.templateId === VALE_CUP_BALL_TEMPLATE) {",
      ),
    );
    expect(objectBranch).toContain(
      'const result = takeOrBuildGroundObject(this.objectPool, this.objectPoolKeyFor(e), () =>',
    );
    expect(objectBranch).toContain('objectPoolKey = result.poolKey;');
    // The regression itself: this branch must never null the key it just took.
    expect(objectBranch).not.toContain('objectPoolKey = null');
  });
});
