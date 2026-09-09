import { describe, expect, it } from 'vitest';
import {
  attachShadowRangeGate,
  planStaticMergeShadow,
  type ShadowRangeGatedMesh,
  staticMergeAttributeSignature,
} from '../src/render/static_merge_shadow_core';

function fakeMesh(): ShadowRangeGatedMesh & { ranges: [number, number][] } {
  const ranges: [number, number][] = [];
  return {
    ranges,
    geometry: {
      setDrawRange(start: number, count: number): void {
        ranges.push([start, count]);
      },
    },
    onBeforeShadow: null,
    onAfterShadow: null,
  };
}

describe('planStaticMergeShadow', () => {
  it('orders casters first and reports their index prefix', () => {
    const plan = planStaticMergeShadow([
      { castShadow: false, indexCount: 6 },
      { castShadow: true, indexCount: 12 },
      { castShadow: false, indexCount: 3 },
      { castShadow: true, indexCount: 9 },
    ]);

    expect(plan.order).toEqual([1, 3, 0, 2]);
    expect(plan.casterIndexCount).toBe(21);
    expect(plan.castShadow).toBe(true);
    expect(plan.needsShadowRangeGate).toBe(true);
  });

  it('keeps source order and needs no gate when every part casts', () => {
    const plan = planStaticMergeShadow([
      { castShadow: true, indexCount: 6 },
      { castShadow: true, indexCount: 6 },
    ]);

    expect(plan.order).toEqual([0, 1]);
    expect(plan.casterIndexCount).toBe(12);
    expect(plan.castShadow).toBe(true);
    expect(plan.needsShadowRangeGate).toBe(false);
  });

  it('keeps source order and does not cast when no part casts', () => {
    const plan = planStaticMergeShadow([
      { castShadow: false, indexCount: 6 },
      { castShadow: false, indexCount: 4 },
    ]);

    expect(plan.order).toEqual([0, 1]);
    expect(plan.casterIndexCount).toBe(0);
    expect(plan.castShadow).toBe(false);
    expect(plan.needsShadowRangeGate).toBe(false);
  });

  it('answers an empty bucket without a gate', () => {
    const plan = planStaticMergeShadow([]);

    expect(plan.order).toEqual([]);
    expect(plan.casterIndexCount).toBe(0);
    expect(plan.castShadow).toBe(false);
    expect(plan.needsShadowRangeGate).toBe(false);
  });
});

describe('attachShadowRangeGate', () => {
  it('clips to the caster prefix for the shadow draw and restores the full range', () => {
    const mesh = fakeMesh();

    attachShadowRangeGate(mesh, 21);

    // Attaching must not clip anything: the colour pass of a frame whose
    // shadow pass never runs still draws the whole merged range.
    expect(mesh.ranges).toEqual([]);
    expect(mesh.shadowRangeIndexCount).toBe(21);

    (mesh.onBeforeShadow as () => void)();
    expect(mesh.ranges).toEqual([[0, 21]]);

    (mesh.onAfterShadow as () => void)();
    expect(mesh.ranges).toEqual([
      [0, 21],
      [0, Number.POSITIVE_INFINITY],
    ]);
  });

  it('restores the full range after every shadow draw of a multi-draw frame', () => {
    const mesh = fakeMesh();
    attachShadowRangeGate(mesh, 8);

    for (let draw = 0; draw < 3; draw++) {
      (mesh.onBeforeShadow as () => void)();
      (mesh.onAfterShadow as () => void)();
    }

    expect(mesh.ranges).toEqual([
      [0, 8],
      [0, Number.POSITIVE_INFINITY],
      [0, 8],
      [0, Number.POSITIVE_INFINITY],
      [0, 8],
      [0, Number.POSITIVE_INFINITY],
    ]);
  });
});

describe('staticMergeAttributeSignature', () => {
  it('is order-independent over the attribute names', () => {
    expect(staticMergeAttributeSignature({ attributes: { position: 1, normal: 1, uv: 1 } })).toBe(
      staticMergeAttributeSignature({ attributes: { uv: 1, position: 1, normal: 1 } }),
    );
  });

  it('separates geometries that do not carry the same attributes', () => {
    expect(staticMergeAttributeSignature({ attributes: { position: 1, normal: 1 } })).not.toBe(
      staticMergeAttributeSignature({ attributes: { position: 1, normal: 1, color: 1 } }),
    );
  });

  it('separates a morph-carrying geometry from a plain one', () => {
    expect(
      staticMergeAttributeSignature({
        attributes: { position: 1 },
        morphAttributes: { position: [1] },
      }),
    ).not.toBe(staticMergeAttributeSignature({ attributes: { position: 1 } }));
  });
});
