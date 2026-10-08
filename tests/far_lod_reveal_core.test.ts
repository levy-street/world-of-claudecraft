// The far-LOD reveal rule (src/render/characters/far_lod_reveal_core.ts): the
// baked far mesh may only stand in for the articulated rig once it exists AND
// its freshly minted materials have linked behind the compile gate; the far
// shadow proxy follows the same readiness but the renderer's own shadow plan, a WOC
// body's stand-in casts for exactly as long as that proxy cannot, and a body still
// waiting for its head draws none of them.
import { describe, expect, it } from 'vitest';
import {
  bodyDrawn,
  farLodReady,
  farMeshShown,
  shadowProxyShown,
  shadowStandInShown,
} from '../src/render/characters/far_lod_reveal_core';

describe('farLodReady', () => {
  it('needs a mesh whose materials are no longer linking', () => {
    expect(farLodReady(true, false)).toBe(true);
    expect(farLodReady(true, true)).toBe(false);
    expect(farLodReady(false, false)).toBe(false);
    expect(farLodReady(false, true)).toBe(false);
  });
});

describe('farMeshShown', () => {
  it('shows the far mesh only when the LOD wants it AND it is ready', () => {
    expect(farMeshShown(true, true, false)).toBe(true);
    // the compile gate still linking: the rig keeps drawing (no hole, no cold link)
    expect(farMeshShown(true, true, true)).toBe(false);
    // no bake at all (a look that bakes to nothing, or a bake still budgeted)
    expect(farMeshShown(true, false, false)).toBe(false);
    // near: never, whatever the mesh state
    expect(farMeshShown(false, true, false)).toBe(false);
    expect(farMeshShown(false, true, true)).toBe(false);
  });
});

describe('shadowProxyShown', () => {
  it('follows the shadow plan, gated on the far bake being ready, NOT on far', () => {
    // the plan may want the proxy for a near body in the proxy band
    expect(shadowProxyShown(true, true, false)).toBe(true);
    expect(shadowProxyShown(true, true, true)).toBe(false);
    expect(shadowProxyShown(true, false, false)).toBe(false);
    expect(shadowProxyShown(false, true, false)).toBe(false);
  });
});

describe('shadowStandInShown', () => {
  it('casts whenever the plan wants a proxy the baked silhouette cannot give', () => {
    // no far bake yet (a body that has never been far): the stand-in casts
    expect(shadowStandInShown(true, false, false)).toBe(true);
    // the far bake is minted but still linking: the stand-in keeps casting
    expect(shadowStandInShown(true, true, true)).toBe(true);
    // the baked silhouette is ready: it takes over
    expect(shadowStandInShown(true, true, false)).toBe(false);
  });

  it('casts nothing the plan does not ask for', () => {
    for (const hasBaked of [true, false]) {
      for (const pending of [true, false]) {
        expect(shadowStandInShown(false, hasBaked, pending)).toBe(false);
      }
    }
  });

  it('is the exact complement of the baked proxy under a wanted plan: one, never both, never neither', () => {
    for (const hasBaked of [true, false]) {
      for (const pending of [true, false]) {
        const baked = shadowProxyShown(true, hasBaked, pending);
        const standIn = shadowStandInShown(true, hasBaked, pending);
        expect(baked !== standIn, `baked=${hasBaked} pending=${pending}`).toBe(true);
      }
    }
  });

  it('casts nothing for a body still waiting for its head', () => {
    expect(bodyDrawn(shadowStandInShown(true, false, false), true)).toBe(false);
  });
});

describe('bodyDrawn', () => {
  it('draws nothing of a body that still waits for its head: rig, far mesh or shadow proxy', () => {
    for (const shown of [true, false]) expect(bodyDrawn(shown, true)).toBe(false);
  });

  it('is exactly the reveal rule for every body that does not wait', () => {
    expect(bodyDrawn(true, false)).toBe(true);
    expect(bodyDrawn(false, false)).toBe(false);
    // the rig and the far mesh stay mutually exclusive through it
    for (const far of [true, false]) {
      const standsIn = farMeshShown(far, true, false);
      expect(bodyDrawn(!standsIn, false)).toBe(!standsIn);
      expect(bodyDrawn(standsIn, false)).toBe(standsIn);
    }
  });
});
