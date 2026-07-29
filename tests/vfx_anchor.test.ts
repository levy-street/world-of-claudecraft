import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createVfxAnchor, type VfxAnchorPose } from '../src/render/vfx_anchor';

// The shared VFX world-anchor resolver (src/render/vfx_anchor.ts). The
// per-frame VFX paths (ribbons, shells, ground auras, windups, orbit bands, the
// sequencer transients) resolve anchors every frame, so the contract that
// matters here is: with a destination it writes into THAT vector and allocates
// nothing; without one it still hands back a fresh vector the caller may keep.

type Poses = Record<number, { x: number; y: number; z: number; height: number }>;

function anchorOver(poses: Poses) {
  let calls = 0;
  const resolver = createVfxAnchor((id: number, out: VfxAnchorPose) => {
    calls++;
    const pose = poses[id];
    if (!pose) return false;
    out.x = pose.x;
    out.y = pose.y;
    out.z = pose.z;
    out.height = pose.height;
    return true;
  });
  return { resolver, fills: () => calls };
}

describe('createVfxAnchor', () => {
  it('lifts the view position by the fraction of the displayed height', () => {
    const { resolver } = anchorOver({ 7: { x: 10, y: 4, z: -6, height: 2.5 } });
    const feet = resolver(7, 0);
    const chest = resolver(7, 0.58);
    const head = resolver(7, 1);
    expect(feet).not.toBeNull();
    expect([feet?.x, feet?.y, feet?.z]).toEqual([10, 4, -6]);
    expect(chest?.y).toBeCloseTo(4 + 2.5 * 0.58, 10);
    expect(head?.y).toBeCloseTo(6.5, 10);
    // the horizontal read never depends on the fraction
    expect(head?.x).toBe(10);
    expect(head?.z).toBe(-6);
  });

  it('reports a missing view as a null reading, with or without a destination', () => {
    const { resolver } = anchorOver({ 1: { x: 0, y: 0, z: 0, height: 2 } });
    const out = new THREE.Vector3(1, 2, 3);
    expect(resolver(99, 0.5)).toBeNull();
    expect(resolver(99, 0.5, out)).toBeNull();
    // a refused reading leaves the caller's scratch untouched, so a caller that
    // ignores the null cannot read a half-written point
    expect(out.toArray()).toEqual([1, 2, 3]);
  });

  it('writes into the caller destination and returns that same vector', () => {
    const { resolver } = anchorOver({ 3: { x: 1, y: 2, z: 3, height: 4 } });
    const out = new THREE.Vector3();
    const got = resolver(3, 0.5, out);
    expect(got).toBe(out);
    expect(out.toArray()).toEqual([1, 4, 3]);
  });

  it('allocates a fresh, independent vector when no destination is given', () => {
    const { resolver } = anchorOver({
      3: { x: 1, y: 0, z: 0, height: 2 },
      4: { x: 9, y: 0, z: 0, height: 2 },
    });
    const first = resolver(3, 1);
    const second = resolver(4, 1);
    // the historical contract every one-shot spawn path relies on: two readings
    // are two objects, so a spawner may retain the first
    expect(first).not.toBe(second);
    expect(first?.x).toBe(1);
    expect(second?.x).toBe(9);
  });

  it('reuses one pose record across resolves (the lookup never allocates)', () => {
    const seen = new Set<VfxAnchorPose>();
    const resolver = createVfxAnchor((_id, out) => {
      seen.add(out);
      out.x = 0;
      out.y = 0;
      out.z = 0;
      out.height = 1;
      return true;
    });
    const scratch = new THREE.Vector3();
    for (let i = 0; i < 32; i++) resolver(i, 0.5, scratch);
    expect(seen.size).toBe(1);
  });

  it('resolving into a scratch in a per-frame loop never allocates a vector', () => {
    const { resolver } = anchorOver({ 5: { x: 2, y: 3, z: 4, height: 2 } });
    const scratch = new THREE.Vector3();
    const results = new Set<THREE.Vector3>();
    for (let frame = 0; frame < 240; frame++) {
      const at = resolver(5, frame / 240);
      // the destination-less arm is what the old code did every frame
      if (at) results.add(at);
    }
    expect(results.size).toBe(240);
    results.clear();
    for (let frame = 0; frame < 240; frame++) {
      const at = resolver(5, frame / 240, scratch);
      if (at) results.add(at);
    }
    expect(results.size).toBe(1);
  });
});
